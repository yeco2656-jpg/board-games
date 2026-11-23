// ============================================================
//  五子棋联机中转（零依赖 Node HTTP 服务）
//  职责：建房 / 加入 / 落子同步 / 长轮询推送
//  设计取舍：只做「棋步广播 + 简单胜负判定」，禁手交给客户端本地校验，
//            因为两端都是我们自己的客户端；朋友之间对弈也不需要防作弊级强度。
// ============================================================
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 围棋规则引擎（与网页共用同一份 public/go-engine.js，保证两端判定一致）
const require = createRequire(import.meta.url);
const GoEngine = require('./public/go-engine.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAY_HTML = path.join(__dirname, 'public', 'index.html');

// 网页端要用到的脚本（围棋引擎 + 渲染）
const STATIC_JS = {
  '/go-engine.js': 'go-engine.js',
  '/go-ui.js': 'go-ui.js',
  '/chess-engine.js': 'chess-engine.js'
};

// 客户端安装包下载（网页上给朋友直接下）
// 注意：平台 WAF 会拦 .zip/.7z/.rar，所以电脑版直接给 .exe，不打包压缩
const DOWNLOADS = {
  '/gomoku.apk': {
    file: 'gomoku.apk',
    type: 'application/vnd.android.package-archive',
    name: 'qilei-youxi-1.8.apk'
  },
  '/gomoku-windows.exe': {
    file: 'gomoku-windows.exe',
    type: 'application/octet-stream',
    name: 'qilei-youxi-1.4.1.exe'
  },
  '/gomoku-windows-readme.txt': {
    file: 'gomoku-windows-readme.txt',
    type: 'text/plain; charset=utf-8',
    name: 'readme.txt',
    inline: true
  }
};

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const IDLE_MS = 40 * 60 * 1000;      // 房间空闲 40 分钟回收
const MAX_WAIT_MS = 25 * 1000;       // 长轮询单次最长挂起 25 秒（避免反代超时）
const MAX_ROOMS = 800;

/** roomId -> room */
const rooms = new Map();

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 I O 0 1，避免看错

function newRoomId() {
  for (let attempt = 0; attempt < 40; attempt++) {
    let s = '';
    const buf = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) s += ID_CHARS[buf[i] % ID_CHARS.length];
    if (!rooms.has(s)) return s;
  }
  return 'R' + Date.now().toString(36).toUpperCase().slice(-6);
}

function newToken() {
  return crypto.randomBytes(12).toString('hex');
}

function now() { return Date.now(); }

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

/** 统计以 (x,y) 为端点、沿 (dx,dy) 的连续同色长度与两端空位 */
function runInfo(b, size, x, y, color, dx, dy) {
  let cnt = 1;
  let openA = false, openB = false;
  let px = x + dx, py = y + dy;
  while (px >= 0 && px < size && py >= 0 && py < size && b[py * size + px] === color) {
    cnt++; px += dx; py += dy;
  }
  if (px >= 0 && px < size && py >= 0 && py < size && b[py * size + px] === 0) openA = true;
  px = x - dx; py = y - dy;
  while (px >= 0 && px < size && py >= 0 && py < size && b[py * size + px] === color) {
    cnt++; px -= dx; py -= dy;
  }
  if (px >= 0 && px < size && py >= 0 && py < size && b[py * size + px] === 0) openB = true;
  return { cnt, openA, openB };
}

/**
 * 严格规则下黑棋这一手是否禁手。
 * 五连优先：成五则无论同时形成什么长连/双三/双四都算黑胜，不禁。
 * 其余按 长连 > 双四 > 双三 判定。双三只认连续活三（够用，复杂跳三未覆盖）。
 */
function checkBlackMove(b, size, x, y) {
  const idx = y * size + x;
  if (b[idx] !== 0) return { five: false, forbidden: 'occupied' };
  b[idx] = 1;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const runs = dirs.map(([dx, dy]) => runInfo(b, size, x, y, 1, dx, dy));
  const five = runs.some((r) => r.cnt === 5);
  const overline = runs.some((r) => r.cnt >= 6);
  b[idx] = 0;
  if (five) return { five: true, forbidden: null };
  if (overline) return { five: false, forbidden: 'overline' };
  const fours = runs.filter((r) => r.cnt === 4 && (r.openA || r.openB)).length;
  if (fours >= 2) return { five: false, forbidden: 'doubleFour' };
  const threes = runs.filter((r) => r.cnt === 3 && r.openA && r.openB).length;
  if (threes >= 2) return { five: false, forbidden: 'doubleThree' };
  return { five: false, forbidden: null };
}

