// 連線對戰：事件同步 + 房主權威結果。
//
// 每一回合：
//   1. 各端模擬到回合開始（nextTurn）→ 暫停（hold），擷取本機狀態與雜湊。
//   2. 房主公布正式狀態 starts/n（快照、雜湊、上一回合的挖洞紀錄、輪到誰）。
//      其他人比對雜湊，不一致就套用房主狀態（地形不一致則以 mask0 + 挖洞紀錄重建），然後回報 acks/n。
//   3. 房主收齊在線玩家的確認後寫 go/n，全員開始這一回合。
//   4. 輪到的玩家即時操作，輸入以「幀號」記錄，每 250ms 上傳一批 in/n/cXXXX；
//      其他人依輸入重播（不會超前已收到的幀），因此看到與操作者完全相同的過程。
//   5. 操作者進入結算後送出結束標記，各端自行跑完結算進入下一回合，回到步驟 1。
//
// 這是好友私人房間的架構，不防作弊：房主與操作者的客戶端都被信任。
import {
  ref, set, update, remove, onValue, onChildAdded, get, type Unsubscribe, type Database,
} from 'firebase/database';
import { Game } from '../engine/Game';
import type { GameCallbacks, GameConfig, NetEvent, NetHooks, MatchStat } from '../engine/types';
import { HP, WEAPONS } from '../config/GameBalance';
import {
  captureSnapshot, applySnapshot, stateHash, maskHash, encodeMask, decodeMask, rebuildMask,
  type TurnSnapshot, type DigLog,
} from './StateSync';

export interface MatchTeam { uid: string; name: string; color: string; animal: string; unitNames: string[] }
export interface MatchInit {
  id: string; v: number; seed: number; theme: string;
  units: number; turnTime: number; gravity: number; wind: boolean; water: boolean; fall: boolean;
  /** 允許的武器（M3 只有火箭筒） */
  weapons: string[];
  teams: MatchTeam[];
}
interface StartRec { snap: string; hash: string; active: string; digs: string }
interface Chunk { f: number; e: string; end?: boolean }
type Rec = [number, ...NetEvent];

export interface NetGameCallbacks extends GameCallbacks {
  /** 同步狀態提示（顯示在 HUD），空字串表示無 */
  onNetStatus?: (msg: string) => void;
}

export interface NetGameEnv {
  db: Database;
  code: string;
  uid: string;
  init: MatchInit;
  isHost: () => boolean;
  /** 目前在線的玩家 uid */
  onlineUids: () => string[];
  nameOf: (uid: string) => string;
}

const CHUNK_MS = 250;
const CORRECTED = '已依房主校正狀態';
const FORCE_JUMP_MS = 8000;
const pad = (i: number) => 'c' + String(i).padStart(5, '0');

export function buildConfig(init: MatchInit): GameConfig {
  const ammo: Record<string, number> = {};
  for (const w of WEAPONS) ammo[w.id] = init.weapons.includes(w.id) ? w.ammo : 0;
  return {
    teams: init.teams.map(t => ({ name: t.name, color: t.color, animal: t.animal, unitNames: t.unitNames, ai: null })),
    themeId: init.theme, unitsPerTeam: init.units, turnTime: init.turnTime, gravity: init.gravity,
    wind: init.wind, waterRise: init.water, crates: false, fallDamage: init.fall, ammo, hp: HP.default,
    seed: init.seed, externalLoop: true,
  };
}

export class NetGame implements NetHooks {
  game!: Game;
  private base: string;
  private myTeam: number;
  private subs: Unsubscribe[] = [];
  private inSub: Unsubscribe | null = null;
  private raf = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chunkTimer: ReturnType<typeof setInterval> | null = null;
  private last = 0; private acc = 0;
  private destroyed = false;

  private phase: 'boot' | 'hold' | 'live' | 'replay' | 'post' | 'over' = 'boot';
  private turn = 0;
  private mask0: Uint8Array | null = null;
  private starts: Record<number, StartRec> = {};
  private gos: Record<string, boolean> = {};
  private acks: Record<string, Record<string, string>> = {};
  private local: { n: number; snap: TurnSnapshot; hash: string } | null = null;
  private verified = new Set<number>();
  private published = new Set<number>();
  private digBuf: DigLog = [];
  private publishDigs: DigLog = [];

