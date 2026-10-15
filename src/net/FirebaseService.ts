// Firebase 連線與匿名登入
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously, setPersistence, browserSessionPersistence, onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator, ref, onValue, type Database } from 'firebase/database';
import { firebaseConfig, emulatorConfig } from '../config/firebase';

export interface FirebaseHandles { app: FirebaseApp; auth: Auth; db: Database; emulator: boolean }

let handles: FirebaseHandles | null = null;

/** 網址帶 ?emulator=1 或以 VITE_FIREBASE_EMULATOR=1 建置時，改連本機 Emulator */
export function useEmulator(): boolean {
  if (import.meta.env.VITE_FIREBASE_EMULATOR === '1') return true;
  try { return new URLSearchParams(location.search).get('emulator') === '1'; } catch { return false; }
}

export function firebase(): FirebaseHandles {
  if (handles) return handles;
  const emulator = useEmulator();
  const app = initializeApp(emulator ? { ...firebaseConfig, projectId: emulatorConfig.projectId, databaseURL: emulatorConfig.databaseURL } : firebaseConfig);
  const auth = getAuth(app);
  const db = getDatabase(app);
  if (emulator) {
    connectAuthEmulator(auth, emulatorConfig.authUrl, { disableWarnings: true });
    connectDatabaseEmulator(db, emulatorConfig.dbHost, emulatorConfig.dbPort);
  }
  return (handles = { app, auth, db, emulator });
}

/**
 * 匿名登入。身分存在 sessionStorage：同一分頁重新整理仍是同一位玩家（可回到原座位），
 * 不同分頁則是不同玩家（方便在一台電腦上測試兩人房）。
 */
export async function signIn(): Promise<User> {
  const { auth } = firebase();
  await setPersistence(auth, browserSessionPersistence);
  const existing = await new Promise<User | null>(res => { const off = onAuthStateChanged(auth, u => { off(); res(u); }); });
  if (existing) return existing;
  return (await signInAnonymously(auth)).user;
}

/** 伺服器時間與本機時間的差（毫秒），用來判斷房間過期與離線時間 */
let serverOffset = 0;
export function watchServerTime(): void {
  const { db } = firebase();
  onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffset = Number(s.val()) || 0; });
}
export const serverNow = () => Date.now() + serverOffset;

/** 監聽與 Firebase 的連線狀態 */
export function onConnection(cb: (connected: boolean) => void): () => void {
  const { db } = firebase();
  return onValue(ref(db, '.info/connected'), s => cb(s.val() === true));
}
