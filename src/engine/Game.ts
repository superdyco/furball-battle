import { W, H, INK, PI, clamp, rng, mk, type Rng } from './core';
import { THEMES, type Theme } from './themes';
import { genMask, paintTerrain } from './terrainGen';
import { drawAnimal } from './art';
import { WEAPONS, WMAP, type WeaponDef } from './weapons';
import { HP, EXPLOSION, PHYSICS, TURN, CRATES, weaponSpec, WEAPON_BY_ID } from '../config/GameBalance';
import { explosionFalloff, explosionDamage, explosionImpulse, fallDamage, damageCredit, hpAfterDamage, hpAfterHeal, displayHp, isDying } from '../systems/DamageSystem';
import type {
  GameConfig, GameCallbacks, Team, Unit, Projectile, Particle, Flame, Mine, Crate, FloatText, Point,
  AiState, AiPlan, Hud, NetHooks,
} from './types';

const KEYMAP: Record<string, string> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Enter: 'jump', Space: 'fire' };
const BOOMS = ['砰!', '轟!', '碰!', '咚!', '嘣!'];

type GameState = 'aim' | 'retreat' | 'settle' | 'over';
interface PtrState { id: number; sx: number; sy: number; type: string; btn: number; moved: boolean; cx: number; cy: number; done?: boolean; firing?: boolean }
type ExplodeOpts = { kb?: number; quiet?: number };

export class Game {
  el: HTMLElement; cfg: GameConfig; cb: GameCallbacks;
  th: Theme; R: Rng; g: number;
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  mask: Uint8Array; terrain: HTMLCanvasElement; tctx: CanvasRenderingContext2D;
  waterY: number;
  proj: Projectile[] = []; parts: Particle[] = []; flames: Flame[] = []; mines: Mine[] = []; crates: Crate[] = []; texts: FloatText[] = []; graves: Point[] = [];
  frame = 0; wind = 0; shake = 0; keys: Record<string, boolean> = {}; msg = ''; msgT = 0; turnCount = 0; state: GameState = 'aim';
  units: Unit[] = []; teams: Team[];
  clouds: { x: number; y: number; s: number }[]; stars: { x: number; y: number; r: number }[];
  teamTurn = -1; camX = 0; camY = 0; zoom = 1; pts = new Map<number, Point>();
  vw!: number; vh!: number; dpr!: number; s!: number;
  ro: ResizeObserver; acc = 0; last: number; raf: number;
  camFree?: boolean; ptr?: PtrState | null; pinch?: { d0: number; z0: number } | null;
  mouseS?: Point | null; mouseW?: Point;
  kd!: (e: KeyboardEvent) => void; ku!: (e: KeyboardEvent) => void;
  jumpQ?: boolean; idle?: boolean; charging?: boolean; power = 0; target: Point | null = null;
  retreatT = 0; timeLeft = 0; settleT = 0; turnDmg?: number; ai: AiState | null = null; lastHud?: string;
  /** 連線模式掛勾；本機模式為 undefined，所有行為與原版相同 */
  net?: NetHooks;

