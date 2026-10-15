// 角色與縮圖繪製（大廳 UI 也會呼叫 drawThumb / drawIcon）
import { W, H, INK, PI, mk, rng } from './core';
import { THEMES, ANIMALS } from './themes';
import { genMask, paintTerrain } from './terrainGen';

type Ctx = CanvasRenderingContext2D;

export function drawAnimal(c: Ctx, x: number, y: number, kind: string, team: string, face: number, aimA: number, sc: number, wcol: string | null) {
  const A = ANIMALS[kind] || ANIMALS.hamster; c.save(); c.translate(x, y); c.scale(face * sc, sc); c.lineWidth = 2.2; c.strokeStyle = INK; c.lineJoin = 'round';
  const R = 11, fs = () => { c.fill(); c.stroke(); };
  if (kind === 'squirrel') { c.fillStyle = A.body; c.beginPath(); c.ellipse(-12, -9, 7, 13, -.35, 0, 7); fs(); c.fillStyle = A.belly; c.beginPath(); c.ellipse(-11, -12, 3, 6, -.35, 0, 7); c.fill(); }
  if (kind === 'fox') { c.fillStyle = A.body; c.beginPath(); c.ellipse(-13, 3, 10, 5, .5, 0, 7); fs(); c.fillStyle = '#fff'; c.beginPath(); c.ellipse(-20, 7, 3.5, 3, .5, 0, 7); c.fill(); }
  if (kind === 'hedgehog') {
    c.fillStyle = A.spike!;
    for (let i = 0; i < 7; i++) { const a = PI * .55 + i * PI * .17, a1 = a - .18, a2 = a + .18; c.beginPath(); c.moveTo(Math.cos(a1) * 9, Math.sin(a1) * 9); c.lineTo(Math.cos(a) * 17, Math.sin(a) * 17); c.lineTo(Math.cos(a2) * 9, Math.sin(a2) * 9); fs(); }
  }
  c.fillStyle = A.body;
  if (kind === 'hamster') { c.beginPath(); c.arc(-6, -10, 4, 0, 7); fs(); c.beginPath(); c.arc(5, -10, 4, 0, 7); fs(); }
  if (kind === 'rabbit') {
    for (const [ex, r] of [[-4, -.2], [3, .2]]) { c.fillStyle = A.body; c.beginPath(); c.ellipse(ex, -17, 3.6, 9, r, 0, 7); fs(); c.fillStyle = A.inner!; c.beginPath(); c.ellipse(ex, -17, 1.6, 6, r, 0, 7); c.fill(); }
    c.fillStyle = A.body;
  }
  if (kind === 'fox') { c.beginPath(); c.moveTo(-8, -6); c.lineTo(-6, -19); c.lineTo(0, -10); fs(); c.beginPath(); c.moveTo(2, -10); c.lineTo(8, -19); c.lineTo(10, -5); fs(); }
  if (kind === 'squirrel') { c.beginPath(); c.moveTo(-5, -9); c.lineTo(-3, -17); c.lineTo(1, -10); fs(); c.beginPath(); c.moveTo(3, -10); c.lineTo(6, -17); c.lineTo(8, -8); fs(); }
  if (kind === 'hedgehog') { c.beginPath(); c.arc(3, -10, 3, 0, 7); fs(); }
  c.beginPath(); c.arc(0, 0, R, 0, 7); fs();
  c.fillStyle = A.belly; c.beginPath(); kind === 'penguin' ? c.ellipse(3, 2, 7.5, 8.5, 0, 0, 7) : c.ellipse(3, 4.5, 6.5, 5.5, 0, 0, 7); c.fill();
  c.save(); c.beginPath(); c.arc(0, 0, R - 1, 0, 7); c.clip(); c.fillStyle = team; c.fillRect(-R, -8, 2 * R, 5); c.restore();
  c.strokeStyle = team; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-10, -6); c.lineTo(-16, -9); c.moveTo(-10, -5); c.lineTo(-15, -2); c.stroke();
  c.strokeStyle = INK; c.lineWidth = 2.2; c.beginPath(); c.arc(0, 0, R, 0, 7); c.stroke();
  c.fillStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(5, -1, 3.6, 0, 7); c.fill(); c.stroke();
  c.fillStyle = INK; c.beginPath(); c.arc(5.6 + Math.cos(aimA) * 1.1, -1 + Math.sin(aimA) * 1.3, 1.7, 0, 7); c.fill();
  if (kind === 'penguin') { c.fillStyle = A.beak!; c.beginPath(); c.moveTo(9, 1); c.lineTo(14.5, 3); c.lineTo(9, 5); c.closePath(); c.fill(); c.stroke(); }
  else { c.fillStyle = INK; c.beginPath(); c.arc(10.4, 2.5, 1.6, 0, 7); c.fill(); }
  c.fillStyle = 'rgba(255,90,120,.45)'; c.beginPath(); c.arc(3, 5, 2.3, 0, 7); c.fill();
  if (wcol) { const dx = Math.cos(aimA), dy = Math.sin(aimA); c.lineCap = 'round'; c.strokeStyle = INK; c.lineWidth = 7; c.beginPath(); c.moveTo(2, 3); c.lineTo(2 + dx * 17, 3 + dy * 17); c.stroke(); c.strokeStyle = wcol; c.lineWidth = 4; c.stroke(); }
  c.restore();
}

export function drawThumb(cv: HTMLCanvasElement, id: string, seed?: number) {
  const th = THEMES.find(t => t.id === id) || THEMES[0]; const w = cv.width, h = cv.height, s = w / W, R = rng(seed || 7);
  const m = mk(w, h), mc = m.getContext('2d')!; mc.scale(s, h / H); genMask(mc, th, R); const t = paintTerrain(m, th, s, R);
  const c = cv.getContext('2d')!; const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]); c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (th.dark) { c.fillStyle = '#fff'; for (let i = 0; i < 30; i++) { c.globalAlpha = .6 * R(); c.fillRect(R() * w, R() * h * .7, 1.5, 1.5); } c.globalAlpha = 1; }
  c.drawImage(t, 0, 0); c.fillStyle = th.water; c.globalAlpha = .85; c.fillRect(0, (H - 45) * h / H, w, h); c.globalAlpha = 1;
}

export function drawIcon(cv: HTMLCanvasElement, animal: string, color: string) {
  const c = cv.getContext('2d')!; c.clearRect(0, 0, cv.width, cv.height);
  drawAnimal(c, cv.width / 2 + cv.width * .04, cv.height * .6, animal, color, 1, -.15, cv.width / 40, null);
}
