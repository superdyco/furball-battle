// 連線對戰端對端測試：兩個獨立瀏覽器在本機 Emulator 上輪流射擊，逐回合比對雙方狀態。
// 用法：npm run test:e2e:battle
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const PORT = 4175;
const BASE = `http://localhost:${PORT}/?emulator=1`;
const SHOTS = '.smoke/e2e-battle';
mkdirSync(SHOTS, { recursive: true });

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL || 'chrome', headless: true });
const errors = [];
let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e.message || e).split('\n')[0]); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function player(label, nick) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
  await page.goto(BASE);
  await page.getByText('已連線・本機 Emulator').waitFor({ timeout: 20000 });
  await page.locator('input[maxlength="10"]').fill(nick);
  return { ctx, page, label };
}
const text = p => p.page.locator('body').innerText();
const waitText = (p, t, timeout = 15000) => p.page.getByText(t, { exact: false }).first().waitFor({ timeout });
const dbg = p => p.page.evaluate(() => window.FurballNet.netDebug());

/** 輪到自己時：用引擎的彈道模擬找能打中敵人的角度與力道，透過真實輸入路徑瞄準並按住空白鍵蓄力發射 */
async function takeShot(p) {
  const plan = await p.page.evaluate(() => {
    const g = window.FurballNet.netGameEngine(), u = g.active();
    const foes = g.units.filter(v => !v.dead && v.team !== u.team);
    let best = null;
    for (const face of [-1, 1]) for (let ang = -1.4; ang <= .6; ang += .05) for (let pw = .25; pw <= 1; pw += .05) {
      const hit = g.sim(u, face, ang, pw, true); if (hit.lost) continue;
      if (Math.hypot(hit.x - u.x, hit.y - u.y) < 70) continue;
      const d = Math.min(...foes.map(v => Math.hypot(hit.x - v.x, hit.y - v.y)));
      if (!best || d < best.d) best = { d, face, ang, pw };
    }
    if (!best) best = { face: 1, ang: -.8, pw: .6 };
    // 以世界座標點瞄準（與滑鼠移動相同的輸入路徑）
    g.aimAt({ x: u.x + best.face * Math.cos(best.ang) * 200, y: u.y + Math.sin(best.ang) * 200 });
    return best;
  });
  await sleep(120);
  await p.page.keyboard.down('Space');
  await sleep(Math.max(60, plan.pw * 70 * 1000 / 60));
  await p.page.keyboard.up('Space');
  return plan;
}