/** 服务端也做一次五连判定，保证两端看到的胜负一致 */
function detectWin(moves, size, rule) {
  if (!moves.length) return null;
  const last = moves[moves.length - 1];
  const b = new Int8Array(size * size);
  for (const m of moves) {
    if (m.x >= 0 && m.x < size && m.y >= 0 && m.y < size) b[m.y * size + m.x] = m.c;
  }
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const runs = dirs.map(([dx, dy]) => runInfo(b, size, last.x, last.y, last.c, dx, dy).cnt);
  if (rule === 'strict' && last.c === 1) {
    if (runs.some((c) => c === 5)) return { winner: 1, reason: 'five' };
    if (runs.some((c) => c >= 6)) return { winner: 2, reason: 'overline' };
  } else if (runs.some((c) => c >= 5)) {
    return { winner: last.c, reason: 'five' };
  }
  return null;
}

function roomPublic(room, viewerColor) {
  return {
    room: room.id,
    game: room.game || 'gomoku',
    score: room.score || null,
    passes: room.passes || 0,
    size: room.size,
    rule: room.rule,
    version: room.version,
    moves: room.moves.map((m) => [m.x, m.y, m.c]),
    turn: room.turn,
    status: room.status,
    winner: room.winner,
    reason: room.reason,
    blackJoined: !!room.black,
    whiteJoined: !!room.white,
    you: viewerColor,
    players: (room.black ? 1 : 0) + (room.white ? 1 : 0)
  };
}

function touch(room) {
  room.lastActive = now();
}

/** 唤醒该房间所有等待者 */
function notify(room) {
  const waiters = room.waiters;
  room.waiters = [];
  for (const w of waiters) {
    clearTimeout(w.timer);
    try { json(w.res, 200, roomPublic(room, w.color)); } catch (e) { /* 已断开 */ }
  }
}

/** 删除房间并让挂在它上面的长轮询立刻收到 404 */
function dropRoom(room) {
  rooms.delete(room.id);
  for (const w of room.waiters || []) {
    clearTimeout(w.timer);
    try { json(w.res, 404, { ok: false, error: 'room_not_found' }); } catch (e) { /* 已断开 */ }
  }
  room.waiters = [];
}

// ------------------------------------------------------------
// 路由
// ------------------------------------------------------------
async function handleCreate(req, res) {
  const body = await readBody(req);
  const game = body.game === 'go' ? 'go' : 'gomoku';
  const szRaw = Number(body.size);
  // 围棋：19 路标准 / 13 路新手；五子棋：15 / 19
  const size = game === 'go'
    ? (szRaw === 13 ? 13 : 19)
    : (szRaw === 19 ? 19 : 15);
  const rule = body.rule === 'strict' ? 'strict' : 'loose';

  // 房间数保护：超了就清最久没动静的
  if (rooms.size >= MAX_ROOMS) {
    let oldest = null;
    for (const r of rooms.values()) {
      if (!oldest || r.lastActive < oldest.lastActive) oldest = r;
    }
    if (oldest) dropRoom(oldest);
  }

  const id = newRoomId();
  const token = newToken();
  const room = {
    id, size, rule, game,
    version: 1,
    moves: [],
    passes: 0,
    score: null,
    turn: 1,
    status: 'waiting',
    winner: 0,
    reason: '',
    black: token,
    white: null,
    createdAt: now(),
    lastActive: now(),
    waiters: []
  };
  rooms.set(id, room);
  return json(res, 200, { ok: true, ...roomPublic(room, 1), token });
}

async function handleJoin(req, res) {
  const body = await readBody(req);
  const id = String(body.room || '').toUpperCase().trim();
  const room = rooms.get(id);
  if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });

  // 已有 token 的老人重新连进来（断线重连）
  if (body.token) {
    if (body.token === room.black) {
      touch(room);
      return json(res, 200, { ok: true, ...roomPublic(room, 1), token: room.black });
    }
    if (body.token === room.white) {
      touch(room);
      return json(res, 200, { ok: true, ...roomPublic(room, 2), token: room.white });
    }
  }

  if (room.white) return json(res, 409, { ok: false, error: 'room_full' });

  room.white = newToken();
  room.status = 'playing';
  if (room.moves.length === 0) room.turn = 1;
  room.version++;
  touch(room);
  const snapshot = roomPublic(room, 2);
  notify(room);
  return json(res, 200, { ok: true, ...snapshot, token: room.white });
}

