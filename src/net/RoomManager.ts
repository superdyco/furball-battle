// 多人房間：建立 / 加入 / 離開 / 準備 / 聊天 / 斷線與房主轉移。
// 資料結構與權限見 database.rules.json。
import {
  ref, get, set, update, remove, push, onValue, runTransaction, serverTimestamp, onDisconnect, query, limitToLast,
  type Unsubscribe, type DataSnapshot,
} from 'firebase/database';
import { firebase, signIn, serverNow, watchServerTime, onConnection } from './FirebaseService';
import { NetGame, type MatchInit, type NetGameCallbacks } from './NetGame';
import type { Game } from '../engine/Game';

export const ROOM_DEFAULT_MAX_PLAYERS = 2;
/** M3：連線對戰固定使用的地圖與武器（M4 再開放全部） */
export const MATCH_THEME = 'grass';
export const MATCH_WEAPONS = ['bazooka'];
/** 房間閒置多久後可被新房間覆用（房主每次有動作會延長） */
const ROOM_TTL_MS = 12 * 3600_000;
/** 房主離線超過此時間，房內其他玩家自動接手房主（避免房主只是重新整理頁面就被換掉） */
const HOST_GRACE_MS = 10_000;
const CHAT_LIMIT = 50;
const ANIMALS = ['hamster', 'hedgehog', 'rabbit', 'squirrel', 'penguin', 'fox'];
const COLORS = ['#ff7a1a', '#3d8bff', '#22b07d', '#e2438a', '#8b5cf6', '#f2b705'];

export interface Profile { name: string; animal: string; color: string }
export interface RoomSettings {
  theme: string;
  rules: { units: number; turnTime: number; gravity: number; wind: boolean; water: boolean; crates: boolean; fall: boolean };
  ammo: Record<string, number>;
}
export interface RoomPlayer extends Profile {
  uid: string; seat: number; ready: boolean; online: boolean; joinedAt: number; lastSeen?: number; isHost: boolean; isMe: boolean;
}
export interface ChatLine { who: string; text: string; color: string; ts: number; system?: boolean }
export interface RoomView {
  code: string; maxPlayers: number; status: 'waiting' | 'playing';
  hostUid: string; isHost: boolean; myUid: string;
  players: RoomPlayer[]; chat: ChatLine[]; settings: RoomSettings | null;
  /** 進行中的連線對戰（status 為 playing 時） */
  match: MatchInit | null;
}
export interface NetState {
  /** offline：尚未連線；connecting：登入中；online：已連線；error：無法連線 */
  status: 'offline' | 'connecting' | 'online' | 'error';
  uid: string | null;
  room: RoomView | null;
  /** 最近一次操作的錯誤訊息（顯示給玩家） */
  error: string | null;
  /** 被動離開房間的原因（房間解散、被踢出） */
  notice: string | null;
}

export class RoomError extends Error {}

interface RawPlayer { seat: string; name: string; animal: string; color: string; ready: boolean; online: boolean; joinedAt: number; lastSeen?: number }
interface RawMeta { host: string; createdAt: number; expireAt: number; maxPlayers: number; status: 'waiting' | 'playing'; version: number }

const cleanName = (s: string) => (String(s || '').trim().slice(0, 10) || '毛球玩家');
const cleanProfile = (p: Profile): Profile => ({
  name: cleanName(p.name),
  animal: ANIMALS.includes(p.animal) ? p.animal : 'hamster',
  color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : COLORS[0],
});
const randomCode = () => String(100000 + Math.floor(Math.random() * 900000));
const isCode = (c: string) => /^[1-9][0-9]{5}$/.test(c);

export class RoomManager {
  private state: NetState = { status: 'offline', uid: null, room: null, error: null, notice: null };
  private listeners = new Set<(s: NetState) => void>();
  private uid: string | null = null;
  private ready: Promise<string> | null = null;

  // 目前房間的即時資料
  private code: string | null = null;
  private meta: RawMeta | null = null;
  private players: Record<string, RawPlayer> = {};
  private settings: RoomSettings | null = null;
  private match: MatchInit | null = null;
  private netGame: NetGame | null = null;
  private chat: ChatLine[] = [];
  private systemLines: ChatLine[] = [];
  private subs: Unsubscribe[] = [];
  private loaded = { meta: false, players: false };
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private expireTimer: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------- 狀態訂閱

