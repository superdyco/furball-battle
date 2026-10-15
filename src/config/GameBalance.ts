// 遊戲平衡數值的唯一來源。
// M1 原則：所有預設值都等於原版實際行為（由 tests/golden 逐幀比對保證），
// 調整任何數值都會改變遊戲手感與連線同步結果，請同步更新 tests/unit 的預期值。
// 時間單位一律為「幀」，遊戲固定以 PHYSICS.tickRate（60）幀/秒更新。

// ---------------------------------------------------------------- 生命值

export const HP = {
  /** 角色初始 HP（大廳 UI 開局時傳入 cfg.hp） */
  default: 100,
  /** 每隊預設角色數，大廳可調整範圍 */
  unitsPerTeam: 4,
  unitsPerTeamMin: 1,
  unitsPerTeamMax: 8,
  /** HP 上限；只在 allowOverheal = false 時生效 */
  maxHp: 100,
  /** 原版醫療箱沒有上限，可補超過初始 HP */
  allowOverheal: true,
  /** 醫療箱回復量 */
  medkitHeal: 30,
  /** HP <= 此值的角色會在回合結算時倒下（一次一隻） */
  deathAtOrBelow: 0,
  /** 角色倒下時原地爆炸（不顯示「砰!」字樣） */
  deathExplosion: { r: 26, dmg: 20 },
  /** 角色碰撞半徑，也計入爆炸判定距離 */
  unitRadius: 9,
} as const;

// ---------------------------------------------------------------- 爆炸

export const EXPLOSION = {
  /** 判定距離 = 爆炸半徑 + 角色半徑 + unitPadding */
  unitPadding: 6,
  /** 判定邊緣的傷害比例；中心為 100%，線性遞減到此值，超出判定距離則為 0 */
  minFactor: .35,
  /** 擊退力 = (knockBase + f × 爆炸半徑 × knockPerRadius) × 武器擊退倍率 */
  knockBase: 1.5,
  knockPerRadius: .12,
  /** 擊退方向以爆炸點下方 upBias px 為原點，讓角色傾向往上飛 */
  upBias: 6,
  /** 擊退時額外向上的速度 */
  lift: 1,
  /** 爆炸半徑 + minePad 內的地雷會在 mineChainFuse 幀內被引爆 */
  minePad: 12,
  mineChainFuse: 10,
  /** 爆炸半徑 + cratePad 內的補給箱會被摧毀 */
  cratePad: 10,
  /** 半徑 >= 此值且非 quiet 的爆炸會顯示擬聲字 */
  bigBoomRadius: 28,
} as const;

// ---------------------------------------------------------------- 墜落傷害

export const FALL = {
  /** 大廳「掉落傷害」開關的預設值 */
  enabledDefault: true,
  /** 落地垂直速度超過此值才受傷 */
  minSpeed: 6.8,
  /** 傷害 = round((vy - minSpeed) × multiplier) */
  multiplier: 5,
  /** 單次墜落傷害上限；null 表示不限（原版行為，實際上受 PHYSICS.unitMaxFallSpeed 限制最多 31） */
  maxDamage: null as number | null,
} as const;

// ---------------------------------------------------------------- 物理

