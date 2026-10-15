import { FurballEngine, type FurballEngineApi } from './engine';

declare global {
  interface Window { FurballEngine: FurballEngineApi }
}

// 大廳 UI（dc-runtime）每 80ms 輪詢 window.FurballEngine，出現後才啟用遊戲功能
window.FurballEngine = FurballEngine;
