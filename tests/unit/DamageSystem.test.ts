import { describe, it, expect } from 'vitest';
import {
  explosionReach, explosionFalloff, explosionDamage, explosionImpulse, fallDamage,
  damageCredit, hpAfterDamage, hpAfterHeal, displayHp, isDying,
} from '../../src/systems/DamageSystem';
import { HP, EXPLOSION, FALL, PHYSICS, WEAPONS, weaponSpec, maxTheoreticalDamage, DEFAULT_AMMO } from '../../src/config/GameBalance';

const UNIT_R = HP.unitRadius;

describe('爆炸傷害公式', () => {
  it('判定距離 = 爆炸半徑 + 角色半徑 + 6（角色半徑有納入判定）', () => {
    expect(explosionReach(42, 9)).toBe(57);
    expect(explosionReach(30, 9)).toBe(45);
  });

  it('爆炸中心傷害 = 基礎傷害', () => {
    for (const w of WEAPONS) if ('warhead' in w) expect(explosionDamage(w.warhead.dmg, explosionFalloff(0, w.warhead.r, UNIT_R)!)).toBe(w.warhead.dmg);
  });

  it('符合原版公式 round(dmg × (0.35 + 0.65 × f))，f = 1 - d / 判定距離', () => {
    // 火箭筒 r42 dmg46，判定距離 57
    const cases: [number, number][] = [[0, 46], [10, 41], [28.5, 31], [40, 25], [56, 17], [56.99, 16]];
    for (const [d, want] of cases) {
      const f = 1 - d / 57;
      expect(Math.round(46 * (.35 + .65 * f))).toBe(want); // 測試本身的預期值
      expect(explosionDamage(46, explosionFalloff(d, 42, UNIT_R)!)).toBe(want);
    }
  });

  it('越靠近中心傷害越高（單調遞減），邊緣約為 35%', () => {
    let prev = Infinity;
    for (let d = 0; d < 57; d += .5) {
      const dmg = explosionDamage(46, explosionFalloff(d, 42, UNIT_R)!);
      expect(dmg).toBeLessThanOrEqual(prev);
      prev = dmg;
    }
    expect(explosionDamage(46, explosionFalloff(0, 42, UNIT_R)!)).toBeGreaterThan(explosionDamage(46, explosionFalloff(56, 42, UNIT_R)!));
    expect(explosionDamage(100, 0)).toBe(Math.round(100 * EXPLOSION.minFactor));
  });

  it('剛好在判定距離上或超出範圍：不受影響', () => {
    expect(explosionFalloff(57, 42, UNIT_R)).toBeNull();
    expect(explosionFalloff(57.0001, 42, UNIT_R)).toBeNull();
    expect(explosionFalloff(500, 42, UNIT_R)).toBeNull();
    expect(explosionFalloff(56.9999, 42, UNIT_R)).not.toBeNull();
  });

  it('傷害永遠是非負整數', () => {
    for (const w of WEAPONS) if ('warhead' in w) for (let d = 0; d < 120; d += 1.7) {
      const f = explosionFalloff(d, w.warhead.r, UNIT_R);
      if (f === null) continue;
      const dmg = explosionDamage(w.warhead.dmg, f);
      expect(Number.isInteger(dmg)).toBe(true);
      expect(dmg).toBeGreaterThanOrEqual(0);
    }
  });

  it('擊退：方向背離爆炸點並帶向上分量，中心越近越強，霰彈槍倍率 1.6', () => {
    const near = explosionImpulse(100, 100, 110, 100, 42, .9);
    const far = explosionImpulse(100, 100, 110, 100, 42, .1);
    expect(near.dvx).toBeGreaterThan(0);
    expect(near.dvy).toBeLessThan(0);
    expect(Math.hypot(near.dvx, near.dvy + EXPLOSION.lift)).toBeGreaterThan(Math.hypot(far.dvx, far.dvy + EXPLOSION.lift));
    const kb = explosionImpulse(100, 100, 110, 100, 14, .5, 1.6), base = explosionImpulse(100, 100, 110, 100, 14, .5);
    expect(kb.dvx).toBeCloseTo(base.dvx * 1.6, 12);
    // 原版公式：k = (1.5 + f × r × 0.12) × kb，角度以爆炸點下方 6px 為原點
    const a = Math.atan2(100 - 100 - 6, 110 - 100), k = (1.5 + .9 * 42 * .12);
    expect(near).toEqual({ dvx: Math.cos(a) * k, dvy: Math.sin(a) * k - 1 });
  });
});

describe('墜落傷害', () => {
  it('落地速度未超過 6.8：不扣血', () => {
    for (const vy of [0, 3, 6.5, 6.8]) expect(fallDamage(vy, true)).toBe(0);
  });

  it('超過門檻：round((vy - 6.8) × 5)', () => {
    expect(fallDamage(7, true)).toBe(1);
    expect(fallDamage(8.8, true)).toBe(10);
    expect(fallDamage(10, true)).toBe(16);
    expect(fallDamage(PHYSICS.unitMaxFallSpeed, true)).toBe(31); // 最大下落速度 13 → 單次最多 31
    for (let vy = 6.81; vy <= 13; vy += .37) expect(fallDamage(vy, true)).toBe(Math.round((vy - FALL.minSpeed) * FALL.multiplier));
  });

  it('關閉墜落傷害時一律為 0', () => {
    expect(fallDamage(13, false)).toBe(0);
  });

  it('預設沒有單次上限（原版行為）', () => {
    expect(FALL.maxDamage).toBeNull();
  });
});

