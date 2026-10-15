// 原版 bundle 引擎 vs 重構後引擎：同 seed、同輸入，逐幀狀態必須完全一致。
import { describe, it, expect } from 'vitest';
import { compareRuns } from './harness';
import { SCENARIOS, ALL_WEAPONS } from './scenarios';

describe('golden master：重構後行為與原版完全一致', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const r = compareRuns(sc);
      expect(r.ok, r.message).toBe(true);
      expect(r.b.framesRun).toBe(r.a.framesRun);
      expect(r.b.maskHashes).toEqual(r.a.maskHashes);
      expect(r.b.renderHashes).toEqual(r.a.renderHashes);
      expect(r.b.hudLog).toEqual(r.a.hudLog);
      expect(r.b.over).toEqual(r.a.over);
      expect(r.b.crash).toEqual(r.a.crash);
      expect(r.b.finalMask).toBe(r.a.finalMask);
      expect(r.b.finalTerrain).toBe(r.a.finalTerrain);
      expect(r.b.rngTail).toEqual(r.a.rngTail);
      // 情境本身有意義：電腦對戰要打完；武器輪替要真的用到每一種武器
      if (!sc.script) expect(r.a.over ?? r.a.crash, `${sc.name} 在 ${sc.frames} 幀內沒打完`).not.toBeNull();
      if (sc.expectCrash) expect(r.a.crash).toMatch(sc.expectCrash);
      else expect(r.a.crash).toBeNull();
      if (sc.name.includes('15 種武器')) expect(Object.keys(r.a.mem.fired ?? {}).sort()).toEqual([...ALL_WEAPONS].sort());
    });
  }
});
