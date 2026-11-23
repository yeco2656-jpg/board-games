/* ============================================================
 * 围棋规则引擎（浏览器 + Node 共用）
 * 中国规则：数子、贴 7.5 目、禁自杀、禁全局同形再现（打劫）
 * 与桌面版 GoRules.cs 保持同一套判定口径
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function GoGame(n) {
    this.n = (n === 13 || n === 19) ? n : 19;
    this.board = new Int8Array(this.n * this.n);
    this.turn = BLACK;
    this.moves = [];
    this.capB = 0;          // 黑方提掉的白子
    this.capW = 0;          // 白方提掉的黑子
    this.passes = 0;
    this.over = false;
    this.komi = 7.5;
    this.dead = {};         // 终局标记的死子 index -> true
    this.posSet = {};
    this.posSet[this.board.join('')] = true;
    this._mark = new Int32Array(this.n * this.n);
    this._stamp = 0;
  }

  GoGame.EMPTY = EMPTY; GoGame.BLACK = BLACK; GoGame.WHITE = WHITE;

  GoGame.prototype.idx = function (x, y) { return y * this.n + x; };
  GoGame.prototype.inB = function (x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; };

  /** 某点所在块的气数 */
  GoGame.prototype.libs = function (b, x, y) {
    var n = this.n, c = b[y * n + x];
    if (!c) return 0;
    var mark = this._mark, st = ++this._stamp;
    var stack = [y * n + x], lib = 0;
    mark[y * n + x] = st;
    while (stack.length) {
      var i = stack.pop(), cx = i % n, cy = (i / n) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        var ni = ny * n + nx, v = b[ni];
        if (v === 0) { lib++; continue; }
        if (v !== c || mark[ni] === st) continue;
        mark[ni] = st; stack.push(ni);
      }
    }
    return lib;
  };

  /** 取块内所有点 */
  GoGame.prototype.chain = function (b, x, y) {
    var n = this.n, c = b[y * n + x], out = [];
    if (!c) return out;
    var mark = this._mark, st = ++this._stamp;
    var stack = [y * n + x];
    mark[y * n + x] = st;
    while (stack.length) {
      var i = stack.pop(); out.push(i);
      var cx = i % n, cy = (i / n) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        var ni = ny * n + nx;
        if (b[ni] !== c || mark[ni] === st) continue;
        mark[ni] = st; stack.push(ni);
      }
    }
    return out;
  };

  /** 在给定盘面试算，返回 null=合法，否则返回中文原因 */
  GoGame.prototype.checkOn = function (b, x, y, color) {
    var n = this.n, i = y * n + x;
    if (b[i] !== 0) return '该点已有棋子';
    var opp = 3 - color;
    b[i] = color;
    for (var d = 0; d < 4; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (!this.inB(nx, ny)) continue;
      var ni = ny * n + nx;
      if (b[ni] !== opp) continue;
      if (this.libs(b, nx, ny) === 0) {
        var ch = this.chain(b, nx, ny);
        for (var k = 0; k < ch.length; k++) b[ch[k]] = 0;
      }
    }
    b[i] = color;
    if (this.libs(b, x, y) === 0) return '禁着点（自杀）';
    if (this.posSet[b.join('')]) return '打劫（同形再现）';
    return null;
  };

  GoGame.prototype.check = function (x, y) {
    if (this.over) return '对局已结束';
    if (!this.inB(x, y)) return '越界';
    if (this.board[this.idx(x, y)] !== 0) return '该点已有棋子';
    return this.checkOn(Int8Array.prototype.slice.call(this.board), x, y, this.turn);
  };

  /** 落子，返回 { ok, error } */
  GoGame.prototype.play = function (x, y) {
    var err = this.check(x, y);
    if (err) return { ok: false, error: err };

    var n = this.n, color = this.turn, opp = 3 - color, i = y * n + x;
    this.board[i] = color;
    var captured = 0;
    for (var d = 0; d < 4; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (!this.inB(nx, ny)) continue;
      var ni = ny * n + nx;
      if (this.board[ni] !== opp) continue;
      if (this.libs(this.board, nx, ny) === 0) {
        var ch = this.chain(this.board, nx, ny);
        for (var k = 0; k < ch.length; k++) this.board[ch[k]] = 0;
        captured += ch.length;
      }
    }
    if (captured) {
      if (color === BLACK) this.capB += captured; else this.capW += captured;
    }
    this.moves.push([x, y, color]);
    this.posSet[this.board.join('')] = true;
    this.passes = 0;
    this.turn = opp;
    return { ok: true, captured: captured };
  };

  GoGame.prototype.pass = function () {
    if (this.over) return { ok: false, error: '对局已结束' };
    this.moves.push([-1, -1, this.turn]);
    this.passes++;
    this.turn = 3 - this.turn;
    if (this.passes >= 2) this.over = true;
    return { ok: true };
  };

  /** 用棋步序列重建盘面（联机同步用） */
  GoGame.prototype.replay = function (moves) {
    this.board = new Int8Array(this.n * this.n);
    this.turn = BLACK; this.moves = []; this.capB = 0; this.capW = 0;
    this.passes = 0; this.over = false; this.dead = {};
    this.posSet = {}; this.posSet[this.board.join('')] = true;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      this.turn = m[2];
      if (m[0] < 0) this.pass(); else this.play(m[0], m[1]);
    }
  };

  /** 数子（中国规则） */
  GoGame.prototype.score = function () {
    var n = this.n, i, x, y, d, nx, ny, ni;
    var b = Int8Array.prototype.slice.call(this.board);
    for (var k in this.dead) if (this.dead[k]) b[+k] = 0;

    var bs = 0, ws = 0;
    for (i = 0; i < b.length; i++) { if (b[i] === BLACK) bs++; else if (b[i] === WHITE) ws++; }

    var seen = new Uint8Array(b.length), bt = 0, wt = 0, neutral = 0;
    for (i = 0; i < b.length; i++) {
      if (b[i] !== 0 || seen[i]) continue;
      var q = [i], tb = false, tw = false, cnt = 0;
      seen[i] = 1;
      while (q.length) {
        var p = q.pop(); cnt++;
        x = p % n; y = (p / n) | 0;
        for (d = 0; d < 4; d++) {
          nx = x + DIRS[d][0]; ny = y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          ni = ny * n + nx;
          if (b[ni] === BLACK) { tb = true; continue; }
          if (b[ni] === WHITE) { tw = true; continue; }
          if (seen[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      if (tb && !tw) bt += cnt; else if (tw && !tb) wt += cnt; else neutral += cnt;
    }

    var blackScore = bs + bt, whiteScore = ws + wt + this.komi;
    return {
      blackStones: bs, whiteStones: ws,
      blackTerritory: bt, whiteTerritory: wt, neutral: neutral,
      blackScore: blackScore, whiteScore: whiteScore,
      winner: blackScore > whiteScore ? BLACK : (whiteScore > blackScore ? WHITE : 0),
      margin: Math.abs(blackScore - whiteScore)
    };
  };

  /** 坐标名：围棋习惯去掉 I，A..T */
  GoGame.prototype.coordName = function (x, y) {
    var letters = 'ABCDEFGHJKLMNOPQRST';
    return (letters[x] || (x + 1)) + (this.n - y);
  };

  return { GoGame: GoGame, BLACK: BLACK, WHITE: WHITE, EMPTY: EMPTY };
});