describe('HP 增減', () => {
  it('顯示用 HP 不會是負值', () => {
    for (const hp of [100, 1, 0, -1, -50]) expect(displayHp(hp)).toBeGreaterThanOrEqual(0);
    expect(displayHp(-36)).toBe(0);
    expect(displayHp(54)).toBe(54);
  });

  it('戰績計入的傷害不超過剩餘 HP，也不為負', () => {
    expect(damageCredit(100, 46)).toEqual({ credited: 46, kill: false });
    expect(damageCredit(30, 46)).toEqual({ credited: 30, kill: true });
    expect(damageCredit(46, 46)).toEqual({ credited: 46, kill: true });
    // 已經 <= 0 但尚未結算的角色再受傷：不重複計分、不重複算擊倒
    expect(damageCredit(-10, 20)).toEqual({ credited: 0, kill: false });
    expect(damageCredit(0, 20)).toEqual({ credited: 0, kill: false });
  });

  it('扣血：原版允許內部 HP 低於 0，等回合結算才倒下', () => {
    expect(hpAfterDamage(30, 46)).toBe(-16);
    expect(isDying({ dead: false, hp: -16 })).toBe(true);
    expect(isDying({ dead: false, hp: 0 })).toBe(true);
    expect(isDying({ dead: false, hp: 1 })).toBe(false);
    expect(isDying({ dead: true, hp: -16 })).toBe(false);
  });

  it('醫療箱：預設允許超過初始 HP（原版行為）', () => {
    expect(HP.allowOverheal).toBe(true);
    expect(hpAfterHeal(100, HP.medkitHeal)).toBe(130);
    expect(hpAfterHeal(-10, 30)).toBe(20);
  });

  it('醫療箱：關閉超補時不超過上限，也不會扣掉原本已超過上限的 HP', () => {
    expect(hpAfterHeal(90, 30, false, 100)).toBe(100);
    expect(hpAfterHeal(50, 30, false, 100)).toBe(80);
    expect(hpAfterHeal(120, 30, false, 100)).toBe(120);
  });
});

describe('武器設定', () => {
  it('15 種武器，ID 不重複', () => {
    expect(WEAPONS).toHaveLength(15);
    expect(new Set(WEAPONS.map(w => w.id)).size).toBe(15);
  });

  it('數值與原版相同（防止重構時誤改平衡）', () => {
    const table = Object.fromEntries(WEAPONS.map(w => [w.id, 'warhead' in w ? [w.warhead.r, w.warhead.dmg] : null]));
    expect(table).toEqual({
      bazooka: [42, 46], grenade: [44, 48], cluster: [30, 26], shotgun: null, airstrike: [30, 28], splitter: [30, 30],
      mine: [40, 45], dynamite: [72, 72], flame: [16, 12], rope: null, teleport: null, homing: [40, 42], drill: null, bat: null, bouncer: [34, 34],
    });
    expect(DEFAULT_AMMO).toEqual({ bazooka: -1, grenade: -1, cluster: 3, shotgun: -1, airstrike: 1, splitter: 2, mine: 2, dynamite: 1, flame: 2, rope: -1, teleport: 2, homing: 2, drill: 2, bat: -1, bouncer: 3 });
    expect(Object.fromEntries(WEAPONS.map(w => [w.id, w.wind]))).toMatchObject({ bazooka: true, splitter: true, airstrike: true, flame: true, grenade: false, homing: false, dynamite: false });
  });

  it('多段武器：理論最大總傷害', () => {
    expect(maxTheoreticalDamage('cluster')).toBe(26 + 5 * 18);
    expect(maxTheoreticalDamage('splitter')).toBe(30 + 3 * 24);
    expect(maxTheoreticalDamage('airstrike')).toBe(5 * 28);
    expect(maxTheoreticalDamage('shotgun')).toBe(2 * 22);
    expect(maxTheoreticalDamage('bazooka')).toBe(46);
    expect(maxTheoreticalDamage('bat')).toBe(28);
  });

  it('多段武器：每顆子彈頭各自依距離衰減計算', () => {
    const c = weaponSpec('cluster').submunition, s = weaponSpec('splitter').submunition;
    expect(explosionDamage(c.dmg, explosionFalloff(0, c.r, UNIT_R)!)).toBe(18);
    expect(explosionDamage(s.dmg, explosionFalloff(0, s.r, UNIT_R)!)).toBe(24);
    // 主彈頭正中 + 5 顆子彈頭都在判定邊緣附近
    const edge = explosionDamage(c.dmg, explosionFalloff(explosionReach(c.r, UNIT_R) - .01, c.r, UNIT_R)!);
    expect(edge).toBe(Math.round(18 * .35));
    expect(26 + 5 * edge).toBe(26 + 5 * 6);
  });
});