async function handleMove(req, res) {
  const body = await readBody(req);
  const id = String(body.room || '').toUpperCase().trim();
  const room = rooms.get(id);
  if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });

  const token = String(body.token || '');
  let color = 0;
  if (token && token === room.black) color = 1;
  else if (token && token === room.white) color = 2;
  if (!color) return json(res, 403, { ok: false, error: 'bad_token' });

  if (room.winner) return json(res, 409, { ok: false, error: 'game_over' });
  if (!room.white) return json(res, 409, { ok: false, error: 'not_ready' });
  if (room.turn !== color) return json(res, 409, { ok: false, error: 'not_your_turn', turn: room.turn });

  const x = Number(body.x);
  const y = Number(body.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= room.size || y >= room.size) {
    return json(res, 400, { ok: false, error: 'bad_coord' });
  }

  // ---- 围棋：服务端也跑一遍规则，保证两端盘面一致 ----
  if (room.game === 'go') {
    if (room.status === 'over' || room.status === 'scoring') {
      return json(res, 409, { ok: false, error: 'game_over' });
    }
    const g = goGameFrom(room);
    const why = g.check(x, y);
    if (why) {
      const code = why.indexOf('已有棋子') >= 0 ? 'occupied' : 'illegal';
      return json(res, 409, { ok: false, error: code, detail: why });
    }
    room.moves.push({ x, y, c: color });
    room.passes = 0;
    room.turn = 3 - color;
    room.status = 'playing';
    room.version++;
    touch(room);
    const snapGo = roomPublic(room, color);
    notify(room);
    return json(res, 200, { ok: true, ...snapGo });
  }

  if (room.moves.some((m) => m.x === x && m.y === y)) {
    return json(res, 409, { ok: false, error: 'occupied' });
  }
  // 客户端重试保护：同一步重复提交
  if (Number(body.seq) >= 0 && Number(body.seq) !== room.moves.length) {
    return json(res, 409, { ok: false, error: 'seq_mismatch', expect: room.moves.length });
  }

  // 严格房黑棋禁手：五连优先，其余禁手直接拒绝，不落子
  if (room.rule === 'strict' && color === 1) {
    const b = new Int8Array(room.size * room.size);
    for (const m of room.moves) {
      if (m.x >= 0 && m.x < room.size && m.y >= 0 && m.y < room.size) b[m.y * room.size + m.x] = m.c;
    }
    const chk = checkBlackMove(b, room.size, x, y);
    if (!chk.five && chk.forbidden) {
      return json(res, 409, { ok: false, error: 'forbidden', detail: chk.forbidden });
    }
  }

  room.moves.push({ x, y, c: color });
  const win = detectWin(room.moves, room.size, room.rule);
  if (win) {
    room.winner = win.winner;
    room.reason = win.reason;
    room.status = 'over';
  } else if (room.moves.length >= room.size * room.size) {
    room.winner = 0;
    room.reason = 'full';
    room.status = 'over';
  } else {
    room.turn = 3 - color;
    room.status = 'playing';
  }
  room.version++;
  touch(room);
  const snapshot = roomPublic(room, color);
  notify(room);
  return json(res, 200, { ok: true, ...snapshot });
}

function goGameFrom(room) {
  const g = new GoEngine.GoGame(room.size);
  g.replay(room.moves.map((m) => [m.x, m.y, m.c]));
  return g;
}

/** 从请求里取房间 + 落子方 */
function roomAndColor(req, body) {
  const id = String(body.room || '').toUpperCase().trim();
  const room = rooms.get(id);
  if (!room) return { err: ['room_not_found', 404] };
  const token = String(body.token || '');
  let color = 0;
  if (token && token === room.black) color = 1;
  else if (token && token === room.white) color = 2;
  if (!color) return { err: ['bad_token', 403] };
  return { room, color };
}

