// Golden-master 測試工具：在 Node 以 @napi-rs/canvas 模擬瀏覽器，
// 讓「原版 bundle 內的引擎」與「重構後的 TS 引擎」以相同 seed、相同輸入並排執行，逐幀比對遊戲狀態。
import { createCanvas } from '@napi-rs/canvas';
import { readOriginalEngineSource } from '../../tools/bundle-lib.mjs';
import { FurballEngine } from '../../src/engine';
import type { GameConfig } from '../../src/engine/types';

const VIEW = { left: 0, top: 0, width: 960, height: 540 };

function makeCanvas() {
  const c = createCanvas(1, 1) as any;
  c.style = {};
  c.addEventListener = () => {};
  c.setPointerCapture = () => {};
  c.getBoundingClientRect = () => VIEW;
  c.remove = () => {};
  return c;
}

const fakeDocument = { createElement: () => makeCanvas() };
const fakeWindow: any = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
class FakeResizeObserver { observe() {} disconnect() {} }
const raf = () => 0, caf = () => {};

export function installDom() {
  const g = globalThis as any;
  g.document = fakeDocument;
  g.window = fakeWindow;
  g.ResizeObserver = FakeResizeObserver;
  g.requestAnimationFrame = raf;
  g.cancelAnimationFrame = caf;
}

let originalApi: any;
export function loadOriginal(): any {
  if (originalApi) return originalApi;
  const win: any = { ...fakeWindow };
  const fn = new Function('window', 'document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', readOriginalEngineSource());
  fn(win, fakeDocument, FakeResizeObserver, raf, caf, performance);
  return (originalApi = win.FurballEngine);
}

export function loadRefactored(): any {
  installDom();
  return FurballEngine;
}

export function makeHost() {
  return { appendChild() {}, getBoundingClientRect: () => VIEW } as any;
}

// ---------- 狀態快照 ----------

function fnv(str: string, h = 2166136261) {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hashBytes(a: ArrayLike<number>) {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function snapshot(g: any) {
  const unitKey = (u: any) => u ? `${u.team.idx}:${u.name}` : null;
  return {
    frame: g.frame, state: g.state, teamTurn: g.teamTurn, turnCount: g.turnCount, wind: g.wind, waterY: g.waterY,
    timeLeft: g.timeLeft, retreatT: g.retreatT, settleT: g.settleT, power: g.power, charging: !!g.charging,
    msg: g.msg, msgT: g.msgT, shake: g.shake, target: g.target, turnDmg: g.turnDmg ?? null,
    units: g.units.map((u: any) => [u.x, u.y, u.vx, u.vy, u.hp, u.dead, u.air, u.face, u.aimA, u.grapple ?? null, u.drill ?? null]),
    teams: g.teams.map((t: any) => [t.dmg, t.kills, t.bestTurn, t.cur, t.weapon, t.ammo]),
    proj: g.proj.map((p: any) => ({ ...p, owner: unitKey(p.owner) })),
    flames: g.flames, mines: g.mines, crates: g.crates, graves: g.graves,
    parts: g.parts.map((p: any) => [p.type, p.x, p.y, p.vx, p.vy, p.size, p.col, p.life]),
    texts: g.texts.map((t: any) => [t.txt, t.x, t.y, t.life, t.col, t.size, unitKey(t.u)]),
    ai: g.ai,
  };
}

export const maskHash = (g: any) => hashBytes(g.mask);
export const terrainHash = (g: any) => hashBytes(g.tctx.getImageData(0, 0, g.terrain.width, g.terrain.height).data);

// ---------- 情境 ----------

export interface Scenario {
  name: string;
  cfg: GameConfig;
  frames: number;
  /** 每幀在 step() 之前呼叫，只能透過公開方法操作遊戲（與玩家輸入等價） */
  script?: (g: any, frame: number, mem: Record<string, any>) => void;
  /** 每隔多少幀呼叫一次 render() 並比對畫面像素；0 表示不比對 */
  renderEvery?: number;
  /** 原版已知會崩潰的情境：崩潰訊息需符合此樣式 */
  expectCrash?: RegExp;
}

export interface RunResult {
  frameHashes: number[];
  maskHashes: number[];
  renderHashes: number[];
  hudLog: string[];
  over: string | null;
  /** 引擎拋出例外時的「幀數: 訊息」（原版本身有會崩潰的 bug，崩潰也必須一致） */
  crash: string | null;
  final: any;
  finalMask: number;
  finalTerrain: number;
  rngTail: number[];
  framesRun: number;
  mem: Record<string, any>;
}

function seededRandom(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

export function run(api: any, sc: Scenario, stopAt = Infinity): { result: RunResult; game: any } {
  const hudLog: string[] = []; let over: string | null = null;
  const realRandom = Math.random;
  Math.random = seededRandom(99);
  try {
    const game = api.create(makeHost(), structuredClone(sc.cfg), {
      onHud: (h: any) => hudLog.push(JSON.stringify(h)),
      onGameOver: (w: any, stats: any) => { over = JSON.stringify({ w, stats }); },
    });
    const frameHashes: number[] = [], maskHashes: number[] = [], renderHashes: number[] = [];
    const mem: Record<string, any> = {};
    let f = 0, crash: string | null = null;
    for (; f < sc.frames && f < stopAt; f++) {
      if (game.state === 'over') break;
      sc.script?.(game, f, mem);
      try { game.step(); } catch (e) { crash = `${f}: ${String(e)}`; break; }
      frameHashes.push(fnv(JSON.stringify(snapshot(game))));
      if (f % 120 === 0) maskHashes.push(maskHash(game));
      if (sc.renderEvery && f % sc.renderEvery === 0) {
        game.render();
        renderHashes.push(hashBytes(game.ctx.getImageData(0, 0, game.cv.width, game.cv.height).data));
      }
    }
    const final = snapshot(game);
    const result: RunResult = {
      frameHashes, maskHashes, renderHashes, hudLog, over, crash, final,
      finalMask: maskHash(game), finalTerrain: terrainHash(game),
      rngTail: [game.R(), game.R(), game.R()], framesRun: f, mem,
    };
    return { result, game };
  } finally {
    Math.random = realRandom;
  }
}

/** 比對兩次執行；若不同，回傳第一個分歧幀的兩邊快照，方便除錯 */
export function compareRuns(sc: Scenario) {
  const orig = loadOriginal(), next = loadRefactored();
  const a = run(orig, sc).result, b = run(next, sc).result;
  const n = Math.max(a.frameHashes.length, b.frameHashes.length);
  for (let i = 0; i < n; i++) {
    if (a.frameHashes[i] !== b.frameHashes[i]) {
      const sa = snapshot(run(orig, sc, i + 1).game), sb = snapshot(run(next, sc, i + 1).game);
      const diff: string[] = [];
      for (const k of Object.keys(sa)) {
        const x = JSON.stringify((sa as any)[k]), y = JSON.stringify((sb as any)[k]);
        if (x !== y) diff.push(`${k}:\n  原版 ${x.slice(0, 400)}\n  新版 ${y.slice(0, 400)}`);
      }
      return { ok: false as const, a, b, message: `第 ${i} 幀分歧\n${diff.join('\n')}` };
    }
  }
  return { ok: true as const, a, b, message: '' };
}