  subscribe(fn: (s: NetState) => void): () => void {
    this.listeners.add(fn); fn(this.state);
    return () => { this.listeners.delete(fn); };
  }
  getState() { return this.state; }
  private patch(p: Partial<NetState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }
  clearMessages() { this.patch({ error: null, notice: null }); }

  // ---------------------------------------------------------------- 連線

  /** 匿名登入；若此分頁先前在某個房間（例如重新整理），自動回到該房間 */
  connect(): Promise<string> {
    if (this.ready) return this.ready;
    this.patch({ status: 'connecting' });
    this.ready = (async () => {
      try {
        const user = await signIn();
        this.uid = user.uid;
        watchServerTime();
        onConnection(c => { if (this.uid) this.patch({ status: c ? 'online' : 'connecting' }); });
        this.patch({ uid: user.uid });
        await this.resume();
        return user.uid;
      } catch (e) {
        this.ready = null;
        this.patch({ status: 'error', error: '無法連線到伺服器：' + describe(e) });
        throw e;
      }
    })();
    return this.ready;
  }

  private async resume() {
    const { db } = firebase();
    const s = await get(ref(db, `users/${this.uid}/room`));
    const code = s.val() as string | null;
    if (!code) return;
    const room = await get(ref(db, `rooms/${code}`));
    if (room.exists() && room.child(`players/${this.uid}`).exists()) await this.enter(code);
    else await remove(ref(db, `users/${this.uid}/room`));
  }

  // ---------------------------------------------------------------- 建立 / 加入 / 離開

