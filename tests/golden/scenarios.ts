import type { Scenario } from './harness';
import type { GameConfig, TeamConfig, AiLevel } from '../../src/engine/types';

export const ALL_WEAPONS = ['bazooka', 'grenade', 'cluster', 'shotgun', 'airstrike', 'splitter', 'mine', 'dynamite', 'flame', 'rope', 'teleport', 'homing', 'drill', 'bat', 'bouncer'];

const DEFAULT_AMMO: Record<string, number> = { bazooka: -1, grenade: -1, cluster: 3, shotgun: -1, airstrike: 1, splitter: 2, mine: 2, dynamite: 1, flame: 2, rope: -1, teleport: 2, homing: 2, drill: 2, bat: -1, bouncer: 3 };
const UNLIMITED = Object.fromEntries(ALL_WEAPONS.map(w => [w, -1]));

const NAMES = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
const team = (name: string, color: string, animal: string, ai: AiLevel | null): TeamConfig => ({ name, color, animal, unitNames: NAMES.map(n => name + n), ai });

function cfg(over: Partial<GameConfig> & { teams: TeamConfig[] }): GameConfig {
  return {
    themeId: 'grass', unitsPerTeam: 4, turnTime: 45, gravity: 1, wind: true, waterRise: true, crates: true, fallDamage: true,
    ammo: { ...DEFAULT_AMMO }, hp: 100, ...over,
  };
}