export const PHYSICS = {
  /** 固定更新頻率（幀/秒）、每次畫面最多補算幾幀、單次畫面時間上限（毫秒） */
  tickRate: 60,
  maxStepsPerFrame: 5,
  maxFrameMs: 100,

  /** 重力 = baseGravity × 地圖重力 × 大廳重力（.6 / 1 / 1.4） */
  baseGravity: .2,
  /** 下落速度上限 */
  unitMaxFallSpeed: 13,
  mineMaxFallSpeed: 8,
  crateMaxFallSpeed: 8,

  /** 移動：每幀水平位移、可自動爬升與貼地的高度 */
  walkSpeed: .9,
  walkClimb: 6,
  walkSnap: 6,
  /** 卡進地形時往上推出的最大距離 */
  unstuckMax: 14,
  /** 跳躍初速 */
  jumpVx: 2.3,
  jumpVy: -4.3,
  /** 落地速度超過此值會反彈，反彈後保留的速度比例 */
  landBounceSpeed: 4.5,
  landBounceVy: -.3,
  landBounceVx: .55,
  /** 撞牆時水平速度乘數 */
  wallBounce: -.3,

  /** 瞄準：按鍵每幀轉動量、角度上下限（弧度） */
  aimStep: .025,
  aimLimit: 1.55,
  /** 蓄力滿格所需幀數，滿格自動發射 */
  chargeFrames: 70,
  /** 砲彈初速 = shotSpeedMin + 力道(0~1) × shotSpeedRange */
  shotSpeedMin: 2,
  shotSpeedRange: 12.5,
  /** 發射點與角色中心的距離 */
  muzzleOffset: 14,

  /** 每回合風力 = round((R×2-1) × windMax × windSteps) / windSteps，範圍 ±windMax */
  windMax: 1,
  windSteps: 10,
  /** 受風砲彈每幀水平加速 = 風力 × projectileWind */
  projectileWind: .04,
  flameWind: .02,
  crateWind: .5,

  /** 砲彈反彈預設係數、每次反彈的水平摩擦、計入反彈次數的最低速度 */
  projectileDamp: .5,
  projectileBounceFriction: .9,
  projectileMinBounceSpeed: 1.2,
  /** 砲彈命中角色的判定 = 角色半徑 + projectileHitPad；發射後 armFrames 幀才會撞人，發射者 ownerSafeFrames 幀內不會被自己的砲彈撞到 */
  projectileHitPad: 4,
  projectileArmFrames: 2,
  ownerSafeFrames: 15,

  /** 地圖與水面 */
  mapWidth: 1800,
  mapHeight: 900,
  waterLevel: 900 - 45,
  waterRisePerTurn: 12,
  /** 角色低於水面 drownDepth、或超出地圖左右 outOfBoundsX 即死亡 */
  drownDepth: 6,
  outOfBoundsX: 60,
} as const;

// ---------------------------------------------------------------- 回合

export const TURN = {
  /** 大廳預設回合秒數（0 = 無限） */
  defaultSeconds: 45,
  /** 開火後撤退時間 */
  retreatFrames: 180,
  /** 全場靜止後再等待幾幀才結算 */
  settleFrames: 35,
} as const;

// ---------------------------------------------------------------- 空投

export const CRATES = {
  /** 第 2 回合起每回合空投機率、其中醫療箱比例 */
  dropChance: .4,
  healthChance: .4,
  /** 武器箱給予的彈藥數（無限彈藥的武器不加） */
  weaponAmmo: 1,
  /** 降落傘下降速度、撿取判定範圍 */
  paraSpeed: 1.4,
  pickupX: 20,
  pickupY: 22,
} as const;

// ---------------------------------------------------------------- 武器

/** 爆炸彈頭：半徑、基礎傷害、擊退倍率（預設 1） */
export interface Warhead { r: number; dmg: number; kb?: number }

/** 拋射物外觀與飛行特性；bounce 為反彈係數（未設定代表碰到即爆） */
export interface ProjectileSpec { kind: string; bounce?: number; fuse?: number; maxBounces?: number }

export interface WeaponBalance {
  id: string;
  name: string;
  /** 武器圖示上的單字、主色、說明文字（大廳 UI 使用） */
  ch: string;
  color: string;
  desc: string;
  /** 預設彈藥：-1 = 無限 */
  ammo: number;
  /** 需要蓄力 / 需要點選地圖目標 */
  charge?: boolean;
  target?: boolean;
  /** 主彈頭是否受風影響 */
  wind: boolean;
  /** 使用後是否結束回合（鉤爪、鑽地機不結束） */
  endsTurn: boolean;
  /** 撤退時間；未設定則用 TURN.retreatFrames */
  retreatFrames?: number;
  warhead?: Warhead;
  projectile?: ProjectileSpec;
  /** 主彈頭爆炸後散出的子彈頭（不受風、碰到即爆、會炸到任何人） */
  submunition?: {
    kind: string; count: number; r: number; dmg: number;
    /** cluster：隨機水平速度 ±vxSpread/2、垂直速度 -(vyMin + R×vyRange)；frag：扇形 speed / spreadAngle */
    vxSpread?: number; vyMin?: number; vyRange?: number; spawnLift: number;
    speed?: number; spreadAngle?: number;
  };
  /** 特殊效果參數，依武器而異 */
  special?: Record<string, number | readonly number[]>;
}

