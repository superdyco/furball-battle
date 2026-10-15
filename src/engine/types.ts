import type { Rng } from './core';

export type AiLevel = 'easy' | 'normal' | 'hard';
export type Ammo = Record<string, number>;

export interface TeamConfig {
  name: string;
  color: string;
  animal: string;
  unitNames: string[];
  ai: AiLevel | null;
}

export interface GameConfig {
  teams: TeamConfig[];
  themeId: string;
  unitsPerTeam: number;
  turnTime: number;
  gravity: number;
  wind: boolean;
  waterRise: boolean;
  crates: boolean;
  fallDamage: boolean;
  ammo: Ammo;
  hp: number;
  seed?: number;
  /** 連線模式：由外部（NetGame）驅動 step/render，不自行啟動 requestAnimationFrame */
  externalLoop?: boolean;
}

export interface Team extends TeamConfig {
  idx: number;
  ammo: Ammo;
  cur: number;
  weapon: string;
  units: Unit[];
  dmg: number;
  kills: number;
  bestTurn: number;
}

export interface Unit {
  team: Team;
  name: string;
  x: number; y: number; vx: number; vy: number;
  r: number;
  hp: number;
  face: number;
  aimA: number;
  air: boolean;
  dead: boolean;
  grapple?: { x: number; y: number; t: number } | null;
  drill?: { t: number; dx: number; dy: number } | null;
}

export interface Projectile {
  t: number;
  damp: number;
  x: number; y: number; vx: number; vy: number;
  kind: string;
  owner?: Unit;
  color?: string;
  wind?: number;
  r?: number;
  dmg?: number;
  bounce?: number;
  fuse?: number;
  bmax?: number;
  bc?: number;
  cluster?: number;
  split?: number;
  fire?: number;
  homing?: number;
  tx?: number; ty?: number;
  dead?: boolean;
}

export interface Particle {
  type: string;
  x: number; y: number;
  vx?: number; vy?: number;
  size?: number;
  col?: string;
  life: number; max: number;
  g?: number;
  r0?: number; r1?: number;
  x2?: number; y2?: number;
}

export interface Flame { x: number; y: number; vx: number; vy: number; life: number; stuck: boolean }
export interface Mine { x: number; y: number; vy: number; arm: number; fuse: number; dead?: boolean }
export interface Crate { x: number; y: number; para: boolean; health: boolean; item: string | null; vy: number; dead?: boolean }
export interface FloatText { u?: Unit; n?: number; x: number; y: number; txt: string; col: string; size: number; life: number; max: number }
export interface Point { x: number; y: number }

export interface AiPlan {
  weapon?: string;
  face?: number;
  ang?: number;
  charge?: number;
  pw?: number;
  tx?: number | null;
  ty?: number;
}

export interface AiState extends AiPlan {
  turn: number;
  t: number;
  phase: 'think' | 'act' | 'charge' | 'done';
  fails: number;
  tset?: boolean;
}

/**
 * 連線模式的玩家輸入事件（記錄於幀邊界，對手依幀號重播）
 * k：按鍵 [名稱, 1=按下/0=放開]；p：滑鼠瞄準的世界座標（套用後轉成 a）；a：瞄準結果 [face, aimA]；
 * fd/fu：發射鍵按下/放開；t：點選目標座標；w：切換武器
 */
export type NetEvent =
  | ['k', string, 0 | 1] | ['p', number, number] | ['a', number, number]
  | ['fd'] | ['fu'] | ['t', number, number] | ['w', string];

export interface NetHooks {
  /** UI 輸入：由連線層決定是否接受（只有輪到自己時），並在下一個幀邊界套用 */
  ui(g: unknown, ev: NetEvent): void;
  /** 每幀 step() 開始前呼叫：套用本機輸入並記錄，或重播對手輸入 */
  beforeStep(g: unknown): void;
  /** nextTurn() 結束時呼叫：回合交界的狀態校驗 */
  onTurnStart(g: unknown): void;
  /** 地形被挖：房主記錄挖洞紀錄，供對手重建地形 */
  onDig(x: number, y: number, r: number): void;
  isRemoteTurn(g: unknown): boolean;
}

export interface HudTeam { name: string; color: string; animal: string; hp: number; max: number; alive: number }
export interface Hud {
  ai: AiLevel | null; state: string; turn: number; unit: string; time: number; timer: boolean; retreat: number;
  wind: number; weapon: string; ammo: Ammo; msg: string; needTarget: boolean; teams: HudTeam[];
  /** 連線模式：目前是否為對手回合 */
  remote?: boolean;
}

export interface MatchStat { name: string; color: string; animal: string; ai: AiLevel | null; dmg: number; kills: number; bestTurn: number; won: boolean }

export interface GameCallbacks {
  onHud?: (h: Hud) => void;
  onGameOver?: (winner: { name: string; color: string; animal: string } | null, stats: MatchStat[]) => void;
  onToggleWeapons?: () => void;
}

export type { Rng };
