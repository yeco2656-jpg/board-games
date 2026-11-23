/* ============================================================
   中国象棋 · 网页版引擎（规则 + AI + canvas 绘制 + 交互）
   与桌面版 ChessRules.cs 同源规则
   ============================================================ */
window.ChessGame = (function () {
  'use strict';

  var W = 9, H = 10;
  var EMPTY = 0, KING = 1, ADVISOR = 2, BISHOP = 3, KNIGHT = 4, ROOK = 5, CANNON = 6, PAWN = 7, BLACK = 8;

  var S = {
    board: null, turnBlack: false, over: false, result: '',
    winner: 0, reason: '', saved: false,
    history: [], caps: [], notes: [], fenSeen: [], noCapture: 0,
    selected: -1, targets: [], lastFrom: -1, lastTo: -1,
    hintFrom: -1, hintTo: -1,
    mode: 0, level: 2, humanRed: true, thinking: false,
    aiTimer: null, aiToken: 0, ctx: null, side: 320, onUpdate: null
  };

  var HISTORY_KEY = 'chess-history-v1';

  var LEVELS = [
    { name: '入门', depth: 2, time: 250 },
    { name: '普通', depth: 3, time: 600 },
    { name: '困难', depth: 4, time: 1100 },
    { name: '大师', depth: 5, time: 2200 }
  ];

  // ---------- 基础 ----------
  function idx(x, y) { return y * W + x; }
  function X(i) { return i % W; }
  function Y(i) { return (i / W) | 0; }
  function isB(p) { return (p & BLACK) !== 0; }
  function kind(p) { return p & 7; }
  function inBoard(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  function inPalace(x, y, black) {
    if (x < 3 || x > 5) return false;
    return black ? (y >= 0 && y <= 2) : (y >= 7 && y <= 9);
  }

  function newBoard() {
    var b = new Array(90);
    for (var i = 0; i < 90; i++) b[i] = 0;
    var back = [ROOK, KNIGHT, BISHOP, ADVISOR, KING, ADVISOR, BISHOP, KNIGHT, ROOK];
    for (var x = 0; x < 9; x++) {
      b[idx(x, 0)] = back[x] | BLACK;
      b[idx(x, 9)] = back[x];
    }
    b[idx(1, 2)] = CANNON | BLACK; b[idx(7, 2)] = CANNON | BLACK;
    b[idx(1, 7)] = CANNON; b[idx(7, 7)] = CANNON;
    [0, 2, 4, 6, 8].forEach(function (x) { b[idx(x, 3)] = PAWN | BLACK; });
    [0, 2, 4, 6, 8].forEach(function (x) { b[idx(x, 6)] = PAWN; });
    return b;
  }

  // ---------- 走法生成 ----------
  var RDX = [0, 0, -1, 1], RDY = [-1, 1, 0, 0];
  var KDX = [0, 0, -1, 1], KDY = [-1, 1, 0, 0];
  var KnDx = [-2, -2, 2, 2, -1, 1, -1, 1];
  var KnDy = [-1, 1, -1, 1, -2, -2, 2, 2];
  var BpDx = [-2, -2, 2, 2], BpDy = [-2, 2, -2, 2];
  var AdDx = [-1, -1, 1, 1], AdDy = [-1, 1, -1, 1];

  function addMove(b, from, nx, ny, black, list, capsOnly) {
    if (!inBoard(nx, ny)) return;
    var to = idx(nx, ny), t = b[to];
    if (t !== 0) {
      if (isB(t) === black) return;
    } else if (capsOnly) return;
    list.push({ f: from, t: to, c: t });
  }

  function genMoves(b, black, capsOnly) {
    var list = [];
    for (var i = 0; i < 90; i++) {
      var p = b[i];
      if (p === 0 || isB(p) !== black) continue;
      var k = kind(p), x = X(i), y = Y(i), d, nx, ny, t;

      if (k === ROOK || k === CANNON) {
        for (d = 0; d < 4; d++) {
          nx = x + RDX[d]; ny = y + RDY[d];
          var screen = false;
          while (inBoard(nx, ny)) {
            t = b[idx(nx, ny)];
            if (k === ROOK) {
              if (t !== 0) {
                if (isB(t) !== black) list.push({ f: i, t: idx(nx, ny), c: t });
                break;
              }
              if (!capsOnly) list.push({ f: i, t: idx(nx, ny), c: 0 });
            } else {
              if (!screen) {
                if (t === 0) { if (!capsOnly) list.push({ f: i, t: idx(nx, ny), c: 0 }); }
                else screen = true;
              } else if (t !== 0) {
                if (isB(t) !== black) list.push({ f: i, t: idx(nx, ny), c: t });
                break;
              }
            }
            nx += RDX[d]; ny += RDY[d];
          }
        }
        continue;
      }

      if (k === KNIGHT) {
        for (d = 0; d < 8; d++) {
          var lx = x + (Math.abs(KnDx[d]) === 2 ? KnDx[d] / 2 : 0);
          var ly = y + (Math.abs(KnDy[d]) === 2 ? KnDy[d] / 2 : 0);
          if (!inBoard(lx, ly) || b[idx(lx, ly)] !== 0) continue;
          addMove(b, i, x + KnDx[d], y + KnDy[d], black, list, capsOnly);
        }
        continue;
      }

      if (k === BISHOP) {
        for (d = 0; d < 4; d++) {
          nx = x + BpDx[d]; ny = y + BpDy[d];
          if (!inBoard(nx, ny)) continue;
          if (black ? ny > 4 : ny < 5) continue;
          if (b[idx(x + BpDx[d] / 2, y + BpDy[d] / 2)] !== 0) continue;
          addMove(b, i, nx, ny, black, list, capsOnly);
        }
        continue;
      }

      if (k === ADVISOR) {
        for (d = 0; d < 4; d++) {
          nx = x + AdDx[d]; ny = y + AdDy[d];
          if (!inPalace(nx, ny, black)) continue;
          addMove(b, i, nx, ny, black, list, capsOnly);
        }
        continue;
      }

      if (k === KING) {
        for (d = 0; d < 4; d++) {
          nx = x + KDX[d]; ny = y + KDY[d];
          if (!inPalace(nx, ny, black)) continue;
          addMove(b, i, nx, ny, black, list, capsOnly);
        }
        continue;
      }

      // 兵/卒
      addMove(b, i, x, black ? y + 1 : y - 1, black, list, capsOnly);
      var crossed = black ? y >= 5 : y <= 4;
      if (crossed) {
        addMove(b, i, x - 1, y, black, list, capsOnly);
        addMove(b, i, x + 1, y, black, list, capsOnly);
      }
    }
    return list;
  }

  function findKing(b, black) {
    var target = black ? (KING | BLACK) : KING;
    for (var i = 0; i < 90; i++) if (b[i] === target) return i;
    return -1;
  }

  function squareAttacked(b, sq, byBlack) {
    var x = X(sq), y = Y(sq), d, nx, ny;
    for (d = 0; d < 4; d++) {
      nx = x + RDX[d]; ny = y + RDY[d];
      var found = 0;
      while (inBoard(nx, ny)) {
        var p = b[idx(nx, ny)];
        if (p !== 0) {
          var enemy = isB(p) === byBlack, kd = kind(p);
          if (found === 0) {
            if (enemy && kd === ROOK) return true;
            if (enemy && kd === KING && RDX[d] === 0) return true;
            found = 1;
          } else {
            if (enemy && kd === CANNON) return true;
            break;
          }
        }
        nx += RDX[d]; ny += RDY[d];
      }
    }
    for (d = 0; d < 8; d++) {
      var mx = x + KnDx[d], my = y + KnDy[d];
      if (!inBoard(mx, my)) continue;
      var pm = b[idx(mx, my)];
      if (pm === 0 || isB(pm) !== byBlack || kind(pm) !== KNIGHT) continue;
      var lx = mx, ly = my;
      if (Math.abs(KnDx[d]) === 2) lx = mx - KnDx[d] / 2;
      else ly = my - KnDy[d] / 2;
      if (b[idx(lx, ly)] === 0) return true;
    }
    if (byBlack) {
      if (inBoard(x, y - 1) && b[idx(x, y - 1)] === (PAWN | BLACK)) return true;
      if (y >= 5 && inBoard(x - 1, y) && b[idx(x - 1, y)] === (PAWN | BLACK)) return true;
      if (y >= 5 && inBoard(x + 1, y) && b[idx(x + 1, y)] === (PAWN | BLACK)) return true;
    } else {
      if (inBoard(x, y + 1) && b[idx(x, y + 1)] === PAWN) return true;
      if (y <= 4 && inBoard(x - 1, y) && b[idx(x - 1, y)] === PAWN) return true;
      if (y <= 4 && inBoard(x + 1, y) && b[idx(x + 1, y)] === PAWN) return true;
    }
    return false;
  }

  function kingAttacked(b, black) {
    var k = findKing(b, black);
    if (k < 0) return true;
    return squareAttacked(b, k, !black);
  }

  function legalMoves(b, black) {
    var pseudo = genMoves(b, black, false), out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i], cap = b[m.t];
      b[m.t] = b[m.f]; b[m.f] = 0;
      if (!kingAttacked(b, black)) out.push(m);
      b[m.f] = b[m.t]; b[m.t] = cap;
    }
    return out;
  }

  function applyMove(b, m) {
    var cap = b[m.t];
    b[m.t] = b[m.f]; b[m.f] = 0;
    return cap;
  }
  function undoMove(b, m, cap) { b[m.f] = b[m.t]; b[m.t] = cap; }

  function toFen(b) {
    var rows = [];
    for (var y = 0; y < H; y++) {
      var s = '', gap = 0;
      for (var x = 0; x < W; x++) {
        var p = b[idx(x, y)];
        if (p === 0) { gap++; continue; }
        if (gap) { s += gap; gap = 0; }
        s += pieceChar(p);
      }
      if (gap) s += gap;
      rows.push(s);
    }
    return rows.join('/');
  }

  function pieceChar(p) {
    var letters = ['', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];
    var c = letters[kind(p)];
    return isB(p) ? c : c.toUpperCase();
  }

  // ---------- 记谱 ----------
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function numText(n, black) { return black ? String(n) : (CN[n - 1] || String(n)); }
  function fileNumber(x, black) { return black ? x + 1 : 9 - x; }
  function pieceName(p) {
    var k = kind(p), b = isB(p);
    if (k === KING) return b ? '将' : '帅';
    if (k === ADVISOR) return b ? '士' : '仕';
    if (k === BISHOP) return b ? '象' : '相';
    if (k === KNIGHT) return '马';
    if (k === ROOK) return '车';
    if (k === CANNON) return '炮';
    if (k === PAWN) return b ? '卒' : '兵';
    return '';
  }

  function moveText(b, m) {
    var p = b[m.f];
    if (!p) return '';
    var black = isB(p), fx = X(m.f), fy = Y(m.f), tx = X(m.t), ty = Y(m.t);
    var name = pieceName(p), multi = false;

    var same = [];
    for (var y = 0; y < H; y++) if (b[idx(fx, y)] === p) same.push(y);
    if (same.length >= 2) {
      same.sort(function (a, b2) { return black ? b2 - a : a - b2; });
      var order = same.indexOf(fy), pf;
      if (same.length === 2) pf = order === 0 ? '前' : '后';
      else if (same.length === 3) pf = order === 0 ? '前' : (order === 1 ? '中' : '后');
      else pf = order === 0 ? '前' : (order === same.length - 1 ? '后' : numText(order + 1, black));
      name = pf + name;
      multi = true;
    }

    var action, target;
    if (ty === fy) {
      action = '平';
      target = numText(fileNumber(tx, black), black);
    } else {
      action = (black ? ty > fy : ty < fy) ? '进' : '退';
      target = (tx === fx) ? numText(Math.abs(ty - fy), black) : numText(fileNumber(tx, black), black);
    }
    if (multi) return name + action + target;
    return name + numText(fileNumber(fx, black), black) + action + target;
  }

  // ---------- 评估与搜索 ----------
  var VALUE = [0, 20000, 220, 220, 430, 900, 460, 100];
  var MATE = 500000, INF = 1000000;

  function posBonus(p, x, y) {
    var k = kind(p), black = isB(p);
    var ny = black ? y : 9 - y;
    if (k === PAWN) {
      var bonus = 0;
      if (ny >= 5) bonus += 90;
      if (ny >= 7) bonus += 40;
      if (x >= 3 && x <= 5) bonus += 15;
      return bonus;
    }
    if (k === KNIGHT) return 18 - Math.abs(x - 4) * 3 - Math.abs(y - 4) * 2;
    if (k === ROOK) return (x === 4 ? 12 : 0) + (ny >= 5 ? 8 : 0);
    if (k === CANNON) return (x === 4 ? 10 : 0) + (ny >= 4 ? 4 : 0);
    return 0;
  }

  function evaluate(b, black) {
    var red = 0;
    for (var i = 0; i < 90; i++) {
      var p = b[i];
      if (!p) continue;
      var v = VALUE[kind(p)] + posBonus(p, X(i), Y(i));
      if (isB(p)) red -= v; else red += v;
    }
    return black ? -red : red;
  }

  var nodes = 0, deadline = 0;

  function moveScore(b, m) {
    var cap = b[m.t];
    if (!cap) return 0;
    return 10 * VALUE[kind(cap)] - VALUE[kind(b[m.f])];
  }

  function orderMoves(b, moves) {
    return moves.slice().sort(function (a, c) { return moveScore(b, c) - moveScore(b, a); });
  }

  function quiesce(b, black, alpha, beta, depth) {
    var stand = evaluate(b, black);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha;
    var caps = genMoves(b, black, true), i;
    if (!caps.length) return alpha;
    caps = orderMoves(b, caps);
    for (i = 0; i < caps.length; i++) {
      var m = caps[i], cap = b[m.t];
      b[m.t] = b[m.f]; b[m.f] = 0;
      if (kingAttacked(b, black)) { b[m.f] = b[m.t]; b[m.t] = cap; continue; }
      var val = -quiesce(b, !black, -beta, -alpha, depth - 1);
      b[m.f] = b[m.t]; b[m.t] = cap;
      if (val >= beta) return beta;
      if (val > alpha) alpha = val;
    }
    return alpha;
  }

  function negamax(b, black, depth, alpha, beta, ply) {
    nodes++;
    if ((nodes & 1023) === 0 && Date.now() > deadline) return 0;
    var moves = legalMoves(b, black);
    if (!moves.length) return -MATE + ply;
    if (depth <= 0) return quiesce(b, black, alpha, beta, 2);
    moves = orderMoves(b, moves);
    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], cap = b[m.t];
      b[m.t] = b[m.f]; b[m.f] = 0;
      var val = -negamax(b, !black, depth - 1, -beta, -alpha, ply + 1);
      b[m.f] = b[m.t]; b[m.t] = cap;
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  function searchBest(b0, black, level) {
    var lv = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))];
    var b = b0.slice();
    var root = legalMoves(b, black);
    if (!root.length) return null;
    if (root.length === 1) return root[0];
    nodes = 0;
    deadline = Date.now() + lv.time;
    var best = root[0];
    for (var d = 1; d <= lv.depth; d++) {
      var ordered = orderMoves(b, root), bestThis = best, score = -INF, alpha = -INF, beta = INF;
      for (var i = 0; i < ordered.length; i++) {
        var m = ordered[i], cap = b[m.t];
        b[m.t] = b[m.f]; b[m.f] = 0;
        var val = -negamax(b, !black, d - 1, -beta, -alpha, 1);
        b[m.f] = b[m.t]; b[m.t] = cap;
        if (val > score) { score = val; bestThis = m; }
        if (val > alpha) alpha = val;
        if (alpha >= beta) break;
        if (Date.now() > deadline) break;
      }
      if (Date.now() > deadline) break;
      best = bestThis;
      if (score >= MATE - 100) break;
    }
    // 低难度加一点随机
    if (level <= 2 && Math.random() < 0.35) {
      var all = legalMoves(b, black);
      if (all.length > 1) return all[Math.floor(Math.random() * Math.min(all.length, 3))];
    }
    return best;
  }

  // ---------- 绘制 ----------
  function metrics(side) {
    var cell = Math.max(10, Math.min((side - 24) / 9, (side - 24) / 10));
    var ox = (side - cell * 8) / 2, oy = (side - cell * 9) / 2;
    return { cell: cell, ox: ox, oy: oy };
  }

  function drawBoard(c, side) {
    var mt = metrics(side), cell = mt.cell, ox = mt.ox, oy = mt.oy;
    c.clearRect(0, 0, side, side);

    var rect = { x: ox - cell / 2 - 7, y: oy - cell / 2 - 7, w: cell * 8 + cell + 14, h: cell * 9 + cell + 14 };
    var g = c.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    g.addColorStop(0, '#F0D9AE');
    g.addColorStop(0.55, '#E3C28C');
    g.addColorStop(1, '#CBA371');
    c.fillStyle = g;
    c.fillRect(rect.x, rect.y, rect.w, rect.h);
    c.strokeStyle = 'rgba(122,86,44,0.9)';
    c.lineWidth = Math.max(2, side / 240);
    c.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // 网格
    c.strokeStyle = 'rgba(110,79,42,0.85)';
    c.lineWidth = Math.max(1, side / 400);
    var x, y;
    for (y = 0; y <= 9; y++) {
      c.beginPath(); c.moveTo(ox, oy + y * cell); c.lineTo(ox + 8 * cell, oy + y * cell); c.stroke();
    }
    for (x = 0; x <= 8; x++) {
      if (x === 0 || x === 8) {
        c.beginPath(); c.moveTo(ox + x * cell, oy); c.lineTo(ox + x * cell, oy + 9 * cell); c.stroke();
      } else {
        c.beginPath(); c.moveTo(ox + x * cell, oy); c.lineTo(ox + x * cell, oy + 4 * cell); c.stroke();
        c.beginPath(); c.moveTo(ox + x * cell, oy + 5 * cell); c.lineTo(ox + x * cell, oy + 9 * cell); c.stroke();
      }
    }
    // 九宫
    [[3, 0, 5, 2], [5, 0, 3, 2], [3, 7, 5, 9], [5, 7, 3, 9]].forEach(function (l) {
      c.beginPath();
      c.moveTo(ox + l[0] * cell, oy + l[1] * cell);
      c.lineTo(ox + l[2] * cell, oy + l[3] * cell);
      c.stroke();
    });

    // 楚河汉界
    c.fillStyle = 'rgba(120,78,36,0.72)';
    c.font = 'bold ' + (cell * 0.46) + 'px KaiTi, "STKaiti", serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    var midY = oy + 4.5 * cell;
    c.fillText('楚  河', ox + 2 * cell, midY);
    c.fillText('汉  界', ox + 6 * cell, midY);

    // 兵炮位标记
    c.strokeStyle = 'rgba(160,124,74,0.9)';
    c.lineWidth = Math.max(1, side / 600);
    var marks = [[0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [1, 2], [7, 2],
                 [0, 6], [2, 6], [4, 6], [6, 6], [8, 6], [1, 7], [7, 7]];
    marks.forEach(function (m) {
      var px = ox + m[0] * cell, py = oy + m[1] * cell, len = cell * 0.11;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
        c.beginPath();
        c.moveTo(px + d[0] * len, py + d[1] * len - d[1] * len * 0.6);
        c.lineTo(px + d[0] * len, py + d[1] * len);
        c.lineTo(px + d[0] * len - d[0] * len * 0.6, py + d[1] * len);
        c.stroke();
      });
    });

    // 棋子
    for (var i = 0; i < 90; i++) {
      var p = S.board[i];
      if (!p) continue;
      var cx = ox + X(i) * cell, cy = oy + Y(i) * cell, r = cell * 0.44;
      c.beginPath(); c.arc(cx + 1.6, cy + 2.2, r, 0, Math.PI * 2);
      c.fillStyle = 'rgba(70,40,15,0.28)'; c.fill();
      var rg = c.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
      rg.addColorStop(0, '#FFF6DF');
      rg.addColorStop(1, '#E0C79A');
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fillStyle = rg; c.fill();
      c.strokeStyle = 'rgba(122,84,44,0.95)';
      c.lineWidth = Math.max(1.2, cell * 0.035); c.stroke();
      c.beginPath(); c.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(196,160,108,0.85)'; c.lineWidth = 1; c.stroke();

      c.fillStyle = isB(p) ? '#232323' : '#A62820';
      c.font = 'bold ' + (cell * 0.42) + 'px KaiTi, "STKaiti", serif';
      c.fillText(pieceName(p), cx, cy + cell * 0.015);
    }

    // 最后一步
    if (S.lastTo >= 0) {
      var lx = ox + X(S.lastTo) * cell, ly = oy + Y(S.lastTo) * cell, lr = cell * 0.46;
      c.strokeStyle = 'rgba(206,158,58,0.95)';
      c.lineWidth = Math.max(1.8, cell * 0.045);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
        c.beginPath();
        c.moveTo(lx + d[0] * lr, ly + d[1] * lr - d[1] * lr * 0.55);
        c.lineTo(lx + d[0] * lr, ly + d[1] * lr);
        c.lineTo(lx + d[0] * lr - d[0] * lr * 0.55, ly + d[1] * lr);
        c.stroke();
      });
    }

    // 提示
    if (S.hintFrom >= 0 && S.hintTo >= 0) {
      c.strokeStyle = 'rgba(78,145,205,0.95)';
      c.lineWidth = Math.max(1.5, cell * 0.04);
      [S.hintFrom, S.hintTo].forEach(function (i2) {
        var bx = ox + X(i2) * cell - cell * 0.3, by = oy + Y(i2) * cell - cell * 0.3;
        c.strokeRect(bx, by, cell * 0.6, cell * 0.6);
      });
    }

    // 选中
    if (S.selected >= 0) {
      c.beginPath();
      c.arc(ox + X(S.selected) * cell, oy + Y(S.selected) * cell, cell * 0.47, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(216,160,74,0.95)';
      c.lineWidth = Math.max(2, cell * 0.05);
      c.stroke();
    }

    // 可走点
    S.targets.forEach(function (to) {
      var tx = ox + X(to) * cell, ty = oy + Y(to) * cell;
      if (S.board[to] === 0) {
        c.beginPath();
        c.arc(tx, ty, cell * 0.10, 0, Math.PI * 2);
        c.fillStyle = 'rgba(46,125,79,0.85)'; c.fill();
      } else {
        c.beginPath();
        c.arc(tx, ty, cell * 0.44, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(192,57,43,0.9)';
        c.lineWidth = Math.max(1.8, cell * 0.045);
        c.stroke();
      }
    });
  }

  // ---------- 对局 ----------
  function notify() { if (S.onUpdate) S.onUpdate(); }

  function refreshLegal() { return legalMoves(S.board, S.turnBlack); }

  function reset() {
    S.aiToken++;
    S.board = newBoard();
    S.turnBlack = false;
    S.over = false; S.result = '';
    S.winner = 0; S.reason = ''; S.saved = false;
    S.history = []; S.caps = []; S.notes = []; S.fenSeen = []; S.noCapture = 0;
    S.selected = -1; S.targets = []; S.lastFrom = -1; S.lastTo = -1;
    S.hintFrom = -1; S.hintTo = -1; S.thinking = false;
    notify();
    maybeAI();
  }

  function playMove(m) {
    var txt = moveText(S.board, m);
    var cap = applyMove(S.board, m);
    S.history.push(m); S.caps.push(cap); S.notes.push(txt);
    S.fenSeen.push(toFen(S.board));
    if (cap) S.noCapture = 0; else S.noCapture++;
    S.turnBlack = !S.turnBlack;
    S.lastFrom = m.f; S.lastTo = m.t;
    S.selected = -1; S.targets = []; S.hintFrom = -1; S.hintTo = -1;

    var legal = refreshLegal();
    var check = kingAttacked(S.board, S.turnBlack);
    if (!legal.length) {
      S.over = true;
      S.result = (S.turnBlack ? '黑方' : '红方') + (check ? '被将死' : '无子可动') +
        '，' + (S.turnBlack ? '红方' : '黑方') + '获胜';
      S.winner = S.turnBlack ? 1 : 2;
      S.reason = check ? 'checkmate' : 'stalemate';
    } else if (S.noCapture >= 120) {
      S.over = true; S.result = '60 回合无吃子，判和';
      S.winner = 0; S.reason = 'nocapture';
    } else if (repeatCount() >= 3) {
      S.over = true; S.result = '同一局面出现三次，判和';
      S.winner = 0; S.reason = 'repetition';
    }
    if (S.over) saveHistory();
    notify();
    if (!S.over) maybeAI();
  }

  function repeatCount() {
    var cur = toFen(S.board), n = 1;
    for (var i = 0; i < S.fenSeen.length; i++) if (S.fenSeen[i] === cur) n++;
    return n;
  }

  function maybeAI() {
    if (S.mode !== 0 || S.over) return;
    var aiBlack = S.humanRed;
    if (S.turnBlack !== aiBlack) return;
    S.thinking = true;
    var token = ++S.aiToken;
    notify();
    setTimeout(function () {
      if (token !== S.aiToken) return;
      var mv = searchBest(S.board, S.turnBlack, S.level);
      if (token !== S.aiToken) return;
      S.thinking = false;
      if (!mv) { notify(); return; }
      // 校验仍在合法列表里
      var legal = refreshLegal(), ok = false;
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].f === mv.f && legal[i].t === mv.t) { mv = legal[i]; ok = true; break; }
      }
      if (!ok) { notify(); return; }
      playMove(mv);
    }, 30);
  }

  function click(sx, sy) {
    if (S.over || S.thinking) return false;
    if (S.mode === 0 && S.turnBlack !== (!S.humanRed)) return false; // 轮不到人
    var mt = metrics(S.side), cell = mt.cell;
    var x = Math.round((sx - mt.ox) / cell), y = Math.round((sy - mt.oy) / cell);
    if (!inBoard(x, y)) return false;
    if (Math.abs(sx - (mt.ox + x * cell)) > cell * 0.48 || Math.abs(sy - (mt.oy + y * cell)) > cell * 0.48) return false;
    var i = idx(x, y), p = S.board[i];

    if (S.selected >= 0) {
      var legal = refreshLegal();
      for (var k = 0; k < legal.length; k++) {
        if (legal[k].f === S.selected && legal[k].t === i) { playMove(legal[k]); return true; }
      }
      if (p && isB(p) === S.turnBlack) { select(i); return true; }
      S.selected = -1; S.targets = []; notify(); return true;
    }
    if (p && isB(p) === S.turnBlack) { select(i); return true; }
    return false;
  }

  function select(i) {
    S.selected = i;
    S.targets = [];
    var legal = refreshLegal();
    for (var k = 0; k < legal.length; k++) if (legal[k].f === i) S.targets.push(legal[k].t);
    S.hintFrom = -1; S.hintTo = -1;
    notify();
  }

  function undo() {
    S.aiToken++;
    S.thinking = false;
    if (!S.history.length) { notify(); return; }
    undoOne();
    if (S.mode === 0) {
      while (S.history.length && S.turnBlack !== (!S.humanRed)) undoOne();
    }
    notify();
  }

  function undoOne() {
    var last = S.history.length - 1;
    var m = S.history[last], cap = S.caps[last];
    undoMove(S.board, m, cap);
    S.history.pop(); S.caps.pop(); S.notes.pop(); S.fenSeen.pop();
    S.turnBlack = !S.turnBlack;
    S.over = false; S.result = '';
    S.lastTo = S.history.length ? S.history[S.history.length - 1].t : -1;
    S.lastFrom = S.history.length ? S.history[S.history.length - 1].f : -1;
    S.noCapture = 0;
    for (var i = 0; i < S.caps.length; i++) { if (!S.caps[i]) S.noCapture++; else S.noCapture = 0; }
    S.selected = -1; S.targets = []; S.hintFrom = -1; S.hintTo = -1;
  }

  function hint() {
    if (S.over || S.thinking) return;
    S.thinking = true;
    var token = ++S.aiToken;
    notify();
    setTimeout(function () {
      if (token !== S.aiToken) return;
      var mv = searchBest(S.board, S.turnBlack, Math.max(2, S.level));
      if (token !== S.aiToken) return;
      S.thinking = false;
      if (mv) { S.hintFrom = mv.f; S.hintTo = mv.t; }
      notify();
    }, 30);
  }

  function resign() {
    if (S.over) return;
    S.aiToken++;
    S.thinking = false; S.over = true;
    S.result = (S.turnBlack ? '黑方' : '红方') + '认输，' + (S.turnBlack ? '红方' : '黑方') + '获胜';
    S.winner = S.turnBlack ? 1 : 2;
    S.reason = 'resign';
    saveHistory();
    notify();
  }

  // ---------- 历史记录 ----------
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var r = arr[i];
        if (!r || typeof r.t !== 'number' || !Array.isArray(r.moves)) continue;
        var mv = [];
        for (var j = 0; j < r.moves.length; j++) {
          var p = r.moves[j];
          if (!Array.isArray(p) || p.length < 2) continue;
          var f = p[0], t = p[1];
          if (typeof f !== 'number' || typeof t !== 'number') continue;
          if (f < 0 || f > 89 || t < 0 || t > 89) continue;
          mv.push([f, t]);
        }
        out.push({
          t: r.t,
          mode: r.mode === 1 ? 1 : 0,
          level: Math.max(1, Math.min(4, Number(r.level) || 2)),
          humanRed: r.humanRed !== false,
          winner: r.winner === 1 ? 1 : (r.winner === 2 ? 2 : 0),
          reason: String(r.reason || ''),
          moves: mv
        });
      }
      return out;
    } catch (e) { return []; }
  }

  function saveHistory() {
    if (!S.over || S.saved || !S.history.length) return;
    S.saved = true;
    try {
      var rec = {
        t: Date.now(),
        mode: S.mode === 1 ? 1 : 0,
        level: S.level,
        humanRed: S.humanRed,
        winner: S.winner,
        reason: S.reason,
        moves: S.history.map(function (m) { return [m.f, m.t]; })
      };
      var all = loadHistory();
      all.unshift(rec);
      if (all.length > 200) all = all.slice(0, 200);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
    } catch (e) { }
  }

  function removeHistory(t) {
    try {
      var all = loadHistory().filter(function (r) { return r.t !== t; });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
    } catch (e) { }
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { }
  }

  /** 从开局摆到第 n 手的盘面 */
  function boardAt(moves, n) {
    var b = newBoard();
    var upto = Math.max(0, Math.min(n, moves.length));
    for (var i = 0; i < upto; i++) {
      var f = moves[i][0], t = moves[i][1];
      b[t] = b[f]; b[f] = 0;
    }
    return b;
  }

  /** 前 n 手的中文记谱 */
  function notesAt(moves, n) {
    var out = [], b = newBoard();
    var upto = Math.max(0, Math.min(n, moves.length));
    for (var i = 0; i < upto; i++) {
      var f = moves[i][0], t = moves[i][1];
      out.push(moveText(b, { f: f, t: t, c: b[t] }));
      b[t] = b[f]; b[f] = 0;
    }
    return out;
  }

  /** 用同一个绘制器画一份只读盘面（历史复盘用，不改当前对局） */
  function drawSnapshot(c, sidePx, board, lastFrom, lastTo) {
    var keep = {
      board: S.board, selected: S.selected, targets: S.targets,
      lastFrom: S.lastFrom, lastTo: S.lastTo, hintFrom: S.hintFrom, hintTo: S.hintTo
    };
    S.board = board; S.selected = -1; S.targets = [];
    S.lastFrom = lastFrom; S.lastTo = lastTo;
    S.hintFrom = -1; S.hintTo = -1;
    drawBoard(c, sidePx);
    S.board = keep.board; S.selected = keep.selected; S.targets = keep.targets;
    S.lastFrom = keep.lastFrom; S.lastTo = keep.lastTo;
    S.hintFrom = keep.hintFrom; S.hintTo = keep.hintTo;
  }

  function status() {
    if (S.over) return { text: S.result, sub: '点「新局」再来一盘' };
    if (S.thinking) {
      return { text: (S.mode === 0 && S.turnBlack === (!S.humanRed)) ? 'AI 思考中…' : '计算中…', sub: '难度：' + LEVELS[S.level - 1].name };
    }
    var check = kingAttacked(S.board, S.turnBlack);
    return {
      text: (S.turnBlack ? '黑方行棋' : '红方行棋') + (check ? '  · 将军！' : ''),
      sub: '第 ' + ((S.history.length >> 1) + 1) + ' 回合 · 难度：' + LEVELS[S.level - 1].name +
           (S.mode === 1 ? ' · 双人' : '')
    };
  }

  return {
    state: S,
    levels: LEVELS,
    reset: reset,
    draw: function (ctx, side) { S.ctx = ctx; S.side = side; drawBoard(ctx, side); },
    click: click,
    status: status,
    undo: undo,
    hint: hint,
    resign: resign,
    setMode: function (m) { S.mode = m; S.aiToken++; S.thinking = false; notify(); maybeAI(); },
    setHumanRed: function (red) { S.humanRed = red; reset(); },
    setLevel: function (lv) { S.level = lv; notify(); },
    setOnUpdate: function (fn) { S.onUpdate = fn; },
    notes: function () { return S.notes; },
    history: loadHistory,
    removeHistory: removeHistory,
    clearHistory: clearHistory,
    boardAt: boardAt,
    notesAt: notesAt,
    drawSnapshot: drawSnapshot,
    turnBlack: function () { return S.turnBlack; },
    canHumanMove: function () {
      if (S.over || S.thinking) return false;
      if (S.mode === 1) return true;
      return S.turnBlack === (!S.humanRed);
    },
    // 仅供测试脚本调用，页面不使用
    _dev: {
      newBoard: newBoard, legalMoves: legalMoves, applyMove: applyMove, undoMove: undoMove,
      kingAttacked: kingAttacked, idx: idx, X: X, Y: Y, toFen: toFen, moveText: moveText,
      searchBest: searchBest,
      playMove: playMove,
      setBoard: function (b, turnBlack) { S.board = b; S.turnBlack = turnBlack; S.history = []; S.caps = []; },
      board: function () { return S.board; }
    }
  };
})();