const w = <const T extends WeaponBalance>(x: T) => x;

export const WEAPONS = [
  w({ id: 'bazooka', name: '火箭筒', ch: '火', color: '#ff7a1a', desc: '蓄力發射,受風影響', ammo: -1, charge: true, wind: true, endsTurn: true,
    warhead: { r: 42, dmg: 46 }, projectile: { kind: 'rocket' } }),
  w({ id: 'grenade', name: '手榴彈', ch: '榴', color: '#43a047', desc: '會彈跳,3 秒後爆炸', ammo: -1, charge: true, wind: false, endsTurn: true,
    warhead: { r: 44, dmg: 48 }, projectile: { kind: 'grenade', bounce: .45, fuse: 180 } }),
  w({ id: 'cluster', name: '集束彈', ch: '集', color: '#e94e77', desc: '爆炸後散出 5 顆子彈', ammo: 3, charge: true, wind: false, endsTurn: true,
    warhead: { r: 30, dmg: 26 }, projectile: { kind: 'grenade', bounce: .45, fuse: 180 },
    submunition: { kind: 'bomblet', count: 5, r: 22, dmg: 18, vxSpread: 6, vyMin: 3, vyRange: 4, spawnLift: 6 } }),
  w({ id: 'shotgun', name: '霰彈槍', ch: '霰', color: '#8d6e63', desc: '瞬間雙發射擊', ammo: -1, wind: false, endsTurn: true,
    // 兩發射線，各自命中角色或地形時產生小爆炸（不顯示擬聲字）
    special: { pelletAngles: [-.035, .035], muzzle: 12, range: 700, stepPx: 3, hitPad: 2,
      unitR: 14, unitDmg: 22, unitKb: 1.6, terrainR: 14, terrainDmg: 20, traceFrames: 10 } }),
  w({ id: 'airstrike', name: '空襲', ch: '空', color: '#3d8bff', desc: '點選位置,5 枚飛彈落下', ammo: 1, target: true, wind: true, endsTurn: true,
    warhead: { r: 30, dmg: 28 }, projectile: { kind: 'missile' },
    // 第 i 枚：x = 目標x + offsetX + i×spacing - 風力×windLead，y = startY - i×stagger
    special: { count: 5, offsetX: -100, spacing: 50, windLead: 60, startY: -40, stagger: 22, windVx: 1.5, vy: 5 } }),
  w({ id: 'splitter', name: '分裂彈', ch: '裂', color: '#f2a900', desc: '命中後分裂成 3 顆', ammo: 2, charge: true, wind: true, endsTurn: true,
    warhead: { r: 30, dmg: 30 }, projectile: { kind: 'rocket' },
    submunition: { kind: 'frag', count: 3, r: 26, dmg: 24, speed: 5, spreadAngle: .6, spawnLift: 8 } }),
  w({ id: 'mine', name: '地雷', ch: '雷', color: '#546e7a', desc: '放在腳邊,有人靠近就爆', ammo: 2, wind: false, endsTurn: true,
    warhead: { r: 40, dmg: 45 },
    special: { placeOffset: 14, armFrames: 100, triggerRadius: 26, fuseFrames: 50 } }),
  w({ id: 'dynamite', name: '炸藥', ch: '炸', color: '#d32f2f', desc: '5 秒後超大爆炸', ammo: 1, wind: false, endsTurn: true,
    warhead: { r: 72, dmg: 72 }, projectile: { kind: 'dynamite', bounce: .2, fuse: 300 },
    special: { offsetX: 10, offsetY: -4, vx: 1.2, vy: -1.5 } }),
  w({ id: 'flame', name: '火焰瓶', ch: '焰', color: '#ff5722', desc: '灑出火焰持續燃燒', ammo: 2, charge: true, wind: true, endsTurn: true,
    warhead: { r: 16, dmg: 12 }, projectile: { kind: 'bottle' },
    // 碎裂後灑出 count 團火，每團持續 lifeMin + R×lifeRange 幀；每 tickFrames 幀對 radius 內角色造成 dmg 並推開
    special: { count: 16, spreadVx: 5, carryVx: .2, vyMin: 1, vyRange: 4, lifeMin: 220, lifeRange: 120,
      tickFrames: 15, radius: 14, dmg: 2, knockUp: .8, knockSide: .5, digChance: .35, digR: 6 } }),
  w({ id: 'rope', name: '鉤爪', ch: '鉤', color: '#795548', desc: '把自己拉過去,不結束回合', ammo: -1, wind: false, endsTurn: false,
    special: { minDist: 14, range: 380, stepPx: 3, pullSpeed: 6.5, maxFrames: 80, releaseDist: 16, releaseDamp: .5 } }),
  w({ id: 'teleport', name: '傳送', ch: '傳', color: '#8b5cf6', desc: '點選位置瞬間移動', ammo: 2, target: true, wind: false, endsTurn: true, retreatFrames: 120,
    special: { edgeMargin: 10, minY: -100, waterMargin: 15 } }),
  w({ id: 'homing', name: '追蹤導彈', ch: '導', color: '#00acc1', desc: '先點目標,再蓄力發射', ammo: 2, target: true, charge: true, wind: false, endsTurn: true,
    warhead: { r: 40, dmg: 42 }, projectile: { kind: 'rocket' },
    // 發射 delay 幀後開始追蹤（追蹤期間不受重力），每幀最多轉 turnRate 弧度、加速 accel，直到 duration 幀
    special: { delay: 20, turnRate: .09, accel: .15, maxSpeed: 9, duration: 320 } }),
  w({ id: 'drill', name: '鑽地機', ch: '鑽', color: '#607d8b', desc: '往瞄準方向鑽隧道', ammo: 2, wind: false, endsTurn: false,
    special: { frames: 55, digAhead: 6, digR: 13, speed: 1.6, debrisEvery: 6, debrisAhead: 12, debrisCount: 2 } }),
  w({ id: 'bat', name: '棒球棍', ch: '棍', color: '#a1887f', desc: '近戰,把敵人打飛', ammo: -1, wind: false, endsTurn: true,
    // 固定傷害、無距離衰減、不破壞地形；直接設定被打者速度為 (方向×launch, 方向×launch - lift)
    special: { reach: 14, radius: 24, dmg: 28, launch: 9, lift: 3 } }),
  w({ id: 'bouncer', name: '跳跳彈', ch: '跳', color: '#ec407a', desc: '彈跳 7 次後爆炸', ammo: 3, charge: true, wind: false, endsTurn: true,
    warhead: { r: 34, dmg: 34 }, projectile: { kind: 'ball', bounce: .78, maxBounces: 7, fuse: 420 } }),
] as const;

