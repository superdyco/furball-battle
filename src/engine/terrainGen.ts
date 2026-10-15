// 地形生成：genMask 產生碰撞遮罩的形狀，paintTerrain 依遮罩繪製外觀。
import { W, H, INK, PI, clamp, mk, tint, type Rng } from './core';
import type { Theme } from './themes';

type Ctx = CanvasRenderingContext2D;

function hf(R: Rng, base: number, amps: number[]) {
  const ph = amps.map(() => R() * 6.283), fr = amps.map((a, i) => (.0025 + R() * .002) * (1 + i * 1.8));
  return (x: number) => { let y = base; for (let i = 0; i < amps.length; i++) y += amps[i] * Math.sin(x * fr[i] + ph[i]); return y; };
}

function poly(c: Ctx, f: (x: number) => number, x0: number, x1: number, bot: number) {
  c.beginPath(); c.moveTo(x0, bot);
  for (let x = x0; x <= x1; x += 6) c.lineTo(x, f(x));
  c.lineTo(x1, f(x1)); c.lineTo(x1, bot); c.closePath(); c.fill();
}

function cut(c: Ctx, fn: () => void) { c.save(); c.globalCompositeOperation = 'destination-out'; fn(); c.restore(); }

export function genMask(c: Ctx, th: Theme, R: Rng) {
  c.fillStyle = '#000'; const B = H + 40;
  switch (th.gen) {
    case 'hills': poly(c, hf(R, H * .58, [85, 40, 12]), 0, W, B); break;
    case 'dunes': poly(c, hf(R, H * .62, [75, 26]), 0, W, B); break;
    case 'snow': { const f = hf(R, H * .62, [50, 25, 10]), p = R() * 6; poly(c, x => f(x) - 110 * Math.abs(Math.sin(x * .0042 + p)), 0, W, B); break; }
    case 'volcano': {
      const n = hf(R, 0, [30, 12]); const f = (x: number) => H * .8 - 420 * Math.exp(-(((x - W / 2) / 300) ** 2)) + n(x);
      poly(c, f, 0, W, B); cut(c, () => { c.beginPath(); c.arc(W / 2, f(W / 2) + 25, 70, 0, 7); c.fill(); }); break;
    }
    case 'islands': {
      const k = 3 + (R() < .5 ? 1 : 0), seg = W / k, f = hf(R, H * .6, [50, 20]);
      for (let i = 0; i < k; i++) {
        const a = i * seg + 30 + R() * 50, b = (i + 1) * seg - 30 - R() * 50;
        poly(c, x => { const t = clamp((x - a) / (b - a), 0, 1); return f(x) + (1 - Math.pow(Math.sin(PI * t), .4)) * 320; }, a, b, B);
      }
      break;
    }
    case 'cave': {
      poly(c, hf(R, H * .72, [60, 25]), 0, W, B); const g = hf(R, H * .2, [50, 25]);
      c.beginPath(); c.moveTo(0, -20); for (let x = 0; x <= W; x += 6) c.lineTo(x, g(x)); c.lineTo(W, -20); c.closePath(); c.fill();
      for (let i = 0; i < 4; i++) {
        const x = 200 + R() * (W - 400), y = g(x) - 5, h = 80 + R() * 110, w = 30 + R() * 30;
        c.beginPath(); c.moveTo(x - w, y); c.lineTo(x, y + h); c.lineTo(x + w, y); c.fill();
      }
      break;
    }
    case 'city': {
      const f = hf(R, H * .8, [18, 8]); poly(c, f, 0, W, B); let x = 50;
      while (x < W - 120) {
        const w = 70 + R() * 70, h = 120 + R() * 300, gy = f(x + w / 2) + 10; c.fillRect(x, gy - h, w, h + 20);
        if (R() < .7) cut(c, () => { for (let yy = gy - h + 25; yy < gy - 40; yy += 55) if (R() < .6) c.fillRect(x + 15, yy, w - 30, 26); });
        if (R() < .4) { const cx = x + w * R(), r = 30 + R() * 30; cut(c, () => { c.beginPath(); c.arc(cx, gy - h, r, 0, 7); c.fill(); }); }
        x += w + 40 + R() * 90;
      }
      break;
    }
    case 'candy': {
      const f = hf(R, H * .64, [55, 22]); poly(c, f, 0, W, B);
      for (let i = 0; i < 6; i++) { const x = 100 + R() * (W - 200), r = 35 + R() * 35; c.beginPath(); c.arc(x, f(x) + 8, r, PI, 0); c.fill(); }
      for (let i = 0; i < 2; i++) { const x = 300 + R() * (W - 600), y = f(x); c.fillRect(x - 7, y - 170, 14, 175); c.beginPath(); c.arc(x, y - 200, 50, 0, 7); c.fill(); }
      break;
    }
    case 'forest': {
      const f = hf(R, H * .64, [55, 22]); poly(c, f, 0, W, B);
      for (let i = 0; i < 5; i++) {
        const x = 150 + i * (W - 300) / 4 + (R() - .5) * 120, y = f(x), h = 150 + R() * 110; c.fillRect(x - 13, y - h, 26, h + 10);
        for (let j = 0; j < 3; j++) { c.beginPath(); c.arc(x + (j - 1) * 45, y - h - (j === 1 ? 30 : 0), 45 + R() * 20, 0, 7); c.fill(); }
      }
      break;
    }
    case 'moon': {
      const f = hf(R, H * .6, [60, 25]); poly(c, f, 0, W, B); const cs: [number, number][] = [];
      for (let i = 0; i < 6; i++) cs.push([100 + R() * (W - 200), 40 + R() * 45]);
      cut(c, () => { for (const [x, r] of cs) { c.beginPath(); c.arc(x, f(x) - r * .25, r, 0, 7); c.fill(); } }); break;
    }
    case 'factory': {
      c.fillRect(0, H * .8, W, B);
      for (let i = 0; i < 5; i++) c.fillRect(R() * (W - 200), H * .8 - 40 - R() * 40, 80 + R() * 120, 90);
      for (let i = 0; i < 8; i++) {
        const w = 150 + R() * 170, x = (i % 4) * (W / 4) + R() * (W / 4 - w), y = 230 + (i >> 2) * 190 + R() * 90;
        c.beginPath(); c.roundRect(x, y, w, 26 + R() * 16, 8); c.fill();
      }
      break;
    }
    case 'station': {
      for (let i = 0; i < 10; i++) {
        const col = i % 5, row = i / 5 | 0, w = 180 + R() * 130, h = 45 + R() * 55, x = col * (W / 5) + R() * (W / 5 - w) * .9 + 10, y = 260 + row * 230 + R() * 80;
        c.beginPath(); c.roundRect(x, y, w, h, 22); c.fill();
      }
      c.beginPath(); c.roundRect(W / 2 - 160, H * .78, 320, 70, 30); c.fill(); break;
    }
  }
}

