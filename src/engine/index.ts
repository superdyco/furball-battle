import { Game } from './Game';
import { drawThumb, drawIcon } from './art';
import { THEMES, ANIMALS } from './themes';
import { WEAPONS } from './weapons';
import type { GameConfig, GameCallbacks } from './types';

// 與原版 window.FurballEngine 完全相同的對外介面（大廳 UI 依賴它）
export const FurballEngine = {
  create: (el: HTMLElement, cfg: GameConfig, cb?: GameCallbacks) => new Game(el, cfg, cb),
  drawThumb,
  drawIcon,
  THEMES,
  WEAPONS,
  ANIMALS,
};

export type FurballEngineApi = typeof FurballEngine;
export { Game };