  async createRoom(profile: Profile, settings: RoomSettings, maxPlayers = ROOM_DEFAULT_MAX_PLAYERS): Promise<string> {
    const uid = await this.connect();
    const { db } = firebase();
    await this.leaveRoom();
    const me = cleanProfile(profile);
    // 房號碰撞時換一個重試；只有不存在或已過期的房號才會被使用
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = randomCode();
      const room = {
        meta: { host: uid, createdAt: serverTimestamp(), expireAt: serverNow() + ROOM_TTL_MS, maxPlayers, status: 'waiting', version: 1 },
        settings,
        seats: { 0: uid },
        players: { [uid]: { seat: '0', ...me, ready: true, online: true, joinedAt: serverTimestamp() } },
      };
      try {
        const tx = await runTransaction(ref(db, `rooms/${code}`), (cur: { meta?: RawMeta } | null) => {
          if (cur && cur.meta && cur.meta.expireAt > serverNow()) return; // 已被使用：放棄這個房號
          return room;
        }, { applyLocally: false });
        if (!tx.committed) continue;
      } catch (e) {
        if (isPermissionDenied(e)) continue; // 房號在交易期間被別人佔走
        throw this.fail('建立房間失敗：' + describe(e));
      }
      await set(ref(db, `users/${uid}/room`), code);
      await this.enter(code);
      return code;
    }
    throw this.fail('建立房間失敗：找不到可用的房號，請再試一次');
  }

  async joinRoom(code: string, profile: Profile): Promise<void> {
    code = String(code || '').trim();
    if (!isCode(code)) throw this.fail('房號是 6 位數字');
    const uid = await this.connect();
    const { db } = firebase();
    if (this.code === code) return;
    await this.leaveRoom();
    const snap = await get(ref(db, `rooms/${code}`));
    const meta = snap.child('meta').val() as RawMeta | null;
    if (!meta || meta.expireAt < serverNow()) throw this.fail('找不到這個房間，請確認房號');
    const me = cleanProfile(profile);

    // 已經在房內（例如換了分頁狀態）：直接回到座位
    if (snap.child(`players/${uid}`).exists()) {
      await set(ref(db, `users/${uid}/room`), code);
      await this.enter(code);
      return;
    }
    if (meta.status !== 'waiting') throw this.fail('這個房間已經開始對戰，無法加入');

    // 避免與房內玩家撞色
    const used = Object.values((snap.child('players').val() || {}) as Record<string, RawPlayer>).map(p => p.color.toLowerCase());
    if (used.includes(me.color.toLowerCase())) me.color = COLORS.find(c => !used.includes(c)) || me.color;

    // 依序搶空位；transaction 保證同一座位只會有一人，座位編號受人數上限限制
    for (let seat = 0; seat < meta.maxPlayers; seat++) {
      if (snap.child(`seats/${seat}`).exists()) continue;
      let committed = false;
      try {
        const tx = await runTransaction(ref(db, `rooms/${code}/seats/${seat}`), cur => (cur === null ? uid : undefined), { applyLocally: false });
        committed = tx.committed;
      } catch (e) {
        if (!isPermissionDenied(e)) throw this.fail('加入房間失敗：' + describe(e));
      }
      if (!committed) continue;
      await set(ref(db, `rooms/${code}/players/${uid}`), { seat: String(seat), ...me, ready: false, online: true, joinedAt: serverTimestamp() });
      await set(ref(db, `users/${uid}/room`), code);
      await this.enter(code);
      return;
    }
    throw this.fail('房間已滿');
  }

  /** 主動離開。房主離開時把房主交給房內其他玩家；最後一人離開則刪除房間 */
  async leaveRoom(): Promise<void> {
    const code = this.code, uid = this.uid;
    if (!code || !uid) return;
    const { db } = firebase();
    const me = this.players[uid];
    const isHost = this.meta?.host === uid;
    const others = Object.entries(this.players).filter(([u]) => u !== uid)
      .sort(([, a], [, b]) => Number(b.online) - Number(a.online) || Number(a.seat) - Number(b.seat));
    this.detach();
    try {
      await onDisconnect(ref(db, `rooms/${code}/players/${uid}`)).cancel();
      if (me) {
        if (isHost && others.length === 0) await remove(ref(db, `rooms/${code}`));
        else await update(ref(db, `rooms/${code}`), {
          ...(isHost ? { 'meta/host': others[0][0] } : {}),
          [`seats/${me.seat}`]: null,
          [`players/${uid}`]: null,
        });
      }
    } catch (e) {
      console.warn('[RoomManager] 離開房間時發生錯誤', e);
    }
    await remove(ref(db, `users/${uid}/room`)).catch(() => {});
    this.patch({ room: null });
  }

  // ---------------------------------------------------------------- 房內操作

  async setReady(ready: boolean) { await this.updateMe({ ready }); }
  async updateProfile(p: Profile) { await this.updateMe(cleanProfile(p)); }

  async sendChat(text: string) {
    const t = String(text || '').trim().slice(0, 100);
    if (!t || !this.code || !this.uid) return;
    const me = this.players[this.uid];
    if (!me) return;
    await push(ref(firebase().db, `rooms/${this.code}/chat`), { uid: this.uid, name: me.name, color: me.color, text: t, ts: serverTimestamp() })
      .catch(e => this.fail('訊息送出失敗：' + describe(e)));
  }

  /** 房主：踢出玩家（例如長時間離線佔著座位） */
  async kick(uid: string) {
    if (!this.code || this.meta?.host !== this.uid || uid === this.uid) return;
    const p = this.players[uid]; if (!p) return;
    await update(ref(firebase().db, `rooms/${this.code}`), { [`seats/${p.seat}`]: null, [`players/${uid}`]: null })
      .catch(e => this.fail('踢出失敗：' + describe(e)));
  }

  /** 房主：同步房間設定（地形、規則、彈藥） */
  async updateSettings(s: RoomSettings) {
    if (!this.code || this.meta?.host !== this.uid) return;
    await set(ref(firebase().db, `rooms/${this.code}/settings`), s).catch(e => this.fail('設定同步失敗：' + describe(e)));
  }

  /** 房主：開始連線對戰（全員在線且已準備）。unitNames 為各動物的角色名稱表 */
  async startMatch(unitNames: Record<string, string[]>) {
    if (!this.code || this.meta?.host !== this.uid) return;
    const players = Object.entries(this.players).sort(([, a], [, b]) => Number(a.seat) - Number(b.seat));
    if (players.length < 2) throw this.fail('至少需要 2 位玩家');
    const rules = this.settings?.rules;
    const init: MatchInit = {
      id: Math.random().toString(36).slice(2, 10), v: 1, seed: 1 + Math.floor(Math.random() * 2e9), theme: MATCH_THEME,
      units: rules?.units ?? 4, turnTime: rules?.turnTime ?? 45, gravity: rules?.gravity ?? 1,
      wind: rules?.wind ?? true, water: rules?.water ?? true, fall: rules?.fall ?? true,
      weapons: MATCH_WEAPONS,
      teams: players.map(([uid, p]) => ({ uid, name: p.name, color: p.color, animal: p.animal, unitNames: (unitNames[p.animal] || ['毛球']).slice(0, 8) })),
    };
    await update(ref(firebase().db, `rooms/${this.code}`), { game: { init }, 'meta/status': 'playing', 'meta/expireAt': serverNow() + ROOM_TTL_MS })
      .catch(e => { throw this.fail('開始對戰失敗：' + describe(e)); });
  }

  /** 房主：結束對戰並回到等待 */
  async endMatch() {
    if (!this.code || this.meta?.host !== this.uid) return;
    await update(ref(firebase().db, `rooms/${this.code}`), { game: null, 'meta/status': 'waiting' })
      .catch(e => this.fail('結束對戰失敗：' + describe(e)));
  }

  /** 建立本機的連線對戰引擎（UI 在進入遊戲畫面時呼叫） */
  createNetGame(el: HTMLElement, cb: NetGameCallbacks): Game {
    this.destroyNetGame();
    if (!this.code || !this.uid || !this.match) throw new Error('沒有進行中的對戰');
    const ng = new NetGame({
      db: firebase().db, code: this.code, uid: this.uid, init: this.match,
      isHost: () => this.meta?.host === this.uid,
      onlineUids: () => Object.entries(this.players).filter(([, p]) => p.online).map(([u]) => u),
      nameOf: u => this.players[u]?.name || '對手',
    }, cb);
    this.netGame = ng;
    return ng.create(el);
  }
  destroyNetGame() { this.netGame?.destroy(); this.netGame = null; }
  /** 除錯／測試用 */
  netDebug() { return this.netGame?.debug() ?? null; }
  netGameEngine() { return this.netGame?.game ?? null; }

  private async updateMe(p: Partial<RawPlayer>) {
    if (!this.code || !this.uid || !this.players[this.uid]) return;
    await update(ref(firebase().db, `rooms/${this.code}/players/${this.uid}`), p).catch(e => this.fail('更新失敗：' + describe(e)));
  }

  // ---------------------------------------------------------------- 即時同步

  private async enter(code: string) {
    this.detach();
    const { db } = firebase();
    const uid = this.uid!;
    this.code = code; this.meta = null; this.players = {}; this.settings = null; this.match = null; this.chat = []; this.systemLines = [];
    this.loaded = { meta: false, players: false };
    const base = `rooms/${code}`;

    this.subs.push(onValue(ref(db, `${base}/meta`), s => { this.onMeta(s); }));
    this.subs.push(onValue(ref(db, `${base}/players`), s => { this.onPlayers(s); }));
    this.subs.push(onValue(ref(db, `${base}/settings`), s => { this.settings = s.val(); this.emitRoom(); }));
    this.subs.push(onValue(ref(db, `${base}/game/init`), s => { this.match = s.val(); this.emitRoom(); }));
    this.subs.push(onValue(query(ref(db, `${base}/chat`), limitToLast(CHAT_LIMIT)), s => {
      const lines: ChatLine[] = [];
      s.forEach(c => { const m = c.val(); lines.push({ who: m.name, text: m.text, color: m.color, ts: m.ts }); });
      this.chat = lines; this.emitRoom();
    }));

    // 線上狀態：連線時標記在線並登記斷線處理；斷線由伺服器自動標記離線
    const meRef = ref(db, `${base}/players/${uid}`);
    this.subs.push(onConnection(async connected => {
      if (!connected || this.code !== code) return;
      try {
        await onDisconnect(meRef).update({ online: false, lastSeen: serverTimestamp() });
        if (this.players[uid] || !this.loaded.players) await update(meRef, { online: true, lastSeen: serverTimestamp() });
      } catch (e) { console.warn('[RoomManager] presence', e); }
    }));

    // 房主定期延長房間有效期限
    this.expireTimer = setInterval(() => {
      if (this.meta?.host === this.uid) update(ref(db, `${base}/meta`), { expireAt: serverNow() + ROOM_TTL_MS }).catch(() => {});
    }, 30 * 60_000);
    this.patch({ error: null, notice: null });
  }

  private onMeta(s: DataSnapshot) {
    const prev = this.meta;
    this.meta = s.val();
    this.loaded.meta = true;
    if (!this.meta) { this.kickedOut('房間已解散'); return; }
    if (prev && prev.host !== this.meta.host) {
      const h = this.players[this.meta.host];
      this.sys(`${h ? h.name : '新房主'} 成為房主`);
    }
    if (prev && prev.status !== this.meta.status) {
      if (this.meta.status === 'playing') this.sys('對戰開始!');
      else {
        this.sys('回到等待狀態，請重新準備');
        if (this.meta.host !== this.uid) this.setReady(false);
      }
    }
    // 自己成為房主時視為已準備
    if (this.meta.host === this.uid && this.players[this.uid!] && !this.players[this.uid!].ready) this.setReady(true);
    this.checkHost();
    this.emitRoom();
    this.netGame?.onRoomChange();
  }

  private onPlayers(s: DataSnapshot) {
    const next = (s.val() || {}) as Record<string, RawPlayer>;
    const prev = this.players;
    if (this.loaded.players) {
      for (const [u, p] of Object.entries(next)) {
        if (!prev[u]) this.sys(`${p.name} 加入了房間`);
        else if (prev[u].online && !p.online) this.sys(`${p.name} 離線了`);
        else if (!prev[u].online && p.online) this.sys(`${p.name} 回來了`);
      }
      for (const [u, p] of Object.entries(prev)) if (!next[u] && u !== this.uid) this.sys(`${p.name} 離開了房間`);
    }
    this.players = next;
    this.loaded.players = true;
    if (this.uid && !next[this.uid]) { this.kickedOut('你已不在這個房間（被房主移出或座位已失效）'); return; }
    this.checkHost();
    // 對戰中有人離開房間：房主結束對戰
    if (this.meta?.status === 'playing' && this.meta.host === this.uid && Object.keys(next).length < 2) {
      this.sys('對手離開了房間,對戰結束');
      this.endMatch();
    }
    this.emitRoom();
    this.netGame?.onRoomChange();
  }

  /** 房主不在或離線過久時，由座位最前面的在線玩家接手 */
  private checkHost() {
    if (this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = null; }
    const meta = this.meta, uid = this.uid, code = this.code;
    if (!meta || !uid || !code || meta.host === uid) return;
    const host = this.players[meta.host];
    if (host && host.online) return;
    const wait = host ? Math.max(0, (host.lastSeen || 0) + HOST_GRACE_MS - serverNow()) : 0;
    this.hostTimer = setTimeout(() => {
      const cur = this.meta, h = cur && this.players[cur.host];
      if (!cur || cur.host === uid || (h && h.online)) return;
      const candidates = Object.entries(this.players).filter(([, p]) => p.online).sort(([, a], [, b]) => Number(a.seat) - Number(b.seat));
      if (candidates[0]?.[0] !== uid) return;
      set(ref(firebase().db, `rooms/${code}/meta/host`), uid).catch(() => {});
    }, wait + 200);
  }

  private kickedOut(reason: string) {
    const uid = this.uid;
    this.detach();
    if (uid) remove(ref(firebase().db, `users/${uid}/room`)).catch(() => {});
    this.patch({ room: null, notice: reason });
  }

  private detach() {
    this.destroyNetGame();
    for (const off of this.subs) off();
    this.subs = [];
    if (this.hostTimer) clearTimeout(this.hostTimer);
    if (this.expireTimer) clearInterval(this.expireTimer);
    this.hostTimer = null; this.expireTimer = null;
    this.code = null; this.meta = null; this.players = {}; this.match = null;
  }

  private sys(text: string) {
    this.systemLines = [...this.systemLines.slice(-20), { who: '系統', text, color: '#8a6a3a', ts: serverNow(), system: true }];
  }

  private emitRoom() {
    if (!this.code || !this.meta || !this.loaded.players || !this.uid) return;
    const host = this.meta.host, uid = this.uid;
    const players = Object.entries(this.players).map(([u, p]) => ({
      uid: u, seat: Number(p.seat), name: p.name, animal: p.animal, color: p.color, ready: p.ready, online: p.online,
      joinedAt: p.joinedAt, lastSeen: p.lastSeen, isHost: u === host, isMe: u === uid,
    })).sort((a, b) => a.seat - b.seat);
    const chat = [...this.chat, ...this.systemLines].sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-CHAT_LIMIT);
    this.patch({
      room: {
        code: this.code, maxPlayers: this.meta.maxPlayers, status: this.meta.status, hostUid: host, isHost: host === uid, myUid: uid,
        players, chat, settings: this.settings, match: this.meta.status === 'playing' ? this.match : null,
      },
    });
  }

  private fail(msg: string) { this.patch({ error: msg }); return new RoomError(msg); }
}

function isPermissionDenied(e: unknown) { return /permission[_ ]denied/i.test(String((e as Error)?.message || e)); }
function describe(e: unknown) { return String((e as Error)?.message || e).replace(/^FIREBASE (WARNING|FATAL ERROR): /, ''); }