/** 围棋：弃一手 */
async function handlePass(req, res) {
  const body = await readBody(req);
  const r = roomAndColor(req, body);
  if (r.err) return json(res, r.err[1], { ok: false, error: r.err[0] });
  const { room, color } = r;
  if (room.game !== 'go') return json(res, 400, { ok: false, error: 'not_go' });
  if (room.status === 'over') return json(res, 409, { ok: false, error: 'game_over' });
  if (room.status === 'scoring') return json(res, 409, { ok: false, error: 'not_scoring' });
  if (!room.white) return json(res, 409, { ok: false, error: 'not_ready' });
  if (room.turn !== color) return json(res, 409, { ok: false, error: 'not_your_turn', turn: room.turn });

  room.moves.push({ x: -1, y: -1, c: color });
  room.passes = (room.passes || 0) + 1;
  room.turn = 3 - color;
  room.status = room.passes >= 2 ? 'scoring' : 'playing';
  room.version++;
  touch(room);
  const snap = roomPublic(room, color);
  notify(room);
  return json(res, 200, { ok: true, ...snap });
}

/** 围棋：认输 */
async function handleResign(req, res) {
  const body = await readBody(req);
  const r = roomAndColor(req, body);
  if (r.err) return json(res, r.err[1], { ok: false, error: r.err[0] });
  const { room, color } = r;
  if (room.game !== 'go') return json(res, 400, { ok: false, error: 'not_go' });
  if (room.status === 'over') return json(res, 409, { ok: false, error: 'game_over' });
  if (room.status === 'scoring') return json(res, 409, { ok: false, error: 'not_scoring' });
  room.winner = 3 - color;
  room.reason = 'resign';
  room.status = 'over';
  room.version++;
  touch(room);
  const snap = roomPublic(room, color);
  notify(room);
  return json(res, 200, { ok: true, ...snap });
}

/** 围棋：提交数子结果（双方各自看过盘面后由任一方提交） */
async function handleGoScore(req, res) {
  const body = await readBody(req);
  const r = roomAndColor(req, body);
  if (r.err) return json(res, r.err[1], { ok: false, error: r.err[0] });
  const { room, color } = r;
  if (room.game !== 'go') return json(res, 400, { ok: false, error: 'not_go' });
  if (room.status === 'over') return json(res, 409, { ok: false, error: 'game_over' });
  if (room.status !== 'scoring') return json(res, 409, { ok: false, error: 'not_scoring' });

  const black = Number(body.black);
  const white = Number(body.white);
  if (!Number.isFinite(black) || !Number.isFinite(white) || black < 0 || white < 0 || black > 400 || white > 400) {
    return json(res, 400, { ok: false, error: 'bad_score' });
  }
  room.score = {
    black: Math.round(black * 10) / 10,
    white: Math.round(white * 10) / 10,
    winner: black > white ? 1 : (white > black ? 2 : 0),
    by: color
  };
  room.winner = room.score.winner;
  room.reason = 'score';
  room.status = 'over';
  room.version++;
  touch(room);
  const snap = roomPublic(room, color);
  notify(room);
  return json(res, 200, { ok: true, ...snap });
}

/** 重开一局：任一方发起，房间保留，棋步清空，黑白互换 */
async function handleRestart(req, res) {
  const body = await readBody(req);
  const id = String(body.room || '').toUpperCase().trim();
  const room = rooms.get(id);
  if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });

  const token = String(body.token || '');
  let color = 0;
  if (token && token === room.black) color = 1;
  else if (token && token === room.white) color = 2;
  if (!color) return json(res, 403, { ok: false, error: 'bad_token' });

  // 只有「真的下过棋」的重开才换色。
  // 否则连点几次「重新开始」就会换几次色，双方颜色来回跳。
  // 已经清空过（moves 为 0）说明刚重开过，这次只当幂等的刷新。
  const canSwap = !!body.swap && !!room.black && !!room.white && room.moves.length > 0;

  room.moves = [];
  room.passes = 0;
  room.score = null;
  room.winner = 0;
  room.reason = '';
  room.status = room.white ? 'playing' : 'waiting';
  room.turn = 1;
  if (canSwap) {
    const t = room.black; room.black = room.white; room.white = t;
  }
  room.version++;
  touch(room);
  notify(room);
  // 换色之后重新算「我是哪一方」，否则客户端会以为自己还是原来的颜色
  let newColor = 0;
  if (token === room.black) newColor = 1;
  else if (token === room.white) newColor = 2;
  const snap = roomPublic(room, newColor || color);
  return json(res, 200, { ok: true, ...snap, token, swapped: canSwap });
}

