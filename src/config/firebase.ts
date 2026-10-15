// Firebase 前端設定。這些值本來就會公開在網頁中，安全性由 database.rules.json 與 Auth 把關；
// 嚴禁在前端放入管理員憑證或 Service Account 私鑰。
export const firebaseConfig = {
  apiKey: 'AIzaSyDE-dtZc-cv2cHNWqpqOmUIh9YC6czefUI',
  authDomain: 'furball-battle.firebaseapp.com',
  databaseURL: 'https://furball-battle-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'furball-battle',
  storageBucket: 'furball-battle.firebasestorage.app',
  messagingSenderId: '1021579768786',
  appId: '1:1021579768786:web:b24ad0914400fbbdb0ce0b',
};

/** 本機 Emulator（npm run dev:emu、端對端測試）：不會連到正式資料庫 */
export const emulatorConfig = {
  projectId: 'demo-furball',
  databaseURL: 'http://127.0.0.1:9000/?ns=demo-furball-default-rtdb',
  authUrl: 'http://127.0.0.1:9099',
  dbHost: '127.0.0.1',
  dbPort: 9000,
};