function pattern(b: Ctx, th: Theme, w: number, h: number, s: number, R: Rng) {
  const n = (k: number) => Math.round(w * h / (k * s * s)); b.save();
  switch (th.p) {
    case 'dots': b.fillStyle = th.pat; for (let i = 0; i < n(1100); i++) { b.beginPath(); b.arc(R() * w, R() * h, (2 + R() * 6) * s, 0, 7); b.fill(); } break;
    case 'stripes': case 'hazard': {
      const hz = th.p === 'hazard'; b.strokeStyle = th.pat; b.lineWidth = (hz ? 16 : 9) * s; const sp = (hz ? 46 : 30) * s;
      for (let x = -h; x < w; x += sp) { b.beginPath(); b.moveTo(x, 0); b.lineTo(x + h, h); b.stroke(); }
      break;
    }
    case 'rocks':
      for (let i = 0; i < n(2500); i++) {
        const x = R() * w, y = R() * h, r = (4 + R() * 10) * s; b.fillStyle = th.pat; b.beginPath(); b.ellipse(x, y, r, r * .7, R() * 3, 0, 7); b.fill();
        b.fillStyle = 'rgba(255,255,255,.15)'; b.beginPath(); b.arc(x - r * .3, y - r * .3, r * .3, 0, 7); b.fill();
      }
      break;
    case 'bricks': { b.strokeStyle = th.pat; b.lineWidth = 3 * s; const bh = 24 * s, bw = 50 * s; for (let y = 0, r = 0; y < h; y += bh, r++) for (let x = (r % 2) * -bw / 2; x < w; x += bw) b.strokeRect(x, y, bw, bh); break; }
    case 'sprinkles': {
      const cols = ['#ffffff', '#ffd23f', '#3dc7ff', '#8b5cf6', '#4cd964']; b.lineCap = 'round'; b.lineWidth = 5 * s;
      for (let i = 0; i < n(900); i++) {
        b.strokeStyle = cols[(R() * 5) | 0]; const x = R() * w, y = R() * h, a = R() * PI;
        b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(a) * 9 * s, y + Math.sin(a) * 9 * s); b.stroke();
      }
      break;
    }
    case 'craters': b.strokeStyle = th.pat; b.lineWidth = 3 * s; b.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < n(4000); i++) { b.beginPath(); b.arc(R() * w, R() * h, (6 + R() * 16) * s, 0, 7); b.fill(); b.stroke(); } break;
    case 'panels': {
      b.strokeStyle = th.pat; b.lineWidth = 3 * s; const pw = 60 * s, ph = 40 * s;
      for (let y = 0; y < h; y += ph) for (let x = 0; x < w; x += pw) b.strokeRect(x, y, pw, ph);
      b.fillStyle = th.top;
      for (let i = 0; i < n(9000); i++) { b.beginPath(); b.arc(Math.round(R() * w / pw) * pw + 6 * s, Math.round(R() * h / ph) * ph + 6 * s, 2.5 * s, 0, 7); b.fill(); }
      break;
    }
  }
  b.restore();
}

export function paintTerrain(mask: HTMLCanvasElement, th: Theme, s: number, R: Rng): HTMLCanvasElement {
  const w = mask.width, h = mask.height, out = mk(w, h), o = out.getContext('2d')!;
  const ink = tint(mask, INK), d = Math.max(1, 3.5 * s);
  for (let a = 0; a < 8; a++) o.drawImage(ink, Math.cos(a * PI / 4) * d, Math.sin(a * PI / 4) * d);
  const body = tint(mask, th.ground), b = body.getContext('2d')!; b.globalCompositeOperation = 'source-atop';
  pattern(b, th, w, h, s, R);
  const line = tint(mask, 'rgba(43,29,20,.5)'), lc = line.getContext('2d')!; lc.globalCompositeOperation = 'destination-out'; lc.drawImage(mask, 0, 18 * s);
  const top = tint(mask, th.top), tc = top.getContext('2d')!; tc.globalCompositeOperation = 'destination-out'; tc.drawImage(mask, 0, 14 * s);
  b.drawImage(line, 0, 0); b.drawImage(top, 0, 0);
  o.drawImage(body, 0, 0); return out;
}