  // 操作者
  private pending: NetEvent[] = [];
  private recBuf: Rec[] = [];
  private chunkIdx = 0;
  // 觀看者
  private schedule: Rec[] = [];
  private available = 0;
  private ended = false;
  private seenChunks = new Set<string>();
  private resumeLive = false;

  private forceTimer: ReturnType<typeof setTimeout> | null = null;
  private status = '';
  private resultShown = false;
  /** 被房主狀態校正的次數（除錯與測試用） */
  corrections = 0;

  constructor(private env: NetGameEnv, private cb: NetGameCallbacks = {}) {
    this.base = `rooms/${env.code}/game`;
    this.myTeam = env.init.teams.findIndex(t => t.uid === env.uid);
  }

  create(el: HTMLElement): Game {
    const cfg = buildConfig(this.env.init);
    this.game = new Game(el, cfg, {
      onHud: h => this.cb.onHud?.(h),
      onToggleWeapons: () => this.cb.onToggleWeapons?.(),
      onGameOver: (w, stats) => this.onLocalGameOver(w, stats),
    });
    this.game.net = this;
    this.boot();
    this.last = performance.now();
    const frame = () => { if (this.destroyed) return; this.tick(false); this.game.render(); this.raf = requestAnimationFrame(frame); };
    this.raf = requestAnimationFrame(frame);
    // 分頁切到背景時 requestAnimationFrame 會停止；以計時器補跑，避免房主在背景時整場卡住
    this.timer = setInterval(() => { if (document.hidden) this.tick(true); }, 200);
    this.chunkTimer = setInterval(() => this.flushChunk(false), CHUNK_MS);
    return this.game;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.timer) clearInterval(this.timer);
    if (this.chunkTimer) clearInterval(this.chunkTimer);
    if (this.forceTimer) clearTimeout(this.forceTimer);
    for (const off of this.subs) off();
    this.inSub?.();
    this.game?.destroy();
  }

  /** 房間狀態改變（房主轉移、玩家上下線）時重新評估同步進度 */
  onRoomChange() { this.evaluate(); this.updateStatus(); }

  // ---------------------------------------------------------------- 驅動

  private tick(hidden: boolean) {
    const g = this.game, now = performance.now(), tickMs = 1000 / 60;
    this.acc += Math.min(now - this.last, hidden ? 2000 : 250);
    this.last = now;
    let maxSteps = hidden ? 240 : 5;
    if (this.phase === 'replay' && !this.ended && this.available - g.frame > 30) maxSteps = 30; // 追上進度
    let n = 0;
    while (this.acc >= tickMs && n < maxSteps) {
      if (!this.canStep()) { this.acc = 0; break; }
      g.step(); this.acc -= tickMs; n++;
    }
    if (n >= maxSteps) this.acc = Math.min(this.acc, tickMs * 2);
  }

  private canStep() {
    if (this.phase === 'live' || this.phase === 'post') return true;
    if (this.phase === 'replay') return this.ended || this.game.frame < this.available;
    return false;
  }

  // ---------------------------------------------------------------- NetHooks

  isRemoteTurn(): boolean { return this.game ? this.game.teamTurn !== this.myTeam : true; }

  ui(_g: unknown, ev: NetEvent) {
    if (this.phase !== 'live') return;
    this.pending.push(ev);
  }

  beforeStep() {
    const g = this.game;
    if (this.phase === 'live') {
      // 同一幀多次滑鼠移動只取最後一次
      let lastP = -1;
      this.pending.forEach((e, i) => { if (e[0] === 'p') lastP = i; });
      for (let i = 0; i < this.pending.length; i++) {
        const e = this.pending[i];
        if (e[0] === 'p') {
          if (i !== lastP) continue;
          const u = g.active(), f0 = u?.face, a0 = u?.aimA;
          g.doAimAt({ x: e[1], y: e[2] });
          if (u && (u.face !== f0 || u.aimA !== a0)) this.rec(['a', u.face, u.aimA]);
          continue;
        }
        this.applyEvent(e);
        this.rec(e);
      }
      this.pending = [];
      if (g.state !== 'aim' && g.state !== 'retreat') { this.flushChunk(true); this.phase = 'post'; this.updateStatus(); }
      return;
    }
    if (this.phase === 'replay') {
      while (this.schedule.length && this.schedule[0][0] <= g.frame) {
        const [f, ...e] = this.schedule.shift()!;
        if (f < g.frame) console.warn('[NetGame] 輸入晚到', f, g.frame);
        this.applyEvent(e as NetEvent);
      }
      // 從重新整理恢復：重播完自己先前送出的輸入後，接回即時操作
      if (this.resumeLive && !this.ended && !this.schedule.length && g.frame >= this.available) {
        this.resumeLive = false; this.phase = 'live'; this.updateStatus();
      }
    }
  }

  onDig(x: number, y: number, r: number) { this.digBuf.push([x, y, r]); }

  onTurnStart() {
    // 第一回合在建構時開始，由 boot() 處理
    if (this.phase === 'boot') return;
    this.enterHold(this.game.turnCount);
  }

  private applyEvent(e: NetEvent) {
    const g = this.game;
    switch (e[0]) {
      case 'k': g.applyKey(e[1], !!e[2]); break;
      case 'a': { const u = g.active(); if (u) { u.face = e[1]; u.aimA = e[2]; } break; }
      case 'fd': g.doFireDown(); break;
      case 'fu': g.doFireUp(); break;
      case 't': g.doSetTarget({ x: e[1], y: e[2] }); break;
      case 'w': g.doSelectWeapon(e[1]); break;
    }
  }

  private rec(e: NetEvent) { this.recBuf.push([this.game.frame, ...e] as Rec); }

  private flushChunk(end: boolean) {
    if (this.phase !== 'live' || this.destroyed) return;
    const n = this.turn, key = pad(this.chunkIdx++);
    const chunk: Chunk = { f: this.game.frame, e: JSON.stringify(this.recBuf), ...(end ? { end: true } : {}) };
    this.recBuf = [];
    set(ref(this.env.db, `${this.base}/in/${n}/${key}`), chunk).catch(e => console.warn('[NetGame] 上傳輸入失敗', e));
  }

  // ---------------------------------------------------------------- 開局與恢復

  private boot() {
    const { db } = this.env, g = this.game;
    this.subs.push(onValue(ref(db, `${this.base}/mask0`), s => {
      const v = s.val() as string | null;
      if (!v || this.mask0) return;
      this.mask0 = decodeMask(v, g.mask.length);
      // 本機產生的地形與房主不同時（不同瀏覽器的 Canvas 點陣化可能有差異）改用房主的
      if (maskHash(this.mask0) !== maskHash(g.mask) && this.turn <= 1 && !this.local) g.replaceMask(this.mask0.slice());
      this.evaluate();
    }));
    this.subs.push(onChildAdded(ref(db, `${this.base}/starts`), s => this.onStart(Number(s.key), s.val())));
    this.subs.push(onValue(ref(db, `${this.base}/go`), s => { this.gos = s.val() || {}; this.evaluate(); }));
    this.subs.push(onValue(ref(db, `${this.base}/acks`), s => { this.acks = s.val() || {}; this.evaluate(); }));
    this.subs.push(onValue(ref(db, `${this.base}/result`), s => { const r = s.val(); if (r) this.showResult(r); }));

    (async () => {
      const latest = (await get(ref(db, `${this.base}/turn`))).val() as number | null;
      if (this.env.isHost() && !(await get(ref(db, `${this.base}/mask0`))).exists()) {
        // 全新開局：房主公布初始地形
        this.mask0 = g.mask.slice();
        await set(ref(db, `${this.base}/mask0`), encodeMask(this.mask0));
      }
      if (latest && latest > 1) {
        // 重新整理後恢復：直接跳到最近一回合的正式狀態
        this.phase = 'hold';
        this.forceEnter(latest);
      } else {
        this.phase = 'hold';
        this.enterHold(g.turnCount);
      }
    })().catch(e => { console.error('[NetGame] 開局失敗', e); this.setStatus('連線對戰初始化失敗：' + (e?.message || e)); });
  }

  // ---------------------------------------------------------------- 回合交界

  private enterHold(n: number) {
    const g = this.game;
    if (this.forceTimer) { clearTimeout(this.forceTimer); this.forceTimer = null; }
    this.phase = 'hold';
    this.turn = n;
    // 上一位操作者在結算期間放開的按鍵不會被記錄；回合開始時各端一致清空，避免角色自己走動
    g.keys = {}; g.jumpQ = false;
    const snap = captureSnapshot(g);
    this.local = { n, snap, hash: stateHash(snap, maskHash(g.mask)) };
    this.publishDigs = this.digBuf; this.digBuf = [];
    this.pending = []; this.recBuf = []; this.schedule = []; this.available = 0; this.ended = false; this.resumeLive = false;
    this.listenInputs(n);
    this.updateStatus();
    this.evaluate();
    // 清理兩回合前的輸入
    if (this.env.isHost() && n > 2) remove(ref(this.env.db, `${this.base}/in/${n - 2}`)).catch(() => {});
  }

  private onStart(n: number, rec: StartRec) {
    this.starts[n] = rec;
    this.evaluate();
    // 房主已進入更後面的回合而本機遲遲沒到（模擬結果分歧或卡住）：直接跳過去
    if (n > this.turn && this.phase !== 'boot') {
      if (this.forceTimer) clearTimeout(this.forceTimer);
      this.forceTimer = setTimeout(() => { if (n > this.turn && !this.resultShown) this.forceEnter(n); }, FORCE_JUMP_MS);
    }
  }

  /** 直接採用房主第 n 回合的正式狀態（重新整理恢復、或本機模擬落後/分歧時） */
  private forceEnter(n: number) {
    const rec = this.starts[n];
    if (!rec || !this.mask0) {
      // 資料還沒到：稍後再試
      setTimeout(() => { if (!this.destroyed && this.turn < n) this.forceEnter(n); }, 300);
      return;
    }
    this.reconcile(n, rec, true);
    this.enterHold(n);
  }

  private reconcile(n: number, rec: StartRec, silent = false) {
    const g = this.game, snap = JSON.parse(rec.snap) as TurnSnapshot;
    const wantMask = rec.hash.slice(8);
    if (maskHash(g.mask).toString(16).padStart(8, '0') !== wantMask) {
      const digs: DigLog = [];
      for (let k = 2; k <= n; k++) if (this.starts[k]) digs.push(...JSON.parse(this.starts[k].digs) as DigLog);
      g.replaceMask(rebuildMask(g, this.mask0!, digs));
    }
    applySnapshot(g, snap);
    if (!silent) {
      this.corrections++; this.setStatus(CORRECTED);
      setTimeout(() => { if (this.status === CORRECTED) { this.setStatus(''); this.updateStatus(); } }, 1500);
    }
  }

  /** 依目前收到的資料推進回合交界的流程（可重複呼叫） */
  private evaluate() {
    if (this.phase !== 'hold' || !this.local || !this.mask0 || this.destroyed) return;
    const { db, uid } = this.env, n = this.turn, start = this.starts[n];
    const host = this.env.isHost();

    if (!start) {
      if (host && !this.published.has(n)) {
        this.published.add(n);
        const g = this.game, active = this.env.init.teams[g.teamTurn]?.uid || '';
        const rec: StartRec = { snap: JSON.stringify(this.local.snap), hash: this.local.hash, active, digs: JSON.stringify(this.publishDigs) };
        update(ref(db, this.base), { [`starts/${n}`]: rec, turn: n }).catch(e => { this.published.delete(n); console.warn('[NetGame] 公布狀態失敗', e); });
      }
      return;
    }

    if (!this.verified.has(n)) {
      this.verified.add(n);
      if (start.hash !== this.local.hash) {
        this.reconcile(n, start);
        const snap = captureSnapshot(this.game);
        this.local = { n, snap, hash: stateHash(snap, maskHash(this.game.mask)) };
        if (this.local.hash !== start.hash) console.warn('[NetGame] 校正後雜湊仍不一致', this.local.hash, start.hash);
      }
    }
    const acks = this.acks[n] || {};
    if (!acks[uid]) {
      acks[uid] = this.local.hash; this.acks[n] = acks;
      set(ref(db, `${this.base}/acks/${n}/${uid}`), this.local.hash).catch(() => { delete acks[uid]; });
    }
    if (host && !this.gos[n]) {
      const need = this.env.onlineUids().filter(u => this.env.init.teams.some(t => t.uid === u));
      if (need.every(u => acks[u])) {
        this.gos[n] = true;
        set(ref(db, `${this.base}/go/${n}`), true).catch(() => { delete this.gos[n]; });
      }
    }
    if (this.gos[n]) this.begin(n);
    else this.updateStatus();
  }

  private beginning = false;
  private async begin(n: number) {
    if (this.phase !== 'hold' || this.turn !== n || this.beginning) return;
    const g = this.game, mine = g.teamTurn === this.myTeam;
    if (mine) {
      // 先確認這回合是否已送過輸入（重新整理恢復的情況），已送過就先重播再接回即時操作
      this.beginning = true;
      let count = 0;
      try { const s = await get(ref(this.env.db, `${this.base}/in/${n}`)); count = s.exists() ? Object.keys(s.val()).length : 0; }
      finally { this.beginning = false; }
      if (this.phase !== 'hold' || this.turn !== n || this.destroyed) return;
      this.chunkIdx = count;
      if (count === 0) this.phase = 'live';
      else { this.phase = 'replay'; this.resumeLive = true; }
    } else this.phase = 'replay';
    g.lastHud = undefined; g.emit();
    this.updateStatus();
  }

  private listenInputs(n: number) {
    this.inSub?.();
    this.seenChunks = new Set();
    this.inSub = onChildAdded(ref(this.env.db, `${this.base}/in/${n}`), s => {
      if (this.turn !== n || this.seenChunks.has(s.key!)) return;
      this.seenChunks.add(s.key!);
      const c = s.val() as Chunk;
      // 自己正在即時操作時收到的是自己剛送出的資料，不需處理
      if (this.phase === 'live') return;
      const evs = JSON.parse(c.e) as Rec[];
      this.schedule.push(...evs);
      this.available = Math.max(this.available, c.f);
      if (c.end) this.ended = true;
      if (this.resumeLive) this.chunkIdx = this.seenChunks.size;
    });
  }

  // ---------------------------------------------------------------- 結束

  private onLocalGameOver(w: { name: string; color: string; animal: string } | null, stats: MatchStat[]) {
    this.phase = 'over';
    if (this.env.isHost()) {
      set(ref(this.env.db, `${this.base}/result`), { w: JSON.stringify(w), stats: JSON.stringify(stats), turn: this.game.turnCount })
        .catch(e => console.warn('[NetGame] 寫入結果失敗', e));
    } else this.setStatus('等待房主確認結果…');
  }

  private showResult(r: { w: string; stats: string }) {
    if (this.resultShown) return;
    this.resultShown = true;
    this.phase = 'over';
    this.setStatus('');
    this.cb.onGameOver?.(JSON.parse(r.w), JSON.parse(r.stats));
  }

  // ---------------------------------------------------------------- 狀態提示

  private setStatus(msg: string) { if (msg !== this.status) { this.status = msg; this.cb.onNetStatus?.(msg); } }

  private updateStatus() {
    if (this.status === CORRECTED) return;
    const g = this.game; if (!g) return;
    const active = this.env.init.teams[g.teamTurn]?.uid;
    const online = this.env.onlineUids();
    if (this.phase === 'hold') {
      const offline = this.env.init.teams.filter(t => !online.includes(t.uid)).map(t => t.name);
      this.setStatus(offline.length ? `等待 ${offline.join('、')} 重新連線…` : '同步中…');
    } else if (this.phase === 'replay' && active && !online.includes(active)) {
      this.setStatus(`等待 ${this.env.nameOf(active)} 重新連線…`);
    } else this.setStatus('');
  }

  /** 除錯／測試：目前回合與本機狀態雜湊 */
  debug() {
    const g = this.game;
    return {
      phase: this.phase, turn: this.turn, frame: g.frame, corrections: this.corrections,
      /** 本機在這回合開始時（校正後）的狀態雜湊，與房主公布的 startHash 應相同 */
      localStartHash: this.local?.hash, startHash: this.starts[this.turn]?.hash,
      hp: g.units.map(u => (u.dead ? 'X' : u.hp)).join(','),
      /** 這回合開始時的 HP（各端應完全相同） */
      startHp: this.local ? this.local.snap.units.map(u => (u[5] ? 'X' : u[4])).join(',') : '',
    };
  }
}
