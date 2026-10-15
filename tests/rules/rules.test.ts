// Realtime Database 安全規則測試（需在 Emulator 中執行：npm run test:rules）
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set, update, get, remove, push, serverTimestamp, type Database, type DatabaseReference } from 'firebase/database';

const CODE = '123456';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-furball',
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync('database.rules.json', 'utf8') },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

/** push() 回傳的 ThenableReference 不是標準 Promise，轉成 Promise 給 assert 使用 */
const pushP = (r: DatabaseReference, v: unknown) => push(r, v).then(() => undefined);
const db = (uid: string | null): Database => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database() as unknown as Database;
const player = (seat: string, over: Record<string, unknown> = {}) => ({
  seat, name: '玩家' + seat, animal: 'hamster', color: '#ff7a1a', ready: false, online: true, joinedAt: serverTimestamp(), ...over,
});
const newRoom = (host: string, over: Record<string, unknown> = {}) => ({
  meta: { host, createdAt: serverTimestamp(), expireAt: Date.now() + 3600_000, maxPlayers: 2, status: 'waiting', version: 1 },
  seats: { 0: host },
  players: { [host]: player('0') },
  ...over,
});
/** 以管理員身分直接寫入（略過規則），用來布置測試前的狀態 */
async function seed(path: string, value: unknown) {
  await env.withSecurityRulesDisabled(async ctx => { await set(ref(ctx.database() as unknown as Database, path), value); });
}
async function seedRoom(players: Record<string, { seat: string; online?: boolean }>, metaOver: Record<string, unknown> = {}) {
  const host = Object.keys(players).find(u => players[u].seat === '0')!;
  const seats: Record<string, string> = {}; const ps: Record<string, unknown> = {};
  for (const [uid, p] of Object.entries(players)) { seats[p.seat] = uid; ps[uid] = { ...player(p.seat), joinedAt: Date.now() - 1000, online: p.online ?? true }; }
  await seed(`rooms/${CODE}`, { meta: { host, createdAt: Date.now() - 1000, expireAt: Date.now() + 3600_000, maxPlayers: 2, status: 'waiting', version: 1, ...metaOver }, seats, players: ps });
}
const join = (uid: string, seat: string) => update(ref(db(uid), `rooms/${CODE}`), { [`seats/${seat}`]: uid, [`players/${uid}`]: player(seat) });

describe('建立房間', () => {
  it('登入的玩家可以建立自己當房主的房間', async () => {
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}`), newRoom('alice')));
  });
  it('未登入不能建立房間', async () => {
    await assertFails(set(ref(db(null), `rooms/${CODE}`), newRoom('alice')));
  });
  it('不能把別人設成房主', async () => {
    await assertFails(set(ref(db('alice'), `rooms/${CODE}`), newRoom('bob')));
  });
  it('房號必須是 6 位數字', async () => {
    await assertFails(set(ref(db('alice'), 'rooms/12345'), newRoom('alice')));
    await assertFails(set(ref(db('alice'), 'rooms/012345'), newRoom('alice')));
    await assertFails(set(ref(db('alice'), 'rooms/abcdef'), newRoom('alice')));
  });
  it('房號已被使用（未過期）時不能覆蓋', async () => {
    await seedRoom({ bob: { seat: '0' } });
    await assertFails(set(ref(db('alice'), `rooms/${CODE}`), newRoom('alice')));
  });
  it('過期的房間可以被新房間覆蓋', async () => {
    await seedRoom({ bob: { seat: '0' } }, { expireAt: Date.now() - 1000 });
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}`), newRoom('alice')));
  });
  it('人數上限只能是 2～6', async () => {
    await assertFails(set(ref(db('alice'), `rooms/${CODE}`), newRoom('alice', { meta: { ...newRoom('alice').meta, maxPlayers: 7 } })));
  });
  it('不能列出所有房間', async () => {
    await seedRoom({ bob: { seat: '0' } });
    await assertFails(get(ref(db('alice'), 'rooms')));
    await assertSucceeds(get(ref(db('alice'), `rooms/${CODE}`)));
  });
});

