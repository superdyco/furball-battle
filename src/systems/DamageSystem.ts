// 傷害計算：全部為純函式，不讀寫遊戲狀態，方便單元測試與日後連線同步時在房主端重算。
// 公式與原版逐字相同（含 Math.round 的位置），由 tests/golden 逐幀比對保證。
import { HP, EXPLOSION, FALL } from '../config/GameBalance';

// ---------------------------------------------------------------- 爆炸

/** 爆炸對某角色的有效判定距離（角色半徑計入） */
export function explosionReach(radius: number, unitR: number): number {
  return radius + unitR + EXPLOSION.unitPadding;
}

/**
 * 距離衰減係數 f：爆炸中心為 1，判定邊緣趨近 0；超出判定距離回傳 null（不受影響）。
 * dist 為爆炸點到角色中心的距離。
 */
export function explosionFalloff(dist: number, radius: number, unitR: number): number | null {
  const reach = explosionReach(radius, unitR);
  if (!(dist < reach)) return null;
  return 1 - dist / reach;
}

/** 爆炸傷害：中心為基礎傷害 100%，邊緣為 minFactor（35%），四捨五入為整數 */
export function explosionDamage(baseDmg: number, f: number): number {
  return Math.round(baseDmg * (EXPLOSION.minFactor + (1 - EXPLOSION.minFactor) * f));
}

/** 爆炸擊退造成的速度變化 */
export function explosionImpulse(ex: number, ey: number, ux: number, uy: number, radius: number, f: number, kb?: number) {
  const a = Math.atan2(uy - ey - EXPLOSION.upBias, ux - ex);
  const k = (EXPLOSION.knockBase + f * radius * EXPLOSION.knockPerRadius) * (kb || 1);
  return { dvx: Math.cos(a) * k, dvy: Math.sin(a) * k - EXPLOSION.lift };
}

// ---------------------------------------------------------------- 墜落

/** 落地時的墜落傷害；未開啟或速度未達門檻為 0 */
export function fallDamage(vy: number, enabled: boolean): number {
  if (!enabled || !(vy > FALL.minSpeed)) return 0;
  const dmg = Math.round((vy - FALL.minSpeed) * FALL.multiplier);
  return FALL.maxDamage == null ? dmg : Math.min(dmg, FALL.maxDamage);
}

// ---------------------------------------------------------------- HP 增減

/**
 * 一次傷害事件的戰績結算：計入的傷害量不超過剩餘 HP（不為負），
 * 以及這次是否造成擊倒（原本 HP > 0 且扣完 <= 0）。
 */
export function damageCredit(hp: number, dmg: number): { credited: number; kill: boolean } {
  return { credited: Math.min(dmg, Math.max(0, hp)), kill: hp > 0 && hp - dmg <= 0 };
}

/**
 * 扣血後的 HP。原版行為：HP 可以低於 0（畫面與戰績一律以 displayHp 呈現），
 * 角色要到回合結算時才倒下。
 */
export function hpAfterDamage(hp: number, dmg: number): number {
  return hp - dmg;
}

/** 畫面與 HUD 顯示用的 HP，不會是負值 */
export function displayHp(hp: number): number {
  return Math.max(0, hp);
}

/** 補血後的 HP；allowOverheal 為 false 時不超過 maxHp（但不會把原本已超過上限的 HP 往下扣） */
export function hpAfterHeal(hp: number, amount: number, allowOverheal: boolean = HP.allowOverheal, maxHp: number = HP.maxHp): number {
  if (allowOverheal) return hp + amount;
  return Math.max(hp, Math.min(maxHp, hp + amount));
}

/** 回合結算時是否倒下 */
export function isDying(u: { dead: boolean; hp: number }): boolean {
  return !u.dead && u.hp <= HP.deathAtOrBelow;
}
