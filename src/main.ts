import { FurballEngine, type FurballEngineApi } from './engine';
import { RoomManager } from './net/RoomManager';
import { useEmulator } from './net/FirebaseService';

type FurballNetApi = RoomManager & { emulator: boolean };

declare global {
  interface Window { FurballEngine: FurballEngineApi; FurballNet: FurballNetApi }
}

// 大廳 UI（dc-runtime）每 80ms 輪詢 window.FurballEngine / FurballNet，出現後才啟用對應功能
window.FurballEngine = FurballEngine;
window.FurballNet = Object.assign(new RoomManager(), { emulator: useEmulator() });