  constructor(el: HTMLElement, cfg: GameConfig, cb?: GameCallbacks) {
    this.el = el; this.cfg = cfg; this.cb = cb || {};
    this.th = THEMES.find(t => t.id === cfg.themeId) || THEMES[0];
    this.R = rng(cfg.seed || (Math.random() * 1e9));
    this.g = PHYSICS.baseGravity * this.th.grav * (cfg.gravity || 1);
    this.cv = mk(10, 10); this.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:crosshair';
    el.appendChild(this.cv); this.ctx = this.cv.getContext('2d')!;
    const m = mk(W, H), mc = m.getContext('2d')!; genMask(mc, this.th, this.R);
    const d = mc.getImageData(0, 0, W, H).data; this.mask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) this.mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    this.terrain = paintTerrain(m, this.th, 1, this.R); this.tctx = this.terrain.getContext('2d')!;
    this.waterY = PHYSICS.waterLevel;
    const pts = this.spawnPoints(); for (let i = pts.length - 1; i > 0; i--) { const j = (this.R() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    const used: Point[] = [];
    const take = (): Point => {
      for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (used.every(q => Math.abs(q.x - p.x) > 60 || Math.abs(q.y - p.y) > 60)) { used.push(p); pts.splice(i, 1); return p; } }
      return pts.pop() || { x: 100 + this.R() * (W - 200), y: 100 };
    };
    this.teams = cfg.teams.map((t, i) => {
      const T: Team = { ...t, idx: i, ammo: { ...cfg.ammo }, cur: -1, weapon: 'bazooka', units: [], dmg: 0, kills: 0, bestTurn: 0 };
      for (let k = 0; k < cfg.unitsPerTeam; k++) {
        const p = take();
        const u: Unit = { team: T, name: t.unitNames[k % t.unitNames.length], x: p.x, y: p.y, vx: 0, vy: 0, r: HP.unitRadius, hp: cfg.hp || HP.default, face: p.x < W / 2 ? 1 : -1, aimA: -.5, air: true, dead: false };
        T.units.push(u); this.units.push(u);
      }
      return T;
    });
    this.clouds = Array.from({ length: 7 }, () => ({ x: this.R() * 2000, y: 30 + this.R() * 160, s: .6 + this.R() * .8 }));
    this.stars = Array.from({ length: 110 }, () => ({ x: this.R(), y: this.R(), r: this.R() * 1.6 + .4 }));
    this.bind(); this.resize(); this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el);
    this.nextTurn(); const u = this.active(); if (u) { this.camX = u.x - this.vw / this.s / 2; this.camY = u.y - this.vh / this.s / 2; }
    this.last = performance.now(); this.loop = this.loop.bind(this);
    // 連線模式由 NetGame 控制更新節奏（需配合網路進度），不自行啟動迴圈
    this.raf = cfg.externalLoop ? 0 : requestAnimationFrame(this.loop);
  }

  /** 以外部提供的碰撞遮罩取代目前地形（連線同步），外觀圖樣使用獨立亂數，不影響遊戲亂數 */
  replaceMask(bits: Uint8Array) {
    this.mask = bits;
    const m = mk(W, H), mc = m.getContext('2d')!, img = mc.createImageData(W, H);
    for (let i = 0; i < W * H; i++) if (bits[i]) img.data[i * 4 + 3] = 255;
    mc.putImageData(img, 0, 0);
    this.terrain = paintTerrain(m, this.th, 1, rng(0x5eed)); this.tctx = this.terrain.getContext('2d')!;
  }
  spawnPoints() {
    const pts: Point[] = [];
    for (let x = 40; x < W - 40; x += 8) { let prev = false; for (let y = 0; y < this.waterY - 30; y += 2) { const s = this.solid(x, y); if (s && !prev && y > 30 && !this.hitC(x, y - 12, HP.unitRadius)) pts.push({ x, y: y - 11 }); prev = s; } }
    return pts;
  }
  resize() { const r = this.el.getBoundingClientRect(); this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height); this.dpr = Math.min(window.devicePixelRatio || 1, 2); this.cv.width = this.vw * this.dpr; this.cv.height = this.vh * this.dpr; this.s = Math.max(this.vw / W, this.vh / H) * (this.zoom || 1); }
  zoomAt(sx: number, sy: number, z: number) { const wx = sx / this.s + this.camX, wy = sy / this.s + this.camY; this.zoom = clamp(z, 1, 2.5); this.s = Math.max(this.vw / W, this.vh / H) * this.zoom; this.camX = wx - sx / this.s; this.camY = wy - sy / this.s; this.camFree = true; }
  setZoom(z: number) { this.zoomAt(this.vw / 2, this.vh / 2, z); }
  startPinch() { if (this.ptr && this.ptr.firing) this.fireUp(); this.ptr = null; const [a, b] = [...this.pts.values()]; this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.zoom }; }
  doPinch() { const v = [...this.pts.values()]; if (v.length < 2) return; const [a, b] = v, r = this.cv.getBoundingClientRect(); this.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, this.pinch!.z0 * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch!.d0); }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); window.removeEventListener('keydown', this.kd); window.removeEventListener('keyup', this.ku); this.cv.remove(); }
  bind() {
    this.kd = e => {
      const tg = e.target as HTMLElement | null;
      if (tg && /INPUT|TEXTAREA|SELECT/.test(tg.tagName)) return; const k = KEYMAP[e.code]; if (k) { e.preventDefault(); if (!e.repeat) this.input(k, true); }
      if (e.code === 'KeyE' || e.code === 'Tab') { e.preventDefault(); this.cb.onToggleWeapons && this.cb.onToggleWeapons(); }
    };
    this.ku = e => { const k = KEYMAP[e.code]; if (k) { e.preventDefault(); this.input(k, false); } };
    window.addEventListener('keydown', this.kd); window.addEventListener('keyup', this.ku);
    const cv = this.cv; cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.pts.size >= 2) { this.startPinch(); return; }
      const p = this.toW(e); this.ptr = { id: e.pointerId, sx: e.clientX, sy: e.clientY, type: e.pointerType, btn: e.button, moved: false, cx: this.camX, cy: this.camY };
      if (e.pointerType === 'mouse' && e.button === 0 && !this.isAI()) { if (this.needsTarget()) { this.setTarget(p); this.ptr.done = true; } else { this.aimAt(p); this.fireDown(); this.ptr.firing = true; } }
    });
    cv.addEventListener('pointermove', e => {
      if (this.pts.has(e.pointerId)) this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.pinch) { this.doPinch(); return; }
      const p = this.toW(e); if (e.pointerType === 'mouse') { const r = cv.getBoundingClientRect(); this.mouseS = { x: e.clientX - r.left, y: e.clientY - r.top }; this.mouseW = p; if (!this.ptr || this.ptr.firing) this.aimAt(p); }
      const P = this.ptr; if (P && P.id === e.pointerId && !P.firing) { const dx = e.clientX - P.sx, dy = e.clientY - P.sy; if (Math.hypot(dx, dy) > 10) P.moved = true; if (P.moved) { this.camFree = true; this.camX = P.cx - dx / this.s; this.camY = P.cy - dy / this.s; } }
    });
    const up = (e: PointerEvent) => {
      this.pts.delete(e.pointerId); if (this.pinch) { if (this.pts.size < 2) this.pinch = null; this.ptr = null; return; }
      const P = this.ptr; if (!P || P.id !== e.pointerId) return;
      if (P.firing) this.fireUp(); else if (P.type !== 'mouse' && !P.moved && !this.isAI()) { const p = this.toW(e); if (this.needsTarget()) this.setTarget(p); else this.aimAt(p); }
      this.ptr = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.mouseS = null; });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); if (e.ctrlKey) { const r = cv.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.zoom * Math.exp(-e.deltaY * .01)); return; }
      this.camFree = true; this.camX += (e.deltaX || e.deltaY) / this.s * .8;
    }, { passive: false });
  }
  toW(e: { clientX: number; clientY: number }): Point { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / this.s + this.camX, y: (e.clientY - r.top) / this.s + this.camY }; }
  // ---- 玩家輸入入口（滑鼠、鍵盤、觸控按鈕）。連線模式下改由 net 在幀邊界套用並記錄，以便對手重播
  input(k: string, down: boolean) { if (this.net) return this.net.ui(this, ['k', k, down ? 1 : 0]); this.applyKey(k, down); }
  aimAt(p: Point) { if (this.net) return this.net.ui(this, ['p', p.x, p.y]); this.doAimAt(p); }
  setTarget(p: Point) { if (this.net) return this.net.ui(this, ['t', p.x, p.y]); this.doSetTarget(p); }
  fireDown() { if (this.net) return this.net.ui(this, ['fd']); this.doFireDown(); }
  fireUp() { if (this.net) return this.net.ui(this, ['fu']); this.doFireUp(); }
  selectWeapon(id: string) { if (this.net) return this.net.ui(this, ['w', id]); this.doSelectWeapon(id); }
  applyKey(k: string, down: boolean) { if (this.isAI()) { this.keys = {}; return; } this.keys[k] = down; if (k === 'jump' && down) this.jumpQ = true; if (k === 'fire') down ? this.doFireDown() : this.doFireUp(); if (down) this.idle = false; }
  doSelectWeapon(id: string) { const T = this.team(); if (!T || T.ai || T.ammo[id] === 0 || !WMAP[id]) return; T.weapon = id; this.target = null; this.charging = false; this.emit(); }
  active(): Unit | undefined { const t = this.teams[this.teamTurn]; return t && t.units[t.cur]; }
  team(): Team { return this.teams[this.teamTurn]; }
  isAI() { const t = this.team(); return !!(t && t.ai); }
  weapon(): WeaponDef { return WMAP[this.team().weapon]; }
  alive() { return this.units.filter(u => !u.dead); }
  say(t: string, f?: number) { this.msg = t; this.msgT = f || 150; }
  solid(x: number, y: number) { x = x | 0; y = y | 0; if (x < 0 || x >= W || y < 0 || y >= H) return false; return this.mask[y * W + x] === 1; }
  hitC(x: number, y: number, r: number) { if (this.solid(x, y)) return true; for (let i = 0; i < 12; i++) { const a = i * PI / 6; if (this.solid(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true; } return false; }
  canAct() { const u = this.active(); return this.state === 'aim' && u && !u.dead && !u.grapple && !u.drill; }
  needsTarget() { if (this.state !== 'aim' || !this.team()) return false; const w = this.weapon(); return !!w.target && !(w.id === 'homing' && this.target); }
  doAimAt(p: Point) { const u = this.active(); if (this.isAI() || !u || u.dead || (this.state !== 'aim' && this.state !== 'retreat')) return; const dx = p.x - u.x, dy = p.y - u.y; if (Math.abs(dx) > 2) u.face = dx > 0 ? 1 : -1; u.aimA = clamp(Math.atan2(dy, Math.abs(dx)), -PHYSICS.aimLimit, PHYSICS.aimLimit); }
  doSetTarget(p: Point) {
    if (!this.canAct()) return; const w = this.weapon(), T = this.team(); if (T.ammo[w.id] === 0) return;
    if (w.id === 'homing') { this.target = p; this.say('目標已鎖定,蓄力發射!', 90); return; }
    if (w.id === 'airstrike') {
      const A = weaponSpec('airstrike'), S = A.special; this.consume(w);
      for (let i = 0; i < S.count; i++) this.spawnProj({ x: p.x + S.offsetX + i * S.spacing - this.wind * S.windLead, y: S.startY - i * S.stagger, vx: this.wind * S.windVx, vy: S.vy, kind: A.projectile.kind, wind: 1, r: A.warhead.r, dmg: A.warhead.dmg, color: w.color });
      this.say('空襲來了!', 90); this.endAct(); return;
    }
    if (w.id === 'teleport') {
      const T_ = weaponSpec('teleport'), S = T_.special;
      const u = this.active()!; if (p.x < S.edgeMargin || p.x > W - S.edgeMargin || p.y < S.minY || p.y > this.waterY - S.waterMargin || this.hitC(p.x, p.y, u.r)) { this.say('不能傳送到那裡', 80); return; }
      this.consume(w); this.sparkle(u.x, u.y); u.x = p.x; u.y = p.y; u.vx = 0; u.vy = 0; u.air = true; this.sparkle(u.x, u.y); this.endAct(T_.retreatFrames);
    }
  }
  doFireDown() {
    if (!this.canAct()) return; const w = this.weapon(), T = this.team(); if (T.ammo[w.id] === 0) { this.say('沒有彈藥了', 60); return; }
    if (w.charge) { if (w.target && !this.target) { this.say('先點選目標位置', 80); return; } this.charging = true; this.power = 0; return; }
    if (w.target) { this.say('點擊地圖選擇位置', 80); return; }
    this.fire(0);
  }
  doFireUp() { if (this.charging) this.fire(this.power); }
  consume(w: WeaponDef) { const T = this.team(); if (T.ammo[w.id] > 0) T.ammo[w.id]--; }
  endAct(t?: number) { this.state = 'retreat'; this.retreatT = t || TURN.retreatFrames; this.charging = false; }
  /** 依 GameBalance 的武器設定組出拋射物（欄位語意與原版相同：旗標以 1 表示） */
  launch(id: string, at: { x: number; y: number; vx: number; vy: number; owner?: Unit; color: string }, extra?: Partial<Projectile>) {
    const B = WEAPON_BY_ID[id], P = B.projectile!;
    return this.spawnProj({
      ...at, kind: P.kind,
      ...(B.wind ? { wind: 1 } : {}),
      ...(P.bounce != null ? { bounce: 1, damp: P.bounce } : {}),
      ...(P.fuse != null ? { fuse: P.fuse } : {}),
      ...(P.maxBounces != null ? { bmax: P.maxBounces } : {}),
      ...(B.warhead ? { r: B.warhead.r, dmg: B.warhead.dmg } : {}),
      ...extra,
    });
  }
  fire(p: number) {
    if (!this.canAct()) return; const u = this.active()!, w = this.weapon(); this.charging = false; this.idle = false;
    const dx = u.face * Math.cos(u.aimA), dy = Math.sin(u.aimA), sp = PHYSICS.shotSpeedMin + p * PHYSICS.shotSpeedRange, ox = u.x + dx * PHYSICS.muzzleOffset, oy = u.y + dy * PHYSICS.muzzleOffset, base = { x: ox, y: oy, vx: dx * sp, vy: dy * sp, owner: u, color: w.color };
    let ends = WEAPON_BY_ID[w.id].endsTurn;
    switch (w.id) {
      case 'bazooka': case 'grenade': case 'bouncer': this.launch(w.id, base); break;
      case 'cluster': this.launch(w.id, base, { cluster: weaponSpec('cluster').submunition.count }); break;
      case 'splitter': this.launch(w.id, base, { split: weaponSpec('splitter').submunition.count }); break;
      case 'shotgun': this.shoot(u, dx, dy); break;
      case 'mine': { const S = weaponSpec('mine').special; this.mines.push({ x: u.x + u.face * S.placeOffset, y: u.y, vy: 0, arm: S.armFrames, fuse: -1 }); break; }
      case 'dynamite': { const S = weaponSpec('dynamite').special; this.launch(w.id, { x: u.x + u.face * S.offsetX, y: u.y + S.offsetY, vx: u.face * S.vx, vy: S.vy, color: w.color }); break; }
      case 'flame': {
        // 火焰瓶本身不帶 r/dmg：碎裂時改用 detonate 的火焰分支
        const B = weaponSpec('flame'); this.spawnProj({ ...base, kind: B.projectile.kind, wind: 1, fire: 1 }); break;
      }
      case 'rope': if (!this.grapple(u, dx, dy)) return; break;
      case 'drill': u.drill = { t: weaponSpec('drill').special.frames, dx, dy }; break;
      case 'homing': this.launch(w.id, base, { homing: 1, tx: this.target!.x, ty: this.target!.y }); this.target = null; break;
      case 'bat': this.bat(u, dx, dy); break;
    }
    this.consume(w); const T = this.team(); if (T.ammo[w.id] === 0 && !ends) T.weapon = 'bazooka';
    if (ends) this.endAct(); this.camFree = false; this.emit();
  }
  spawnProj(o: Omit<Projectile, 't' | 'damp'> & { damp?: number }) { const p: Projectile = { t: 0, damp: .5, ...o }; this.proj.push(p); this.camFree = false; return p; }
  grapple(u: Unit, dx: number, dy: number) { const S = weaponSpec('rope').special; for (let d = S.minDist; d < S.range; d += S.stepPx) { const x = u.x + dx * d, y = u.y + dy * d; if (this.solid(x, y)) { u.grapple = { x, y, t: 0 }; u.air = true; return true; } } this.say('鉤不到東西', 60); return false; }
  shoot(u: Unit, dx: number, dy: number) {
    const S = weaponSpec('shotgun').special;
    for (const s of S.pelletAngles) {
      const a = Math.atan2(dy, dx) + s, ex = Math.cos(a), ey = Math.sin(a); let x = u.x + ex * S.muzzle, y = u.y + ey * S.muzzle, hit = false; const x0 = x, y0 = y;
      for (let d = 0; d < S.range && !hit; d += S.stepPx) {
        x += ex * S.stepPx; y += ey * S.stepPx;
        for (const v of this.units) if (!v.dead && v !== u && Math.hypot(v.x - x, v.y - y) < v.r + S.hitPad) { this.explode(x, y, S.unitR, S.unitDmg, { kb: S.unitKb, quiet: 1 }); hit = true; break; }
        if (!hit && this.solid(x, y)) { this.explode(x, y, S.terrainR, S.terrainDmg, { quiet: 1 }); hit = true; }
      }
      this.parts.push({ type: 'line', x: x0, y: y0, x2: x, y2: y, life: S.traceFrames, max: S.traceFrames });
    }
  }
  bat(u: Unit, dx: number, dy: number) {
    const S = weaponSpec('bat').special;
    const hx = u.x + dx * S.reach, hy = u.y + dy * S.reach; let any = false;
    for (const v of this.units) if (!v.dead && v !== u && Math.hypot(v.x - hx, v.y - hy) < S.radius) { this.hurt(v, S.dmg); v.vx = dx * S.launch; v.vy = dy * S.launch - S.lift; v.air = true; any = true; }
    this.parts.push({ type: 'ring', x: hx, y: hy, r0: 6, r1: 26, life: 14, max: 14 }); if (any) { this.text(hx, hy - 20, '咚!', '#ffd23f', 26); this.shake = 8; }
  }
  updUnit(u: Unit) {
    if (u.dead) return;
    if (u.grapple) {
      const S = weaponSpec('rope').special;
      const G = u.grapple; G.t++; const dx = G.x - u.x, dy = G.y - u.y, d = Math.hypot(dx, dy);
      if (d < S.releaseDist || G.t > S.maxFrames) { u.grapple = null; u.air = true; u.vx *= S.releaseDamp; u.vy *= S.releaseDamp; return; }
      const vx = dx / d * S.pullSpeed, vy = dy / d * S.pullSpeed; if (this.hitC(u.x + vx, u.y + vy, u.r)) { u.grapple = null; u.air = true; u.vx = 0; u.vy = 0; return; }
      u.x += vx; u.y += vy; u.vx = vx; u.vy = vy; return;
    }
    if (u.drill) {
      const S = weaponSpec('drill').special;
      const D = u.drill; D.t--; this.dig(u.x + D.dx * S.digAhead, u.y + D.dy * S.digAhead, S.digR); u.x += D.dx * S.speed; u.y += D.dy * S.speed; if (D.t % S.debrisEvery === 0) this.debris(u.x + D.dx * S.debrisAhead, u.y + D.dy * S.debrisAhead, S.debrisCount);
      if (D.t <= 0) { u.drill = null; u.air = true; u.vx = 0; u.vy = 0; } return;
    }
    if (this.hitC(u.x, u.y, u.r)) { for (let k = 1; k <= PHYSICS.unstuckMax; k++) if (!this.hitC(u.x, u.y - k, u.r)) { u.y -= k; break; } }
    if (!u.air) { if (!this.hitC(u.x, u.y + 1.5, u.r)) { u.air = true; u.vx = 0; u.vy = 0; } else return; }
    u.vy = Math.min(u.vy + this.g, PHYSICS.unitMaxFallSpeed);
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(u.vx), Math.abs(u.vy))));
    for (let i = 0; i < n; i++) {
      const nx = u.x + u.vx / n, ny = u.y + u.vy / n; if (!this.hitC(nx, ny, u.r)) { u.x = nx; u.y = ny; continue; }
      const cx = !this.hitC(nx, u.y, u.r), cy = !this.hitC(u.x, ny, u.r);
      if (u.vy > 0 && !cy) { this.land(u); if (cx && u.air) u.x = nx; break; }
      if (cy) u.y = ny; else u.vy = 0; if (cx) u.x = nx; else u.vx *= PHYSICS.wallBounce; break;
    }
  }
  land(u: Unit) {
    const imp = Math.hypot(u.vx, u.vy);
    this.hurt(u, fallDamage(u.vy, !!this.cfg.fallDamage));
    if (imp > PHYSICS.landBounceSpeed) { u.vy *= PHYSICS.landBounceVy; u.vx *= PHYSICS.landBounceVx; } else { u.air = false; u.vx = 0; u.vy = 0; }
  }
  control(u: Unit) {
    if (u.grapple || u.drill) return; const k = this.keys;
    if (!u.air) { const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0); if (dir && !this.charging) { u.face = dir; this.walk(u, dir); this.camFree = false; } if (this.jumpQ && !this.charging) { u.air = true; u.vx = u.face * PHYSICS.jumpVx; u.vy = PHYSICS.jumpVy; } }
    this.jumpQ = false; if (k.up) u.aimA = Math.max(-PHYSICS.aimLimit, u.aimA - PHYSICS.aimStep); if (k.down) u.aimA = Math.min(PHYSICS.aimLimit, u.aimA + PHYSICS.aimStep);
  }
  walk(u: Unit, dir: number) { const nx = u.x + dir * PHYSICS.walkSpeed; for (let up = 0; up <= PHYSICS.walkClimb; up++) { if (!this.hitC(nx, u.y - up, u.r)) { u.x = nx; u.y -= up; for (let d = 1; d <= PHYSICS.walkSnap; d++) { if (this.hitC(u.x, u.y + d, u.r)) { u.y += d - 1; break; } } return; } } }
  updProj(p: Projectile) {
    p.t++;
    const HM = weaponSpec('homing').special;
    if (p.homing && p.t > HM.delay) {
      const a = Math.atan2(p.ty! - p.y, p.tx! - p.x), cur = Math.atan2(p.vy, p.vx); let d = a - cur; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI;
      const na = cur + clamp(d, -HM.turnRate, HM.turnRate), sp = Math.min(Math.hypot(p.vx, p.vy) + HM.accel, HM.maxSpeed); p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; if (p.t > HM.duration) p.homing = 0;
    }
    else { p.vy += this.g; if (p.wind) p.vx += this.wind * PHYSICS.projectileWind; }
    if ((p.kind === 'rocket' || p.kind === 'missile') && p.t % 2 === 0) this.parts.push({ type: 'smoke', x: p.x, y: p.y, vx: 0, vy: -.2, size: 4, life: 30, max: 30 });
    if (p.fuse && p.t >= p.fuse) { this.detonate(p); return; }
    const sp = Math.hypot(p.vx, p.vy), n = Math.max(1, Math.ceil(sp / 2));
    for (let i = 0; i < n; i++) {
      const nx = p.x + p.vx / n, ny = p.y + p.vy / n;
      if (!p.bounce && p.t > PHYSICS.projectileArmFrames) { for (const u of this.units) if (!u.dead && (u !== p.owner || p.t > PHYSICS.ownerSafeFrames) && Math.hypot(u.x - nx, u.y - ny) < u.r + PHYSICS.projectileHitPad) { p.x = nx; p.y = ny; this.detonate(p); return; } }
      if (this.solid(nx, ny)) {
        if (p.bounce) {
          const hx = this.solid(nx, p.y), hy = this.solid(p.x, ny); if (hx || !hy) p.vx *= -p.damp; if (hy || !hx) p.vy *= -p.damp; p.vx *= PHYSICS.projectileBounceFriction;
          if (sp > PHYSICS.projectileMinBounceSpeed) { p.bc = (p.bc || 0) + 1; if (p.bmax && p.bc >= p.bmax) { this.detonate(p); return; } }
          break;
        }
        p.x = nx; p.y = ny; this.detonate(p); return;
      }
      p.x = nx; p.y = ny;
    }
    if (p.y > this.waterY + 6 || p.x < -300 || p.x > W + 300) { if (p.y > this.waterY) this.splash(p.x); p.dead = true; }
  }
  detonate(p: Projectile) {
    p.dead = true;
    if (p.fire) {
      const F = weaponSpec('flame'), S = F.special;
      this.explode(p.x, p.y, F.warhead.r, F.warhead.dmg, { quiet: 1 });
      for (let i = 0; i < S.count; i++) this.flames.push({ x: p.x, y: p.y - 4, vx: (this.R() - .5) * S.spreadVx + p.vx * S.carryVx, vy: -S.vyMin - this.R() * S.vyRange, life: S.lifeMin + this.R() * S.lifeRange, stuck: false });
      this.text(p.x, p.y - 24, '呼!', '#ff5722', 26); return;
    }
    this.explode(p.x, p.y, p.r!, p.dmg!);
    if (p.cluster) {
      const C = weaponSpec('cluster').submunition;
      for (let i = 0; i < p.cluster; i++) this.spawnProj({ x: p.x, y: p.y - C.spawnLift, vx: (this.R() - .5) * C.vxSpread, vy: -C.vyMin - this.R() * C.vyRange, kind: C.kind, r: C.r, dmg: C.dmg, color: p.color });
    }
    if (p.split) {
      const S = weaponSpec('splitter').submunition;
      for (let i = 0; i < p.split; i++) { const a = -PI / 2 + (i - 1) * S.spreadAngle; this.spawnProj({ x: p.x, y: p.y - S.spawnLift, vx: Math.cos(a) * S.speed, vy: Math.sin(a) * S.speed, kind: S.kind, r: S.r, dmg: S.dmg, color: p.color }); }
    }
  }
  dig(x: number, y: number, r: number) {
    if (this.net) this.net.onDig(x, y, r);
    const c = this.tctx; c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.globalCompositeOperation = 'source-atop'; c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.arc(x, y, r + 1.5, 0, 7); c.stroke(); c.restore();
    this.digMask(x, y, r);
  }
  /** 只更新碰撞遮罩（不畫圖）；整數像素運算，任何瀏覽器結果都相同 */
  digMask(x: number, y: number, r: number) {
    const r2 = r * r; for (let yy = Math.max(0, (y - r) | 0); yy <= Math.min(H - 1, y + r); yy++) { const dy = yy - y; for (let xx = Math.max(0, (x - r) | 0); xx <= Math.min(W - 1, x + r); xx++) { const dx = xx - x; if (dx * dx + dy * dy <= r2) this.mask[yy * W + xx] = 0; } }
  }
  explode(x: number, y: number, r: number, dmg: number, o?: ExplodeOpts) {
    o = o || {}; this.dig(x, y, r);
    // 每個角色在一次爆炸中最多受傷一次
    for (const u of this.units) {
      if (u.dead) continue; const f = explosionFalloff(Math.hypot(u.x - x, u.y - y), r, u.r);
      if (f !== null) { this.hurt(u, explosionDamage(dmg, f)); const { dvx, dvy } = explosionImpulse(x, y, u.x, u.y, r, f, o.kb); u.vx += dvx; u.vy += dvy; u.air = true; }
    }
    for (const m of this.mines) if (Math.hypot(m.x - x, m.y - y) < r + EXPLOSION.minePad) { m.arm = 0; m.fuse = m.fuse > 0 ? Math.min(m.fuse, EXPLOSION.mineChainFuse) : EXPLOSION.mineChainFuse; }
    for (const c of this.crates) if (Math.hypot(c.x - x, c.y - y) < r + EXPLOSION.cratePad) { c.dead = true; this.debris(c.x, c.y, 6, '#c8873e'); }
    this.parts.push({ type: 'ring', x, y, r0: r * .3, r1: r * 1.25, life: 16, max: 16 });
    const N = Math.min(14, 4 + r / 4 | 0);
    for (let i = 0; i < N; i++) { const a = this.R() * PI * 2, s = this.R() * r * .08; this.parts.push({ type: 'puff', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - .5, size: r * .25 + this.R() * r * .2, col: this.R() < .5 ? '#ffd23f' : '#ff7a1a', life: 22 + this.R() * 10, max: 32 }); }
    for (let i = 0; i < N; i++) { const a = this.R() * PI * 2; this.parts.push({ type: 'smoke', x: x + Math.cos(a) * r * .4, y: y + Math.sin(a) * r * .4, vx: (this.R() - .5) * .6, vy: -.4 - this.R() * .5, size: r * .18 + this.R() * 6, life: 60, max: 60 }); }
    this.debris(x, y, Math.min(12, r / 4 | 0));
    this.shake = Math.max(this.shake, Math.min(18, r / 3));
    if (!o.quiet && r >= EXPLOSION.bigBoomRadius) this.text(x, y - r * .6, BOOMS[(this.R() * BOOMS.length) | 0], '#ffd23f', Math.min(44, 18 + r * .45));
  }
  debris(x: number, y: number, n: number, col?: string) { for (let i = 0; i < n; i++) { const a = -PI * this.R(), s = 2 + this.R() * 4; this.parts.push({ type: 'deb', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: 2 + this.R() * 3, col: col || this.th.ground, life: 50, max: 50, g: 1 }); } }
  splash(x: number) { for (let i = 0; i < 10; i++) this.parts.push({ type: 'drop', x, y: this.waterY, vx: (this.R() - .5) * 3, vy: -2 - this.R() * 4, size: 2 + this.R() * 2, life: 40, max: 40, g: 1 }); }
  sparkle(x: number, y: number) { for (let i = 0; i < 14; i++) { const a = this.R() * PI * 2, s = 1 + this.R() * 3; this.parts.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: 3, col: '#c9a8ff', life: 30, max: 30 }); } }
  credit(u: Unit, d: number, kill: boolean) { const T = this.team(); if (!T || u.team === T || this.state === 'over') return; T.dmg += d; this.turnDmg = (this.turnDmg || 0) + d; if (kill) T.kills++; }
  hurt(u: Unit, dm: number) {
    if (dm <= 0 || u.dead) return; const { credited, kill } = damageCredit(u.hp, dm); this.credit(u, credited, kill); u.hp = hpAfterDamage(u.hp, dm);
    const T = this.texts.find(t => t.u === u && t.life > 40); if (T) { T.n! += dm; T.txt = '-' + T.n; } else this.texts.push({ u, n: dm, x: u.x, y: u.y - 36, txt: '-' + dm, col: u.team.color, size: 20, life: 90, max: 90 });
    if (u === this.active() && this.state === 'retreat') this.retreatT = Math.min(this.retreatT, 1);
  }
  text(x: number, y: number, txt: string, col: string, size?: number) { this.texts.push({ x, y, txt, col, size: size || 22, life: 70, max: 70 }); }
  updFlame(f: Flame) {
    f.life--;
    const S = weaponSpec('flame').special;
    if (!f.stuck) { f.vy += this.g; f.vx += this.wind * PHYSICS.flameWind; const nx = f.x + f.vx, ny = f.y + f.vy; if (this.solid(nx, ny)) f.stuck = true; else { f.x = nx; f.y = ny; } if (f.y > this.waterY) f.life = 0; }
    else if (!this.solid(f.x, f.y + 2)) { f.stuck = false; f.vx = 0; f.vy = 0; }
    if (this.frame % S.tickFrames === 0) { if (f.stuck && this.R() < S.digChance) this.dig(f.x, f.y + 2, S.digR); for (const u of this.units) if (!u.dead && Math.hypot(u.x - f.x, u.y - f.y) < S.radius) { this.hurt(u, S.dmg); u.vy -= S.knockUp; u.vx += (u.x > f.x ? 1 : -1) * S.knockSide; u.air = true; } }
  }
  updMine(m: Mine) {
    const M = weaponSpec('mine'), S = M.special;
    if (!this.solid(m.x, m.y + 4)) { m.vy = Math.min(m.vy + this.g, PHYSICS.mineMaxFallSpeed); for (let i = 0; i < Math.ceil(m.vy); i++) { if (this.solid(m.x, m.y + 4)) { m.vy = 0; break; } m.y++; } } else m.vy = 0;
    if (m.y > this.waterY) { m.dead = true; return; } if (m.arm > 0) { m.arm--; return; }
    if (m.fuse < 0) { if (this.units.some(u => !u.dead && Math.hypot(u.x - m.x, u.y - m.y) < S.triggerRadius)) m.fuse = S.fuseFrames; } else if (--m.fuse <= 0) { m.dead = true; this.explode(m.x, m.y, M.warhead.r, M.warhead.dmg); }
  }
  dropCrate() { const x = 80 + this.R() * (W - 160), health = this.R() < CRATES.healthChance, pool = WEAPONS.filter(w => w.ammo !== -1), item = health ? null : pool[(this.R() * pool.length) | 0].id; this.crates.push({ x, y: -30, para: true, health, item, vy: 0 }); this.say(health ? '空投:醫療箱!' : '空投:武器補給箱!', 100); }
  updCrate(c: Crate) {
    if (!this.solid(c.x, c.y + 11)) { if (c.para) { c.y += CRATES.paraSpeed; c.x += this.wind * PHYSICS.crateWind; } else { c.vy = Math.min(c.vy + this.g, PHYSICS.crateMaxFallSpeed); c.y += c.vy; } } else { c.para = false; c.vy = 0; if (this.solid(c.x, c.y + 9)) c.y -= 1; }
    if (c.y > this.waterY) { c.dead = true; return; }
    for (const u of this.units) if (!u.dead && Math.abs(u.x - c.x) < CRATES.pickupX && Math.abs(u.y - c.y) < CRATES.pickupY) {
      c.dead = true;
      if (c.health) { u.hp = hpAfterHeal(u.hp, HP.medkitHeal); this.text(u.x, u.y - 30, '+' + HP.medkitHeal, '#4cd964', 22); }
      else { const T = u.team; if (T.ammo[c.item!] !== -1) T.ammo[c.item!] = (T.ammo[c.item!] || 0) + CRATES.weaponAmmo; this.say(`${T.name} 獲得 ${WMAP[c.item!].name}!`, 110); }
      break;
    }
  }
  settled() { if (this.proj.length || this.flames.length) return false; if (this.mines.some(m => m.fuse >= 0 || m.vy > 0)) return false; return this.units.every(u => u.dead || (!u.air && !u.grapple && !u.drill)); }
  resolve() {
    const dying = this.units.find(isDying);
    if (dying) { dying.dead = true; this.graves.push({ x: dying.x, y: dying.y }); this.text(dying.x, dying.y - 40, dying.name + ' 倒下了', dying.team.color, 18); this.explode(dying.x, dying.y, HP.deathExplosion.r, HP.deathExplosion.dmg, { quiet: 1 }); this.settleT = 0; return; }
    const alive = this.teams.filter(t => t.units.some(u => !u.dead));
    if (alive.length <= 1) {
      const cT = this.team(); if (cT) cT.bestTurn = Math.max(cT.bestTurn, this.turnDmg || 0); this.state = 'over'; this.emit();
      const stats = this.teams.map(t => ({ name: t.name, color: t.color, animal: t.animal, ai: t.ai || null, dmg: t.dmg, kills: t.kills, bestTurn: t.bestTurn, won: t === alive[0] }));
      this.cb.onGameOver && this.cb.onGameOver(alive[0] ? { name: alive[0].name, color: alive[0].color, animal: alive[0].animal } : null, stats); return;
    }
    if (this.cfg.waterRise && this.turnCount >= this.teams.length) { this.waterY -= PHYSICS.waterRisePerTurn; this.say('水位上升了!', 80); }
    this.nextTurn();
  }
  nextTurn() {
    const pT = this.team(); if (pT) pT.bestTurn = Math.max(pT.bestTurn, this.turnDmg || 0); this.turnDmg = 0; this.ai = null;
    const n = this.teams.length; let i = this.teamTurn; for (let k = 0; k < n; k++) { i = (i + 1) % n; if (this.teams[i].units.some(u => !u.dead)) break; }
    this.teamTurn = i; const T = this.teams[i]; for (let k = 0; k < T.units.length; k++) { T.cur = (T.cur + 1) % T.units.length; if (!T.units[T.cur].dead) break; }
    this.turnCount++; this.state = 'aim'; this.timeLeft = this.cfg.turnTime || 0; this.retreatT = 0; this.charging = false; this.power = 0; this.target = null; this.camFree = false; this.idle = true; this.settleT = 0;
    this.wind = this.cfg.wind ? Math.round((this.R() * 2 - 1) * PHYSICS.windMax * PHYSICS.windSteps) / PHYSICS.windSteps : 0;
    if (T.ammo[T.weapon] === 0) { const w = WEAPONS.find(w => T.ammo[w.id] !== 0); T.weapon = w ? w.id : 'bazooka'; }
    if (this.cfg.crates && this.turnCount > 1 && this.R() < CRATES.dropChance) this.dropCrate();
    else this.say(`輪到 ${T.name}・${this.active()!.name}`, 110);
    this.emit();
    if (this.net) this.net.onTurnStart(this);
  }
  step() {
    if (this.net) this.net.beforeStep(this);
    this.frame++; const u = this.active();
    if (u && !u.dead && (this.state === 'aim' || this.state === 'retreat')) { if (this.isAI()) { if (this.state === 'aim') this.aiStep(u); } else this.control(u); }
    if (this.state === 'aim' && this.cfg.turnTime) { this.timeLeft -= 1 / PHYSICS.tickRate; if (this.timeLeft <= 0) { this.timeLeft = 0; this.charging = false; this.state = 'settle'; this.say('時間到!', 90); } }
    if (this.state === 'aim' && this.charging) { this.power += 1 / PHYSICS.chargeFrames; if (this.power >= 1) this.fire(1); }
    if (this.state === 'retreat') { this.retreatT--; if (this.retreatT <= 0) this.state = 'settle'; }
    for (const x of this.units) this.updUnit(x);
    for (let i = 0; i < this.proj.length; i++) this.updProj(this.proj[i]); this.proj = this.proj.filter(p => !p.dead);
    for (const f of this.flames) this.updFlame(f); this.flames = this.flames.filter(f => f.life > 0);
    for (const m of this.mines) this.updMine(m); this.mines = this.mines.filter(m => !m.dead);
    for (const c of this.crates) this.updCrate(c); this.crates = this.crates.filter(c => !c.dead);
    for (const g of this.graves) { if (!this.solid(g.x, g.y + 9)) g.y += 2; } this.graves = this.graves.filter(g => g.y < this.waterY + 10);
    for (const p of this.parts) { p.x += p.vx || 0; p.y += p.vy || 0; if (p.g) p.vy! += .2; p.life--; } this.parts = this.parts.filter(p => p.life > 0);
    for (const t of this.texts) { t.y -= .45; t.life--; } this.texts = this.texts.filter(t => t.life > 0);
    for (const x of this.units) if (!x.dead && (x.y > this.waterY + PHYSICS.drownDepth || x.x < -PHYSICS.outOfBoundsX || x.x > W + PHYSICS.outOfBoundsX)) {
      // 落水或出界：剩餘 HP 全數計為傷害
      this.credit(x, displayHp(x.hp), x.hp > 0); x.dead = true; x.hp = 0; x.grapple = null; x.drill = null; this.splash(x.x); this.text(x.x, this.waterY - 30, '噗通!', x.team.color, 24);
      if (x === u && (this.state === 'aim' || this.state === 'retreat')) this.state = 'settle';
    }
    if (this.state === 'settle') { if (this.settled()) { if (++this.settleT > TURN.settleFrames) this.resolve(); } else this.settleT = 0; }
    if (this.msgT > 0) this.msgT--; if (this.shake > .3) this.shake *= .88; else this.shake = 0;
    this.camera(); if (this.frame % 6 === 0) this.emit();
  }
  aiStep(u: Unit) {
    const T = this.team(); let P = this.ai;
    if (!P || P.turn !== this.turnCount) P = this.ai = { turn: this.turnCount, t: 0, phase: 'think', fails: 0 };
    P.t++;
    if (P.phase === 'think') { if (P.t < 50) return; Object.assign(P, { tx: null, tset: false }, this.aiPlan(u, T, P.fails > 0)); P.t = 0; P.phase = 'act'; if (P.weapon && T.ammo[P.weapon] !== 0) { T.weapon = P.weapon; this.emit(); } return; }
    if (P.phase === 'act') {
      if (P.tx != null && !P.tset) { if (P.t < 40) return; this.doSetTarget({ x: P.tx, y: P.ty! }); P.tset = true; if (P.weapon !== 'homing') { P.phase = 'done'; P.t = 0; } return; }
      if (P.face) u.face = P.face; const d = (P.ang || 0) - u.aimA; u.aimA += clamp(d, -.035, .035); if (Math.abs(d) > .01 || P.t < 30) return;
      if (P.charge) { this.charging = true; this.power = 0; P.phase = 'charge'; } else { this.fire(0); P.phase = 'done'; P.t = 0; } return;
    }
    if (P.phase === 'charge') { if (!this.charging) { P.phase = 'done'; P.t = 0; return; } if (this.power >= P.pw!) this.fire(this.power); return; }
    if (P.phase === 'done' && this.state === 'aim' && P.t > 40) { P.fails++; if (P.fails > 2) { this.state = 'settle'; return; } P.phase = 'think'; P.t = 40; }
  }
  aiPlan(u: Unit, T: Team, safe: boolean): AiPlan {
    const lv = T.ai!, an = ({ easy: .12, normal: .045, hard: .012 } as Record<string, number>)[lv] ?? .045, pn = ({ easy: .1, normal: .04, hard: .01 } as Record<string, number>)[lv] ?? .04, R = this.R;
    const has = (id: string) => (!safe || id === 'bazooka' || id === 'grenade') && T.ammo[id] !== 0 && T.ammo[id] != null;
    const foes = this.units.filter(v => !v.dead && v.team !== T).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
    if (!foes.length) return {};
    const f = foes[0], dn = Math.hypot(f.x - u.x, f.y - u.y), faceTo = (v: Unit) => v.x >= u.x ? 1 : -1, angTo = (v: Unit) => clamp(Math.atan2(v.y - u.y, Math.abs(v.x - u.x)), -1.5, 1.5);
    if (dn < 26 && has('bat')) return { weapon: 'bat', face: faceTo(f), ang: angTo(f) - .5 };
    if (dn < 280 && has('shotgun') && this.los(u, f)) return { weapon: 'shotgun', face: faceTo(f), ang: angTo(f) + (R() - .5) * an };
    const r = R();
    if (lv !== 'easy' && !safe) {
      if (has('airstrike') && r < .2) {
        let best: Unit | null = null, bs = -1;
        for (const v of foes) { const c = foes.filter(o => Math.abs(o.x - v.x) < 90).length - this.units.filter(o => !o.dead && o.team === T && Math.abs(o.x - v.x) < 110).length * 2; if (c > bs) { bs = c; best = v; } }
        if (bs > 0) return { weapon: 'airstrike', tx: best!.x + (R() - .5) * an * 300, ty: best!.y };
      }
      if (has('homing') && r < .4) return { weapon: 'homing', tx: f.x, ty: f.y, face: faceTo(f), ang: -1.1, charge: 1, pw: .55 };
    }
    const rockets = ['bazooka', 'splitter'].filter(has), nades = ['grenade', 'cluster', 'bouncer'].filter(has);
    const fam = ((Math.abs(this.wind) > .4 && nades.length) || !rockets.length) ? 'nade' : 'rocket';
    const list = fam === 'nade' ? nades : rockets; if (!list.length) return {};
    let weapon = list[0]; if (lv !== 'easy' && list.length > 1 && R() < .35) weapon = list[1 + ((R() * (list.length - 1)) | 0)];
    const targets = foes.slice(0, 4); let best: { sc: number; face: number; ang: number; pw: number } | null = null;
    for (const face of [-1, 1]) for (let ang = -1.45; ang <= 1.1; ang += .04) for (let pw = .2; pw <= 1.001; pw += .04) {
      const hit = this.sim(u, face, ang, pw, fam === 'rocket'); if (hit.lost) continue;
      if (Math.hypot(hit.x! - u.x, hit.y! - u.y) < 60) continue;
      let sc = 1e9; for (const v of targets) { const d = Math.hypot(hit.x! - v.x, hit.y! - v.y) + (v.hp < 40 ? -10 : 0); if (d < sc) sc = d; }
      for (const o of this.units) if (!o.dead && o.team === T && o !== u && Math.hypot(hit.x! - o.x, hit.y! - o.y) < 60) sc += 200;
      sc += pw * 4; if (!best || sc < best.sc) best = { sc, face, ang, pw };
    }
    if (!best) best = { sc: 0, face: faceTo(f), ang: -.8, pw: .7 };
    return { weapon, face: best.face, ang: clamp(best.ang + (R() - .5) * 2 * an, -1.55, 1.55), charge: 1, pw: clamp(best.pw + (R() - .5) * 2 * pn, .05, 1) };
  }
  sim(u: Unit, face: number, ang: number, pw: number, rk: boolean): { x?: number; y?: number; lost?: number } {
    const dx = face * Math.cos(ang), dy = Math.sin(ang), sp = PHYSICS.shotSpeedMin + pw * PHYSICS.shotSpeedRange; let x = u.x + dx * PHYSICS.muzzleOffset, y = u.y + dy * PHYSICS.muzzleOffset, vx = dx * sp, vy = dy * sp; const us = rk ? this.units.filter(v => !v.dead && v !== u) : [];
    for (let t = 0; t < 400; t++) {
      vy += this.g; if (rk) vx += this.wind * PHYSICS.projectileWind; const n = Math.max(1, Math.ceil(Math.hypot(vx, vy) / 3));
      for (let i = 0; i < n; i++) { x += vx / n; y += vy / n; if (this.solid(x, y)) return { x, y }; for (const v of us) if ((v.x - x) ** 2 + (v.y - y) ** 2 < 170) return { x, y }; }
      if (y > this.waterY || x < -60 || x > W + 60) return { lost: 1 };
    }
    return { lost: 1 };
  }
  los(u: Unit, v: Unit) { const d = Math.hypot(v.x - u.x, v.y - u.y), n = Math.ceil(d / 4); for (let i = 3; i < n; i++) { const t = i / n; if (this.solid(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t)) return false; } return true; }
  emit() {
    const T = this.team(), u = this.active(); if (!T) return;
    const h: Hud = {
      ai: T.ai || null, state: this.state, turn: this.teamTurn, unit: u ? u.name : '', time: Math.ceil(this.timeLeft), timer: !!this.cfg.turnTime, retreat: Math.ceil(this.retreatT / 60), wind: this.wind, weapon: T.weapon, ammo: { ...T.ammo }, msg: this.msgT > 0 ? this.msg : '', needTarget: this.needsTarget(),
      ...(this.net ? { remote: this.net.isRemoteTurn(this) } : {}),
      teams: this.teams.map(t => ({ name: t.name, color: t.color, animal: t.animal, hp: t.units.reduce((a, u) => a + (u.dead ? 0 : displayHp(u.hp)), 0), max: t.units.length * (this.cfg.hp || HP.default), alive: t.units.filter(u => !u.dead).length })),
    };
    const s = JSON.stringify(h); if (s !== this.lastHud) { this.lastHud = s; this.cb.onHud && this.cb.onHud(h); }
  }
  camera() {
    const vw = this.vw / this.s, vh = this.vh / this.s;
    if (this.needsTarget() && this.mouseS) { const e = 50, sp = 10, m = this.mouseS; if (m.x < e) { this.camX -= sp; this.camFree = true; } if (m.x > this.vw - e) { this.camX += sp; this.camFree = true; } if (m.y < e) { this.camY -= sp; this.camFree = true; } if (m.y > this.vh - e) { this.camY += sp; this.camFree = true; } }
    if (!this.camFree) { let t: Point | null = null; if (this.proj.length) t = this.proj[this.proj.length - 1]; else { const u = this.active(); if (u && !u.dead) t = u; } if (t) { this.camX += (t.x - vw / 2 - this.camX) * .08; this.camY += (t.y - vh / 2 - this.camY) * .08; } }
    this.camX = clamp(this.camX, 0, Math.max(0, W - vw)); this.camY = clamp(this.camY, -150, Math.max(-150, H - vh));
  }
  render() {
    const c = this.ctx, dpr = this.dpr, vw = this.vw, vh = this.vh, th = this.th, s = this.s, f = this.frame;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, vh); g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]); c.fillStyle = g; c.fillRect(0, 0, vw, vh);
    if (th.dark) { c.fillStyle = '#fff'; for (const st of this.stars) { c.globalAlpha = .35 + .35 * Math.sin(f * .03 + st.x * 50); c.beginPath(); c.arc(((st.x * vw * 1.5 - this.camX * s * .1) % vw + vw) % vw, st.y * vh * .8, st.r, 0, 7); c.fill(); } c.globalAlpha = 1; }
    for (let L = 0; L < 2; L++) {
      const p = .15 + L * .2; c.fillStyle = th.dark ? `rgba(255,255,255,${.04 + L * .03})` : `rgba(255,255,255,${.25 + L * .12})`; c.beginPath(); c.moveTo(0, vh);
      for (let x = 0; x <= vw + 10; x += 10) { const wx = x + this.camX * s * p; c.lineTo(x, vh * (.5 + L * .12) - this.camY * s * p * .3 + Math.sin(wx * .005 + L * 2) * 45 + Math.sin(wx * .013 + L) * 18); }
      c.lineTo(vw, vh); c.fill();
    }
    if (!th.dark) {
      for (const cl of this.clouds) {
        cl.x += .15 + this.wind * .4; const x = (((cl.x - this.camX * .3) * s) % (vw + 300) + vw + 300) % (vw + 300) - 150, y = cl.y * s, k = cl.s * s * 1.4; const bl = [[0, 0, 26], [24, -10, 30], [52, 0, 24], [26, 8, 22]];
        c.strokeStyle = INK; c.lineWidth = 5; for (const b of bl) { c.beginPath(); c.arc(x + b[0] * k, y + b[1] * k, b[2] * k, 0, 7); c.stroke(); }
        c.fillStyle = '#fff'; for (const b of bl) { c.beginPath(); c.arc(x + b[0] * k, y + b[1] * k, b[2] * k, 0, 7); c.fill(); }
      }
    }
    const sh = this.shake, ox = (Math.random() - .5) * sh, oy = (Math.random() - .5) * sh;
    c.setTransform(dpr * s, 0, 0, dpr * s, dpr * (-this.camX * s + ox * s), dpr * (-this.camY * s + oy * s));
    c.drawImage(this.terrain, 0, 0);
    c.lineWidth = 2; c.strokeStyle = INK;
    for (const gr of this.graves) { c.fillStyle = '#cfd3da'; c.beginPath(); c.roundRect(gr.x - 7, gr.y - 8, 14, 17, [7, 7, 2, 2]); c.fill(); c.stroke(); c.fillStyle = INK; c.fillRect(gr.x - 1, gr.y - 5, 2, 8); c.fillRect(gr.x - 3.5, gr.y - 3, 7, 2); }
    for (const m of this.mines) { c.fillStyle = '#3b4650'; c.beginPath(); c.arc(m.x, m.y + 3, 6, PI, 0); c.closePath(); c.fill(); c.stroke(); const blink = m.fuse >= 0 ? (f % 8 < 4) : (m.arm <= 0 && f % 50 < 10); c.fillStyle = blink ? '#ff3b30' : '#7a1d18'; c.beginPath(); c.arc(m.x, m.y - 2, 2, 0, 7); c.fill(); }
    for (const cr of this.crates) {
      if (cr.para) {
        c.fillStyle = '#fff'; c.beginPath(); c.arc(cr.x, cr.y - 30, 18, PI, 0); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#ff5d8f'; c.beginPath(); c.arc(cr.x, cr.y - 30, 18, PI, PI * 1.33); c.lineTo(cr.x, cr.y - 30); c.fill(); c.beginPath(); c.arc(cr.x, cr.y - 30, 18, PI * 1.66, 0); c.lineTo(cr.x, cr.y - 30); c.fill();
        c.beginPath(); c.moveTo(cr.x - 17, cr.y - 30); c.lineTo(cr.x - 8, cr.y - 10); c.moveTo(cr.x + 17, cr.y - 30); c.lineTo(cr.x + 8, cr.y - 10); c.stroke();
      }
      c.fillStyle = cr.health ? '#ffffff' : '#d9964a'; c.beginPath(); c.roundRect(cr.x - 10, cr.y - 10, 20, 20, 3); c.fill(); c.stroke(); c.fillStyle = cr.health ? '#ff3b30' : INK;
      if (cr.health) { c.fillRect(cr.x - 2, cr.y - 7, 4, 14); c.fillRect(cr.x - 7, cr.y - 2, 14, 4); } else { c.font = '900 14px "Baloo 2",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', cr.x, cr.y + 1); }
    }
    const au = this.active(), T = this.team();
    for (const u of this.units) {
      if (u.dead) continue; if (u.grapple) { c.strokeStyle = '#6d4c41'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(u.grapple.x, u.grapple.y); c.stroke(); c.strokeStyle = INK; c.lineWidth = 2; }
      const isA = u === au && (this.state === 'aim') && !u.grapple && !u.drill; drawAnimal(c, u.x, u.y - 1, u.team.animal, u.team.color, u.face, u.aimA, 1, isA ? WMAP[T.weapon].color : null);
      c.font = '800 12px "Baloo 2",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; const hp = String(displayHp(u.hp)), tw = c.measureText(hp).width + 12; c.fillStyle = u.team.color; c.beginPath(); c.roundRect(u.x - tw / 2, u.y - 36, tw, 16, 8); c.fill(); c.lineWidth = 2; c.strokeStyle = INK; c.stroke(); c.fillStyle = '#fff'; c.fillText(hp, u.x, u.y - 27.5);
      if (u === au && this.state === 'aim' && this.idle) { const b = Math.sin(f * .15) * 4; c.fillStyle = u.team.color; c.beginPath(); c.moveTo(u.x - 8, u.y - 58 + b); c.lineTo(u.x + 8, u.y - 58 + b); c.lineTo(u.x, u.y - 45 + b); c.closePath(); c.fill(); c.stroke(); }
    }
    for (const p of this.proj) this.drawProj(c, p);
    for (const fl of this.flames) { const k = 1 + Math.sin(f * .4 + fl.x) * .25, a = Math.min(1, fl.life / 60); c.globalAlpha = a; c.fillStyle = '#ff7a1a'; c.beginPath(); c.arc(fl.x, fl.y - 3, 5 * k, 0, 7); c.fill(); c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(fl.x, fl.y - 4, 2.6 * k, 0, 7); c.fill(); c.globalAlpha = 1; }
    for (const p of this.parts) {
      const a = p.life / p.max;
      if (p.type === 'ring') { c.globalAlpha = a; c.strokeStyle = '#fff'; c.lineWidth = 5 * a + 1; c.beginPath(); c.arc(p.x, p.y, p.r1! - (p.r1! - p.r0!) * a, 0, 7); c.stroke(); }
      else if (p.type === 'puff') { c.globalAlpha = 1; c.fillStyle = p.col!; c.beginPath(); c.arc(p.x, p.y, p.size! * a, 0, 7); c.fill(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke(); }
      else if (p.type === 'smoke') { c.globalAlpha = a * .45; c.fillStyle = th.dark ? '#cfc8d8' : '#ffffff'; c.beginPath(); c.arc(p.x, p.y, p.size! * (1.6 - a * .6), 0, 7); c.fill(); }
      else if (p.type === 'line') { c.globalAlpha = a; c.strokeStyle = '#ffe066'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x2!, p.y2!); c.stroke(); }
      else if (p.type === 'drop') { c.globalAlpha = a; c.fillStyle = th.water; c.beginPath(); c.arc(p.x, p.y, p.size!, 0, 7); c.fill(); }
      else { c.globalAlpha = a; c.fillStyle = p.col!; c.fillRect(p.x - p.size! / 2, p.y - p.size! / 2, p.size!, p.size!); }
    }
    c.globalAlpha = 1; c.strokeStyle = INK;
    if (au && !au.dead && this.state === 'aim' && !au.grapple && !au.drill) {
      const w = WMAP[T.weapon], dx = au.face * Math.cos(au.aimA), dy = Math.sin(au.aimA);
      if (!w.target || w.id === 'homing') { const cx = au.x + dx * 58, cy = au.y + dy * 58; c.lineWidth = 2.5; c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 7, 0, 7); c.fill(); c.stroke(); c.fillStyle = T.color; c.beginPath(); c.arc(cx, cy, 3, 0, 7); c.fill(); }
      if (this.charging) { const n = Math.ceil(this.power * 12); for (let i = 0; i < n; i++) { const d = 18 + i * 5.5, t = i / 11; c.fillStyle = `hsl(${50 - t * 50},100%,55%)`; c.beginPath(); c.arc(au.x + dx * d, au.y + dy * d, 3 + t * 4, 0, 7); c.fill(); c.lineWidth = 1.5; c.stroke(); } }
      if (this.target) this.drawMark(c, this.target.x, this.target.y, w.color);
      if (this.needsTarget() && this.mouseW) this.drawMark(c, this.mouseW.x, this.mouseW.y, w.color, true);
    }
    const wy = this.waterY;
    for (let L = 0; L < 2; L++) {
      c.globalAlpha = L ? .85 : .55; c.fillStyle = th.water; c.beginPath(); c.moveTo(-50, H + 400); for (let x = -50; x <= W + 50; x += 20) c.lineTo(x, wy + L * 8 + Math.sin(x * .02 + f * .05 + L * 2) * 4); c.lineTo(W + 50, H + 400); c.closePath(); c.fill();
      if (L) { c.globalAlpha = 1; c.lineWidth = 3; c.strokeStyle = INK; c.beginPath(); for (let x = -50; x <= W + 50; x += 20) c.lineTo(x, wy + 8 + Math.sin(x * .02 + f * .05 + 2) * 4); c.stroke(); }
    }
    c.globalAlpha = 1; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const t of this.texts) { const a = Math.min(1, t.life / 20); c.globalAlpha = a; c.font = `900 ${t.size}px "Zen Maru Gothic","Baloo 2",sans-serif`; c.lineJoin = 'round'; c.lineWidth = 5; c.strokeStyle = INK; const x = t.u ? t.u.x : t.x; c.strokeText(t.txt, x, t.y); c.fillStyle = t.col; c.fillText(t.txt, x, t.y); }
    c.globalAlpha = 1;
  }
  drawMark(c: CanvasRenderingContext2D, x: number, y: number, col: string, ghost?: boolean) { c.save(); c.globalAlpha = ghost ? .6 : 1; c.strokeStyle = INK; c.lineWidth = 3; const r = 12 + Math.sin(this.frame * .15) * 2; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(x - r - 6, y); c.lineTo(x + r + 6, y); c.moveTo(x, y - r - 6); c.lineTo(x, y + r + 6); c.stroke(); c.restore(); }
  drawProj(c: CanvasRenderingContext2D, p: Projectile) {
    c.save(); c.translate(p.x, p.y); c.lineWidth = 2; c.strokeStyle = INK;
    if (p.kind === 'rocket' || p.kind === 'missile' || p.kind === 'frag') { c.rotate(Math.atan2(p.vy, p.vx)); c.fillStyle = p.color!; c.beginPath(); c.roundRect(-8, -3.5, 15, 7, 3.5); c.fill(); c.stroke(); c.fillStyle = INK; c.beginPath(); c.moveTo(-7, -3); c.lineTo(-12, -7); c.lineTo(-12, 7); c.lineTo(-7, 3); c.fill(); }
    else if (p.kind === 'dynamite') { c.fillStyle = '#d32f2f'; c.beginPath(); c.roundRect(-4, -8, 8, 15, 2); c.fill(); c.stroke(); c.fillStyle = this.frame % 6 < 3 ? '#ffd23f' : '#ff7a1a'; c.beginPath(); c.arc(2, -11, 2.5, 0, 7); c.fill(); }
    else if (p.kind === 'bottle') { c.rotate(p.t * .2); c.fillStyle = '#7bd389'; c.beginPath(); c.roundRect(-4, -6, 8, 12, 3); c.fill(); c.stroke(); c.fillStyle = '#ff5722'; c.fillRect(-2, -10, 4, 4); }
    else { const r = p.kind === 'bomblet' ? 3.5 : 5.5; c.fillStyle = p.color!; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,.6)'; c.beginPath(); c.arc(-r * .35, -r * .35, r * .3, 0, 7); c.fill(); }
    c.restore();
    if (p.fuse && p.kind !== 'ball') { c.font = '900 13px "Baloo 2",sans-serif'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = '#fff'; const t = String(Math.ceil((p.fuse - p.t) / 60)); c.strokeText(t, p.x, p.y - 14); c.fillStyle = INK; c.fillText(t, p.x, p.y - 14); }
  }
  loop(t: number) {
    const tick = 1000 / PHYSICS.tickRate;
    const dt = Math.min(PHYSICS.maxFrameMs, t - this.last); this.last = t; this.acc += dt; let n = 0;
    while (this.acc >= tick && n < PHYSICS.maxStepsPerFrame) { this.step(); this.acc -= tick; n++; }
    this.render(); this.raf = requestAnimationFrame(this.loop);
  }
}
