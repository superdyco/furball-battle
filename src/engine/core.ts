import { PHYSICS } from '../config/GameBalance';

export const W = PHYSICS.mapWidth, H = PHYSICS.mapHeight, INK = '#2b1d14', PI = Math.PI;

export const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;

export type Rng = (() => number) & {
  /** 目前的內部狀態（連線同步用） */
  getState(): number;
  setState(s: number): void;
};

// xorshift32；所有遊戲隨機（地形、出生點、風、空投、粒子、AI）共用同一個實例，
// 呼叫順序即遊戲結果的一部分，不可任意增減或重排 R() 呼叫。
export function rng(seed: number): Rng {
  let s = (seed >>> 0) || 123456789;
  const R = (() => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }) as Rng;
  R.getState = () => s;
  R.setState = v => { s = v >>> 0; };
  return R;
}

export function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

export function tint(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = mk(src.width, src.height), x = c.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