function handleState(req, res, url) {
  const id = String(url.searchParams.get('room') || '').toUpperCase().trim();
  const room = rooms.get(id);
  if (!room) return json(res, 404, { ok: false, error: 'room_not_found' });

  const token = url.searchParams.get('token') || '';
  let color = 0;
  if (token && token === room.black) color = 1;
  else if (token && token === room.white) color = 2;

  const sinceV = Number(url.searchParams.get('v') || 0);
  touch(room);

  if (room.version > sinceV || color === 0) {
    return json(res, 200, roomPublic(room, color));
  }

  // 长轮询：等到有变化或超时
  const waiter = { res, color, timer: null };
  waiter.timer = setTimeout(() => {
    const i = room.waiters.indexOf(waiter);
    if (i >= 0) room.waiters.splice(i, 1);
    try { json(res, 200, roomPublic(room, color)); } catch (e) { /* ignore */ }
  }, MAX_WAIT_MS);
  room.waiters.push(waiter);

  req.on('close', () => {
    clearTimeout(waiter.timer);
    const i = room.waiters.indexOf(waiter);
    if (i >= 0) room.waiters.splice(i, 1);
  });
}

function indexPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>五子棋联机中转</title>
<style>body{background:#14181F;color:#E6EAF0;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;padding:28px;line-height:1.7}
h1{color:#D8A04A;font-size:20px}code{background:#232B36;padding:2px 6px;border-radius:4px}
li{margin:6px 0}.muted{color:#8B97A7;font-size:13px}</style></head><body>
<h1>五子棋联机中转 · 运行中</h1>
<p class="muted">这是五子棋桌面版 / 安卓版的联机服务，不是给人直接访问的页面。</p>
<ul>
<li><code>POST /api/create</code> 开房（返回 6 位房间号）</li>
<li><code>POST /api/join</code> 加入房间</li>
<li><code>POST /api/move</code> 落子</li>
<li><code>GET /api/state?room=&amp;v=&amp;token=</code> 长轮询取状态</li>
<li><code>POST /api/restart</code> 再来一局</li>
</ul>
<p class="muted">房间存在内存里，服务重启即清空；空闲 40 分钟自动回收。</p>
</body></html>`;
}

// ------------------------------------------------------------
// 服务器
// ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/play')) {
      // 优先返回网页版对战页；读不到再退回说明页
      let html = null;
      try { html = fs.readFileSync(PLAY_HTML, 'utf8'); } catch (e) { html = indexPage(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC_JS[url.pathname]) {
      try {
        const buf = fs.readFileSync(path.join(__dirname, 'public', STATIC_JS[url.pathname]));
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': buf.length,
          'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') res.end();
        else res.end(buf);
      } catch (e) {
        return json(res, 404, { ok: false, error: 'file_missing' });
      }
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && DOWNLOADS[url.pathname]) {
      const d = DOWNLOADS[url.pathname];
      try {
        const buf = fs.readFileSync(path.join(__dirname, 'public', d.file));
        const disp = (d.inline ? 'inline' : 'attachment') + '; filename="' + d.name + '"';
        res.writeHead(200, {
          'Content-Type': d.type,
          'Content-Length': buf.length,
          'Content-Disposition': disp,
          'Cache-Control': 'public, max-age=600',
          'Access-Control-Allow-Origin': '*'
        });
        if (req.method === 'HEAD') res.end();
        else res.end(buf);
      } catch (e) {
        return json(res, 404, { ok: false, error: 'file_missing', file: d.file });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return handleState(req, res, url);
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      return await handleCreate(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/join') {
      return await handleJoin(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/move') {
      return await handleMove(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/restart') {
      return await handleRestart(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/pass') {
      return await handlePass(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/resign') {
      return await handleResign(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/go-score') {
      return await handleGoScore(req, res);
    }
    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    return json(res, 400, { ok: false, error: 'bad_request', detail: String(e && e.message || e) });
  }
});

// 定期回收空闲房间
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (t - room.lastActive > IDLE_MS) {
      dropRoom(room);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`[gomoku-online] listening on ${HOST}:${PORT}`);
});