/** 模擬真人玩家：每回合輪換一種武器，含走路、跳躍、調整瞄準、指定目標與蓄力 */
function humanScript(weapons: string[], offset = 0) {
  return (g: any, _f: number, mem: Record<string, any>) => {
    if (g.isAI() || g.state === 'over') return;
    if (mem.turn !== g.turnCount) {
      mem.turn = g.turnCount; mem.t = 0; mem.i = (mem.i ?? -1) + 1;
      mem.w = weapons[(mem.i + offset) % weapons.length];
      for (const k of ['left', 'right', 'up', 'down', 'fire']) g.input(k, false);
    }
    const t = ++mem.t, i = mem.i, u = g.active();
    if (!u) return;
    const foes = g.units.filter((v: any) => !v.dead && v.team !== u.team)
      .sort((a: any, b: any) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
    const foe = foes[0];
    if (t === 1 && i % 3 === 0) g.input(i % 2 ? 'left' : 'right', true);
    if (t === 12 && i % 4 === 1) { g.input('jump', true); g.input('jump', false); }
    if (t === 26) { g.input('left', false); g.input('right', false); }
    if (t === 28 && i % 2 === 0) g.input('up', true);
    if (t === 34) g.input('up', false);
    if (t === 40) g.selectWeapon(mem.w);
    if (t === 45 && foe) g.aimAt({ x: foe.x, y: foe.y - 120 - (i % 5) * 30 });
    if (t === 50 && foe) {
      if (mem.w === 'teleport') g.setTarget({ x: foe.x - 40, y: foe.y - 60 });
      else if (mem.w === 'airstrike' || mem.w === 'homing') g.setTarget({ x: foe.x, y: foe.y });
    }
    if (t === 55) {
      g.input('fire', true);
      if (g.state !== 'aim' || g.charging || u.grapple || u.drill) (mem.fired ??= {})[mem.w] = ((mem.fired[mem.w] as number) ?? 0) + 1;
    }
    if (t === 55 + 20 + (i * 13) % 60) g.input('fire', false);
    // 鉤爪、鑽地機不結束回合：之後改用火箭筒收尾
    if (t === 200 && g.state === 'aim') { g.selectWeapon('bazooka'); if (foe) g.aimAt({ x: foe.x, y: foe.y - 150 }); }
    if (t === 205 && g.state === 'aim') g.input('fire', true);
    if (t === 235) g.input('fire', false);
  };
}

export const SCENARIOS: Scenario[] = [
  {
    // 原版 bug：水位上升淹死最後的敵人後，AI 沿用上回合的追蹤導彈無目標發射而崩潰（瀏覽器中遊戲卡死）
    name: 'AI 三隊混戰・青青草原（全規則開啟；原版會崩潰）',
    expectCrash: /^9025: TypeError: Cannot read properties of null \(reading 'x'\)$/,
    cfg: cfg({ teams: [team('紅', '#ff7a1a', 'hamster', 'hard'), team('藍', '#3d8bff', 'fox', 'normal'), team('綠', '#22b07d', 'rabbit', 'easy')], seed: 12345 }),
    frames: 80000,
  },
  {
    name: 'AI 三隊混戰・青青草原（另一個 seed，正常打完）',
    cfg: cfg({ teams: [team('紅', '#ff7a1a', 'hamster', 'hard'), team('藍', '#3d8bff', 'fox', 'normal'), team('綠', '#22b07d', 'rabbit', 'easy')], seed: 600 }),
    frames: 80000,
  },
  {
    name: 'AI 對戰・月球基地（低重力 .6）',
    cfg: cfg({ themeId: 'moon', gravity: .6, teams: [team('紅', '#ff7a1a', 'penguin', 'hard'), team('藍', '#3d8bff', 'squirrel', 'hard')], seed: 777 }),
    frames: 80000,
  },
  {
    name: 'AI 對戰・幽暗洞窟（高重力 1.4）',
    cfg: cfg({ themeId: 'cave', gravity: 1.4, teams: [team('紅', '#ff7a1a', 'hedgehog', 'normal'), team('藍', '#3d8bff', 'hamster', 'hard')], seed: 4242 }),
    frames: 80000,
  },
  {
    name: 'AI 四隊・廢棄工廠（2 隻/隊）',
    cfg: cfg({ themeId: 'factory', unitsPerTeam: 2, teams: [team('紅', '#ff7a1a', 'fox', 'hard'), team('藍', '#3d8bff', 'rabbit', 'normal'), team('綠', '#22b07d', 'penguin', 'easy'), team('紫', '#8b5cf6', 'squirrel', 'hard')], seed: 9 }),
    frames: 80000,
  },
  {
    name: 'AI 對戰・太空站',
    cfg: cfg({ themeId: 'station', teams: [team('紅', '#ff7a1a', 'rabbit', 'hard'), team('藍', '#3d8bff', 'fox', 'normal')], seed: 2718 }),
    frames: 80000,
  },
  {
    name: 'AI 對戰・城市廢墟（無水位上升）',
    cfg: cfg({ themeId: 'ruins', waterRise: false, teams: [team('紅', '#ff7a1a', 'squirrel', 'hard'), team('藍', '#3d8bff', 'hedgehog', 'hard')], seed: 31415 }),
    frames: 80000,
  },
  {
    name: '真人腳本 vs AI・15 種武器輪替（彈藥無限，含畫面比對）',
    cfg: cfg({ ammo: { ...UNLIMITED }, waterRise: false, hp: 300, teams: [team('玩家', '#ff7a1a', 'hamster', null), team('電腦', '#3d8bff', 'fox', 'easy')], seed: 2024, unitsPerTeam: 6 }),
    frames: 60000,
    script: humanScript(ALL_WEAPONS),
    renderEvery: 97,
  },
  {
    name: '真人腳本 vs 真人腳本・烈日沙漠（無風、無空投、無墜落傷害、時間無限）',
    cfg: cfg({ themeId: 'desert', ammo: { ...UNLIMITED }, wind: false, crates: false, fallDamage: false, waterRise: false, turnTime: 0, teams: [team('甲隊', '#ff7a1a', 'rabbit', null), team('乙隊', '#3d8bff', 'penguin', null)], seed: 31337 }),
    frames: 60000,
    script: humanScript(ALL_WEAPONS, 7),
  },
  {
    name: '真人腳本 vs AI・冰雪山谷（8 隻/隊，預設彈藥）',
    cfg: cfg({ themeId: 'snow', unitsPerTeam: 8, teams: [team('玩家', '#e2438a', 'squirrel', null), team('電腦', '#22b07d', 'hamster', 'hard')], seed: 55 }),
    frames: 60000,
    script: humanScript([...ALL_WEAPONS].reverse()),
  },
];