describe('加入房間與人數上限', () => {
  it('可以坐上空位並寫入自己的玩家資料', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertSucceeds(join('bob', '1'));
  });
  it('不能搶已經有人的座位', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertFails(join('bob', '0'));
  });
  it('兩人房不能坐第 3 個座位（超過人數上限）', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertFails(join('carol', '2'));
  });
  it('四人房可以坐到第 4 個座位，但不能坐第 5 個', async () => {
    await seedRoom({ alice: { seat: '0' } }, { maxPlayers: 4 });
    await assertSucceeds(join('bob', '3'));
    await assertFails(join('carol', '4'));
  });
  it('對戰中不能加入', async () => {
    await seedRoom({ alice: { seat: '0' } }, { status: 'playing' });
    await assertFails(join('bob', '1'));
  });
  it('玩家資料的座位必須是自己的座位', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/players/bob`), player('0')));
  });
  it('不能寫入別人的玩家資料', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertFails(update(ref(db('bob'), `rooms/${CODE}/players/alice`), { ready: true }));
    await assertFails(update(ref(db('bob'), `rooms/${CODE}/players/alice`), { name: '壞人' }));
  });
  it('玩家資料格式驗證：暱稱長度、動物、顏色', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    const me = `rooms/${CODE}/players/bob`;
    await assertSucceeds(update(ref(db('bob'), me), { ready: true, animal: 'fox', name: '狐狸', color: '#3d8bff' }));
    await assertFails(update(ref(db('bob'), me), { name: '' }));
    await assertFails(update(ref(db('bob'), me), { name: '12345678901' }));
    await assertFails(update(ref(db('bob'), me), { animal: 'dragon' }));
    await assertFails(update(ref(db('bob'), me), { color: 'red' }));
    await assertFails(update(ref(db('bob'), me), { hp: 999 }));
  });
});

describe('離開、踢人、斷線', () => {
  it('可以離開：清掉自己的座位與玩家資料', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertSucceeds(update(ref(db('bob'), `rooms/${CODE}`), { 'seats/1': null, 'players/bob': null }));
  });
  it('不能清掉別人的座位', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertFails(remove(ref(db('bob'), `rooms/${CODE}/seats/0`)));
    await assertFails(remove(ref(db('bob'), `rooms/${CODE}/players/alice`)));
  });
  it('房主可以踢人', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertSucceeds(update(ref(db('alice'), `rooms/${CODE}`), { 'seats/1': null, 'players/bob': null }));
  });
  it('斷線時可以把自己標成離線', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertSucceeds(update(ref(db('bob'), `rooms/${CODE}/players/bob`), { online: false, lastSeen: serverTimestamp() }));
  });
  it('房主可以解散整個房間，其他人不行', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertFails(remove(ref(db('bob'), `rooms/${CODE}`)));
    await assertSucceeds(remove(ref(db('alice'), `rooms/${CODE}`)));
  });
});

describe('房主權限', () => {
  const settings = { theme: 'grass', rules: { units: 4, turnTime: 45, gravity: 1, wind: true, water: true, crates: true, fall: true }, ammo: { bazooka: -1, cluster: 3 } };
  it('只有房主能改房間設定與開始對戰', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}/settings`), settings));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/settings`), settings));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/meta/status`), 'playing'));
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}/meta/status`), 'playing'));
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/meta/status`), 'hacked'));
  });
  it('設定值格式驗證', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/settings`), { ...settings, rules: { ...settings.rules, units: 99 } }));
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/settings`), { ...settings, ammo: { bazooka: 100 } }));
  });
  it('房主可以把房主交給房內的其他玩家', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}/meta/host`), 'bob'));
  });
  it('房主在線時，其他人不能搶房主', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/meta/host`), 'bob'));
  });
  it('房主離線後，房內玩家可以接手房主', async () => {
    await seedRoom({ alice: { seat: '0', online: false }, bob: { seat: '1' } });
    await assertSucceeds(set(ref(db('bob'), `rooms/${CODE}/meta/host`), 'bob'));
  });
  it('不在房內的人不能接手房主', async () => {
    await seedRoom({ alice: { seat: '0', online: false }, bob: { seat: '1' } });
    await assertFails(set(ref(db('mallory'), `rooms/${CODE}/meta/host`), 'mallory'));
  });
  it('房間建立時間、人數上限建立後不能改', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/meta/maxPlayers`), 6));
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/meta/createdAt`), 1));
  });
});

