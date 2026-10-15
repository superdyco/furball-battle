// 用真實引擎（headless）驗證傷害相關的整合行為
import { describe, it, expect, beforeAll } from 'vitest';
import { loadRefactored, makeHost } from '../golden/harness';
import type { GameConfig } from '../../src/engine/types';
import { DEFAULT_AMMO, HP } from '../../src/config/GameBalance';

let api: any;
beforeAll(() => { api = loadRefactored(); });

const NAMES = ['甲', '乙', '丙', '丁'];
function newGame(over: Partial<GameConfig> = {}) {
  const cfg: GameConfig = {
    teams: [
      { name: '紅', color: '#ff7a1a', animal: 'hamster', unitNames: NAMES, ai: null },
      { name: '藍', color: '#3d8bff', animal: 'fox', unitNames: NAMES, ai: null },
    ],
    themeId: 'grass', unitsPerTeam: 2, turnTime: 45, gravity: 1, wind: false, waterRise: false, crates: false, fallDamage: true,
    ammo: { ...DEFAULT_AMMO }, hp: HP.default, seed: 42, ...over,
  };
  return api.create(makeHost(), cfg, {});
}
/** 把其他角色移到遠處，避免干擾 */
function isolate(g: any, keep: any[]) { let x = 100; for (const u of g.units) if (!keep.includes(u)) { u.x = x; u.y = 20; x += 200; } }

describe('引擎整合：爆炸', () => {
  it('同一次爆炸只扣一次血，戰績也只計一次', () => {
    const g = newGame(); const T = g.team(), foe = g.units.find((u: any) => u.team !== T);
    isolate(g, [foe]);
    g.explode(foe.x, foe.y, 42, 46);
    expect(foe.hp).toBe(100 - 46);
    expect(T.dmg).toBe(46);
    expect(g.texts.filter((t: any) => t.u === foe)).toHaveLength(1);
  });

  it('連續兩次爆炸各扣一次，傷害跳字合併', () => {
    const g = newGame(); const T = g.team(), foe = g.units.find((u: any) => u.team !== T);
    isolate(g, [foe]);
    g.explode(foe.x, foe.y, 42, 46);
    g.explode(foe.x, foe.y, 42, 46);
    expect(foe.hp).toBe(100 - 92);
    const txt = g.texts.filter((t: any) => t.u === foe);
    expect(txt).toHaveLength(1);
    expect(txt[0].txt).toBe('-92');
  });

  it('超出判定距離的角色不受傷', () => {
    const g = newGame(); const T = g.team(), foe = g.units.find((u: any) => u.team !== T);
    isolate(g, [foe]);
    g.explode(foe.x + 57, foe.y, 42, 46);
    expect(foe.hp).toBe(100);
  });

  it('發射者自己也會被爆炸波及（原版行為）', () => {
    const g = newGame(); const me = g.active();
    isolate(g, [me]);
    g.explode(me.x, me.y, 42, 46);
    expect(me.hp).toBe(54);
    expect(g.team().dmg).toBe(0); // 自傷不計入戰績
  });
});

describe('引擎整合：HP 下限', () => {
  it('過量傷害：內部 HP 可低於 0（原版行為），但 HUD、頭頂數字與戰績都不會出現負值', () => {
    const g = newGame(); const T = g.team(), foe = g.units.find((u: any) => u.team !== T);
    isolate(g, [foe]);
    let hud: any; g.cb.onHud = (h: any) => { hud = h; };
    g.hurt(foe, 150);
    expect(foe.hp).toBe(-50);
    expect(T.dmg).toBe(100);
    expect(T.kills).toBe(1);
    g.lastHud = undefined; g.emit();
    for (const t of hud.teams) expect(t.hp).toBeGreaterThanOrEqual(0);
    g.hurt(foe, 30); // 已歸零的角色再受傷：不重複計分
    expect(T.dmg).toBe(100);
    expect(T.kills).toBe(1);
  });

  it('HP <= 0 的角色在回合結算時倒下並引發死亡爆炸', () => {
    const g = newGame(); const T = g.team(), foe = g.units.find((u: any) => u.team !== T);
    isolate(g, [foe]);
    g.hurt(foe, 100);
    expect(foe.dead).toBe(false);
    g.state = 'settle';
    for (let i = 0; i < 200 && !foe.dead; i++) g.step();
    expect(foe.dead).toBe(true);
    expect(g.graves).toHaveLength(1);
  });
});

describe('引擎整合：墜落傷害', () => {
  function drop(fallDamage: boolean) {
    const g = newGame({ fallDamage }); const T = g.team(), foe = g.units.find((u: any) => u.team !== T);
    isolate(g, [foe]);
    foe.y = 30; foe.vx = 0; foe.vy = 0; foe.air = true;
    let maxVy = 0;
    for (let i = 0; i < 600 && foe.air; i++) { maxVy = Math.max(maxVy, foe.vy); g.step(); }
    return { foe, maxVy };
  }

  it('從高處落下：達到最大下落速度 13，落地扣 31，反彈後不再重複扣血', () => {
    const { foe, maxVy } = drop(true);
    expect(maxVy).toBe(13);
    expect(foe.air).toBe(false);
    expect(foe.hp).toBe(100 - 31);
  });

  it('關閉墜落傷害時不扣血', () => {
    const { foe } = drop(false);
    expect(foe.air).toBe(false);
    expect(foe.hp).toBe(100);
  });
});

describe('引擎整合：醫療箱', () => {
  it('撿到醫療箱 +30，可超過初始 HP（原版行為）', () => {
    const g = newGame(); const u = g.active();
    g.crates.push({ x: u.x, y: u.y, para: false, health: true, item: null, vy: 0 });
    g.updCrate(g.crates[0]);
    expect(u.hp).toBe(130);
  });
});
