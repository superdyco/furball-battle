// 回合交界的正式狀態：擷取、套用、雜湊，以及地形遮罩的壓縮傳輸。
// 只依賴 Game 的公開欄位；不使用任何超越四則運算的數學函式，確保各瀏覽器結果一致。
import type { Game } from '../engine/Game';

/** 回合開始時的正式狀態（不含純視覺的粒子、文字） */
export interface TurnSnapshot {
  frame: number; turnCount: number; teamTurn: number; state: string;
  wind: number; waterY: number; rng: number; timeLeft: number;
  /** [x, y, vx, vy, hp, dead, air, face, aimA] */
  units: [number, number, number, number, number, boolean, boolean, number, number][];
  /** [cur, weapon, dmg, kills, bestTurn, ammo] */
  teams: [number, string, number, number, number, Record<string, number>][];
  graves: { x: number; y: number }[];
  mines: { x: number; y: number; vy: number; arm: number; fuse: number }[];
  crates: { x: number; y: number; para: boolean; health: boolean; item: string | null; vy: number }[];
}

export function captureSnapshot(g: Game): TurnSnapshot {
  return {
    frame: g.frame, turnCount: g.turnCount, teamTurn: g.teamTurn, state: g.state,
    wind: g.wind, waterY: g.waterY, rng: g.R.getState(), timeLeft: g.timeLeft,
    units: g.units.map(u => [u.x, u.y, u.vx, u.vy, u.hp, u.dead, u.air, u.face, u.aimA]),
    teams: g.teams.map(t => [t.cur, t.weapon, t.dmg, t.kills, t.bestTurn, { ...t.ammo }]),
    graves: g.graves.map(p => ({ x: p.x, y: p.y })),
    mines: g.mines.map(m => ({ x: m.x, y: m.y, vy: m.vy, arm: m.arm, fuse: m.fuse })),
    crates: g.crates.map(c => ({ x: c.x, y: c.y, para: c.para, health: c.health, item: c.item, vy: c.vy })),
  };
}

/** 套用房主的正式狀態。只在回合開始（全場靜止）時呼叫 */
export function applySnapshot(g: Game, s: TurnSnapshot): void {
  g.frame = s.frame; g.turnCount = s.turnCount; g.teamTurn = s.teamTurn;
  g.state = s.state as Game['state'];
  g.wind = s.wind; g.waterY = s.waterY; g.R.setState(s.rng); g.timeLeft = s.timeLeft;
  s.units.forEach(([x, y, vx, vy, hp, dead, air, face, aimA], i) => {
    const u = g.units[i]; if (!u) return;
    Object.assign(u, { x, y, vx, vy, hp, dead, air, face, aimA, grapple: null, drill: null });
  });
  s.teams.forEach(([cur, weapon, dmg, kills, bestTurn, ammo], i) => {
    const t = g.teams[i]; if (!t) return;
    Object.assign(t, { cur, weapon, dmg, kills, bestTurn, ammo: { ...ammo } });
  });
  g.graves = s.graves.map(p => ({ ...p }));
  g.mines = s.mines.map(m => ({ ...m }));
  g.crates = s.crates.map(c => ({ ...c }));
  // 回合開始時應為空的動態物件
  g.proj = []; g.flames = [];
  // 與 nextTurn() 相同的回合初始化
  g.retreatT = 0; g.charging = false; g.power = 0; g.target = null; g.idle = true; g.settleT = 0;
  g.turnDmg = 0; g.ai = null; g.keys = {}; g.jumpQ = false; g.camFree = false;
  g.lastHud = undefined; g.emit();
}

// ---------------------------------------------------------------- 雜湊

const sortKeys = (_k: string, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, (v as Record<string, unknown>)[k]]))
  : v;
/** 鍵名排序後的 JSON，確保同內容得到同字串 */
export const canonical = (v: unknown) => JSON.stringify(v, sortKeys);

export function fnv(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function maskHash(mask: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < mask.length; i++) { h ^= mask[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function stateHash(snap: TurnSnapshot, mHash: number): string {
  return fnv(canonical(snap)).toString(16).padStart(8, '0') + mHash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- 地形遮罩壓縮

/** 遊程編碼：從 0 開始交替記錄連續 0/1 的長度，以逗號分隔 */
export function encodeMask(mask: Uint8Array): string {
  const out: number[] = [];
  let cur = 0, run = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === cur) run++;
    else { out.push(run); cur = v; run = 1; }
  }
  out.push(run);
  return out.join(',');
}

export function decodeMask(s: string, size: number): Uint8Array {
  const mask = new Uint8Array(size);
  let i = 0, v = 0;
  for (const part of s.split(',')) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || i + n > size) throw new Error('地形資料格式錯誤');
    if (v) mask.fill(1, i, i + n);
    i += n; v ^= 1;
  }
  if (i !== size) throw new Error('地形資料長度不符');
  return mask;
}

/** 挖洞紀錄：[x, y, r] 依發生順序 */
export type DigLog = [number, number, number][];

/** 以初始遮罩加上所有挖洞紀錄重建地形 */
export function rebuildMask(g: Game, mask0: Uint8Array, digs: DigLog): Uint8Array {
  const saved = g.mask;
  g.mask = mask0.slice();
  for (const [x, y, r] of digs) g.digMask(x, y, r);
  const out = g.mask;
  g.mask = saved;
  return out;
}