describe('聊天', () => {
  const msg = (uid: string, text: string) => ({ uid, name: '玩家', color: '#ff7a1a', text, ts: serverTimestamp() });
  it('房內玩家可以發言', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertSucceeds(pushP(ref(db('bob'), `rooms/${CODE}/chat`), msg('bob', '你好')));
  });
  it('不在房內不能發言、不能冒用別人名義', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertFails(pushP(ref(db('bob'), `rooms/${CODE}/chat`), msg('bob', '你好')));
    await assertFails(pushP(ref(db('alice'), `rooms/${CODE}/chat`), msg('bob', '假冒')));
  });
  it('訊息長度 1～100 字，不能修改已送出的訊息', async () => {
    await seedRoom({ alice: { seat: '0' } });
    await assertFails(pushP(ref(db('alice'), `rooms/${CODE}/chat`), msg('alice', '')));
    await assertFails(pushP(ref(db('alice'), `rooms/${CODE}/chat`), msg('alice', 'x'.repeat(101))));
    await seed(`rooms/${CODE}/chat/m1`, { uid: 'alice', name: '玩家', color: '#ff7a1a', text: '原文', ts: 1 });
    await assertFails(set(ref(db('alice'), `rooms/${CODE}/chat/m1/text`), '改掉'));
  });
});

describe('使用者資料', () => {
  it('只能讀寫自己的 users 節點', async () => {
    await assertSucceeds(set(ref(db('alice'), 'users/alice'), { room: CODE }));
    await assertFails(set(ref(db('bob'), 'users/alice'), { room: CODE }));
    await assertFails(get(ref(db('bob'), 'users/alice')));
  });
});

describe('連線對戰（game 節點）', () => {
  const init = { id: 'm1', v: 1, seed: 123, theme: 'grass', units: 4, turnTime: 45, gravity: 1, wind: true, water: true, fall: true, weapons: ['bazooka'], teams: [{ uid: 'alice' }, { uid: 'bob' }] };
  const start = (active: string) => ({ snap: '{}', hash: 'abc', active, digs: '[]' });
  const chunk = { f: 10, e: '[]' };
  async function seedMatch() {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } }, { status: 'playing' });
    await seed(`rooms/${CODE}/game`, { init, mask0: '1,2', turn: 1, starts: { 1: start('bob') } });
  }

  it('房主可以開始對戰並公布狀態，其他人不行', async () => {
    await seedRoom({ alice: { seat: '0' }, bob: { seat: '1' } });
    await assertFails(update(ref(db('bob'), `rooms/${CODE}`), { game: { init }, 'meta/status': 'playing' }));
    await assertSucceeds(update(ref(db('alice'), `rooms/${CODE}`), { game: { init }, 'meta/status': 'playing' }));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/starts/2`), start('bob')));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/go/1`), true));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/result`), { w: 'null', stats: '[]', turn: 3 }));
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}/game/starts/1`), start('alice')));
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}/game/go/1`), true));
  });

  it('只能回報自己的確認，房外的人不行', async () => {
    await seedMatch();
    await assertSucceeds(set(ref(db('bob'), `rooms/${CODE}/game/acks/1/bob`), 'abc'));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/acks/1/alice`), 'abc'));
    await assertFails(set(ref(db('mallory'), `rooms/${CODE}/game/acks/1/mallory`), 'abc'));
  });

  it('只有輪到的玩家能送出輸入，且不能覆寫已送出的資料', async () => {
    await seedMatch();
    await assertSucceeds(set(ref(db('bob'), `rooms/${CODE}/game/in/1/c00000`), chunk));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/in/1/c00000`), { f: 99, e: '[]' }));
    await assertFails(set(ref(db('mallory'), `rooms/${CODE}/game/in/1/c00001`), chunk));
    // 房主不是這回合的操作者，但房主對 game 節點有完整權限（房主權威）
    await assertSucceeds(set(ref(db('alice'), `rooms/${CODE}/game/in/1/c00001`), chunk));
    // 不是輪到自己的回合
    await seed(`rooms/${CODE}/game/starts/2`, start('alice'));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/in/2/c00000`), chunk));
  });

  it('輸入資料格式驗證', async () => {
    await seedMatch();
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/in/1/x1`), chunk));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/in/1/c00002`), { f: 'x', e: '[]' }));
    await assertFails(set(ref(db('bob'), `rooms/${CODE}/game/in/1/c00003`), { f: 1, e: '[]', hp: 999 }));
  });
});