export type WeaponId = typeof WEAPONS[number]['id'];

export const WEAPON_BY_ID: Record<string, WeaponBalance> = Object.fromEntries(WEAPONS.map(x => [x.id, x]));

type WeaponOf<I extends WeaponId> = Extract<typeof WEAPONS[number], { id: I }>;
/** 依 ID 取得武器設定（保留各武器 special 欄位的型別） */
export const weaponSpec = <I extends WeaponId>(id: I) => WEAPON_BY_ID[id] as WeaponOf<I>;

/** 預設彈藥表（大廳初始值） */
export const DEFAULT_AMMO: Record<string, number> = Object.fromEntries(WEAPONS.map(x => [x.id, x.ammo]));

/** 一次使用最多可造成的理論傷害總和（所有彈頭都正中同一目標時），用於平衡參考 */
export function maxTheoreticalDamage(id: WeaponId): number {
  const x = WEAPON_BY_ID[id];
  if (id === 'shotgun') { const s = weaponSpec('shotgun').special; return s.pelletAngles.length * s.unitDmg; }
  if (id === 'airstrike') return weaponSpec('airstrike').special.count * x.warhead!.dmg;
  if (id === 'bat') return weaponSpec('bat').special.dmg;
  // 火焰瓶的持續燃燒傷害視停留時間而定，不計入
  return (x.warhead?.dmg ?? 0) + (x.submunition ? x.submunition.count * x.submunition.dmg : 0);
}