let A, B;
const turnLog = [];
try {
  console.log('連線對戰 E2E（Emulator）');
  A = await player('A', '小明');
  B = await player('B', '小華');

  await step('建立房間、加入、設定每隊 2 隻、準備', async () => {
    await A.page.getByRole('button', { name: '建立線上房間' }).click();
    await waitText(A, '把房號傳給朋友就能加入');
    const code = (await text(A)).match(/房號 (\d{6})/)[1];
    await B.page.getByPlaceholder('輸入 6 位數房號').fill(code);
    await B.page.getByRole('button', { name: '加入', exact: true }).click();
    await waitText(B, '小明 的房間');
    // 房主把每隊角色從 4 調成 2（讓對戰較快分出勝負）
    const minus = A.page.locator('button', { hasText: '−' }).nth(1);
    await minus.click(); await minus.click();
    await B.page.getByText('準備!', { exact: true }).click();
    await waitText(A, '全員已準備');
  });

  await step('房主開始 → 雙方進入同一場對戰', async () => {
    await A.page.getByText('開始對戰!').click();
    for (const p of [A, B]) await p.page.waitForFunction(() => window.FurballNet.netDebug()?.phase === 'live' || window.FurballNet.netDebug()?.phase === 'replay', null, { timeout: 30000 });
    const [a, b] = [await dbg(A), await dbg(B)];
    expect(a.turn === 1 && b.turn === 1, `回合應為 1：${a.turn}/${b.turn}`);
    expect(a.localStartHash === a.startHash && b.localStartHash === a.startHash, '第一回合狀態雜湊不一致');
    expect(a.startHp === b.startHp, `HP 不一致 ${a.startHp} / ${b.startHp}`);
    await A.page.screenshot({ path: `${SHOTS}/turn1-A.png` });
    await B.page.screenshot({ path: `${SHOTS}/turn1-B.png` });
  });

  let over = false, refreshed = false, injected = false;
  for (let i = 0; i < 24 && !over; i++) {
    const [a0, b0] = [await dbg(A), await dbg(B)];
    const shooter = a0.phase === 'live' ? A : b0.phase === 'live' ? B : null;
    const turn = a0.turn;
    await step(`第 ${turn} 回合：${shooter ? shooter.label + ' 射擊' : '等待'}，雙方同步進入下一回合`, async () => {
      if (shooter) await takeShot(shooter);
      // 故意破壞觀看者的本機狀態，驗證下一回合會被房主校正
      if (turn === 3 && !injected) {
        injected = true;
        await B.page.evaluate(() => { const g = window.FurballNet.netGameEngine(); g.units[g.units.length - 1].hp -= 7; });
      }
      // 等待雙方進入下一回合或遊戲結束
      const deadline = Date.now() + 60000;
      for (;;) {
        const [a, b] = [await dbg(A), await dbg(B)];
        if (a.phase === 'over' && b.phase === 'over') { over = true; break; }
        if (a.turn > turn && b.turn > turn && a.phase !== 'hold' && b.phase !== 'hold') break;
        if (Date.now() > deadline) throw new Error(`逾時：A ${JSON.stringify(a)} B ${JSON.stringify(b)}`);
        await sleep(300);
      }
      if (over) return;
      const [a, b] = [await dbg(A), await dbg(B)];
      turnLog.push({ turn: a.turn, hp: a.startHp, corrections: b.corrections });
      expect(a.startHash && a.localStartHash === a.startHash, `房主雜湊不一致 ${a.localStartHash} / ${a.startHash}`);
      expect(b.localStartHash === a.startHash, `訪客雜湊 ${b.localStartHash} ≠ 房主 ${a.startHash}`);
      expect(a.startHp === b.startHp, `回合開始 HP 不一致 ${a.startHp} / ${b.startHp}`);
    });

    if (!over && turn === 3) {
      await step('被竄改的訪客狀態在下一回合被房主校正', async () => {
        const b = await dbg(B);
        expect(b.corrections >= 1, `訪客應被校正至少一次（corrections=${b.corrections}）`);
      });
    }

    if (!over && !refreshed && turn >= 4) {
      refreshed = true;
      await step('訪客中途重新整理 → 恢復到目前回合並保持同步', async () => {
        await B.page.reload();
        await B.page.waitForFunction(() => { const d = window.FurballNet?.netDebug?.(); return d && (d.phase === 'live' || d.phase === 'replay'); }, null, { timeout: 40000 });
        const [a, b] = [await dbg(A), await dbg(B)];
        expect(a.turn === b.turn, `回合不一致 ${a.turn} / ${b.turn}`);
        expect(b.localStartHash === a.startHash, '恢復後雜湊不一致');
        expect(a.startHp === b.startHp, `恢復後 HP 不一致 ${a.startHp} / ${b.startHp}`);
        await B.page.screenshot({ path: `${SHOTS}/after-refresh-B.png` });
      });
    }
  }

  if (over) {
    await step('分出勝負：雙方顯示相同結果', async () => {
      await waitText(A, '獲勝', 20000).catch(() => waitText(A, '同歸於盡'));
      const ta = await text(A), tb = await text(B);
      const wa = ta.match(/(\S+ 獲勝!|同歸於盡!)/)?.[1], wb = tb.match(/(\S+ 獲勝!|同歸於盡!)/)?.[1];
      expect(wa && wa === wb, `結果不同：${wa} / ${wb}`);
      await A.page.screenshot({ path: `${SHOTS}/over-A.png` });
    });
  } else console.log('  （24 回合內未分出勝負，略過結果比對）');

  await step('除了故意竄改那次，全程不需要校正（雙方模擬逐幀一致）', async () => {
    const [a, b] = [await dbg(A), await dbg(B)];
    // 訪客在第 4 回合後重新整理過，計數已歸零；竄改造成的那次校正發生在重新整理之前
    expect(a.corrections === 0, `房主被校正 ${a.corrections} 次`);
    expect(b.corrections === 0, `訪客（重新整理後）被校正 ${b.corrections} 次`);
  });

  await step('房主結束對戰 → 雙方回到房間', async () => {
    // 分出勝負時點結算畫面的「回到房間」，否則點遊戲畫面左上角的「← 離開」
    if (over) await A.page.getByText('回到房間').click();
    else await A.page.getByText('← 離開').first().click();
    await waitText(A, '把房號傳給朋友就能加入');
    await waitText(B, '準備!');
  });
} catch (e) {
  failed++; console.log('  ✗ 測試中斷：' + (e.message || e));
} finally {
  console.log('\n每回合狀態：' + turnLog.map(t => `#${t.turn}[${t.hp}]`).join(' '));
  for (const p of [A, B]) if (p) await p.page.screenshot({ path: `${SHOTS}/${p.label}-final.png` }).catch(() => {});
  await browser.close();
  await new Promise(r => server.httpServer.close(r));
  if (errors.length) { console.log(`\n瀏覽器錯誤 ${errors.length} 筆：`); for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e.split('\n')[0]); }
  console.log(`\n${passed} 通過，${failed} 失敗`);
  process.exit(failed || errors.length ? 1 : 0);
}
