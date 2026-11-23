/* ============================================================
 * 围棋 · 网页端渲染与交互
 * 依赖 go-engine.js（GoEngine.GoGame）
 * ============================================================ */
(function () {
  'use strict';

  var G = window.GoEngine;

  var GoUI = {
    game: null,
    n: 19,

    ensure: function (n) {
      if (!this.game || this.n !== n) {
        this.game = new G.GoGame(n);
        this.n = n;
      }
      return this.game;
    },

    /** 用服务端棋步重建盘面（保留终局死子标记） */
    sync: function (n, moves) {
      var g = this.ensure(n);
      var dead = g.dead;
      g.replay(moves || []);
      g.dead = dead;   // replay 会清空，这里恢复，否则数子标记会被轮询冲掉
      return g;
    },

    margin: function (side) { return side * 0.048; },
    cell: function (side) { return (side - this.margin(side) * 2) / (this.n - 1); },
    px: function (side, x) { return this.margin(side) + x * this.cell(side); },
    py: function (side, y) { return this.margin(side) + y * this.cell(side); },

    stars: function (n) {
      var e = n - 4, c = Math.floor(n / 2);
      if (n >= 19) return [[3, 3], [e, 3], [3, e], [e, e], [c, 3], [c, e], [3, c], [e, c], [c, c]];
      return [[3, 3], [e, 3], [c, c], [3, e], [e, e]];
    },

    draw: function (ctx, side, opt) {
      var n = this.n, g = this.game;
      var m = this.margin(side), cs = this.cell(side);
      var i, x, y;

      // 木色底
      var grd = ctx.createLinearGradient(0, 0, side, side);
      grd.addColorStop(0, '#F7DDAD');
      grd.addColorStop(0.55, '#E7C089');
      grd.addColorStop(1, '#D1A35C');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, side, side);

      // 木纹
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = '#78541E';
      ctx.lineWidth = Math.max(0.8, side / 700);
      for (i = 1; i < 14; i++) {
        var yy2 = side * i / 14;
        ctx.beginPath();
        ctx.moveTo(0, yy2);
        ctx.bezierCurveTo(side * 0.33, yy2 + side * 0.005, side * 0.66, yy2 - side * 0.007, side, yy2 + side * 0.002);
        ctx.stroke();
      }
      ctx.restore();

      // 网格
      ctx.strokeStyle = 'rgba(104,76,34,0.9)';
      ctx.lineWidth = Math.max(1, side / 620);
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        ctx.moveTo(m, m + i * cs); ctx.lineTo(side - m, m + i * cs);
        ctx.moveTo(m + i * cs, m); ctx.lineTo(m + i * cs, side - m);
      }
      ctx.stroke();

      // 星位
      ctx.fillStyle = 'rgba(104,76,34,0.95)';
      var sr = Math.max(2, cs * 0.092);
      var stars = this.stars(n);
      for (i = 0; i < stars.length; i++) {
        x = stars[i][0]; y = stars[i][1];
        ctx.beginPath();
        ctx.arc(this.px(side, x), this.py(side, y), sr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!g) return;

      // 棋子
      var r = cs * 0.46;
      for (i = 0; i < g.board.length; i++) {
        var c = g.board[i];
        if (!c) continue;
        x = i % n; y = (i / n) | 0;
        this.stone(ctx, this.px(side, x), this.py(side, y), r, c, 1);
      }

      // 终局/数子模式下标记的死子
      if (opt && opt.scoreMode) {
        for (var k in g.dead) {
          if (!g.dead[k]) continue;
          var di = +k;
          if (g.board[di] === 0) continue;
          var dx = this.px(side, di % n), dy = this.py(side, (di / n) | 0);
          ctx.fillStyle = 'rgba(30,34,42,0.62)';
          ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#E0605A'; ctx.lineWidth = Math.max(2, cs * 0.075);
          var q = r * 0.55;
          ctx.beginPath();
          ctx.moveTo(dx - q, dy - q); ctx.lineTo(dx + q, dy + q);
          ctx.moveTo(dx + q, dy - q); ctx.lineTo(dx - q, dy + q);
          ctx.stroke();
        }
      }

      // 最后一手
      var last = null;
      for (i = g.moves.length - 1; i >= 0; i--) {
        if (g.moves[i][0] >= 0) { last = g.moves[i]; break; }
        break;
      }
      if (last) {
        var lx = this.px(side, last[0]), ly = this.py(side, last[1]);
        var lc = g.board[last[1] * n + last[0]];
        ctx.strokeStyle = (lc === 2) ? 'rgba(200,70,66,0.95)' : 'rgba(232,120,110,0.95)';
        ctx.lineWidth = Math.max(1.6, cs * 0.075);
        ctx.beginPath();
        ctx.arc(lx, ly, Math.max(3, cs * 0.19), 0, Math.PI * 2);
        ctx.stroke();
      }
    },

    stone: function (ctx, cx, cy, r, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      // 影子
      ctx.fillStyle = 'rgba(60,40,10,0.22)';
      ctx.beginPath();
      ctx.arc(cx + r * 0.12, cy + r * 0.16, r, 0, Math.PI * 2);
      ctx.fill();

      var grd = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r * 1.05);
      if (color === 1) {
        grd.addColorStop(0, '#7A828F');
        grd.addColorStop(0.45, '#2B3038');
        grd.addColorStop(1, '#0A0D12');
      } else {
        grd.addColorStop(0, '#FFFFFF');
        grd.addColorStop(0.6, '#F2F4F7');
        grd.addColorStop(1, '#C4C9D1');
      }
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = (color === 1) ? 'rgba(0,0,0,0.5)' : 'rgba(120,128,140,0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    },

    /** 屏幕坐标 → 交叉点 */
    hit: function (side, sx, sy) {
      var cs = this.cell(side), m = this.margin(side);
      var gx = Math.round((sx - m) / cs);
      var gy = Math.round((sy - m) / cs);
      if (gx < 0 || gy < 0 || gx >= this.n || gy >= this.n) return null;
      if (Math.abs(sx - this.px(side, gx)) > cs * 0.62) return null;
      if (Math.abs(sy - this.py(side, gy)) > cs * 0.62) return null;
      return { x: gx, y: gy };
    }
  };

  window.GoUI = GoUI;
})();
