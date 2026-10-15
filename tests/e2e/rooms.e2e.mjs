// 線上房間端對端測試：兩個獨立瀏覽器（各自匿名登入）在本機 Emulator 上互動。
// 用法：npm run test:e2e（會先 build，再由 firebase emulators:exec 啟動 Emulator 執行本檔）
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const PORT = 4174;
const BASE = `http://localhost:${PORT}/?emulator=1`;
const SHOTS = '.smoke/e2e';
mkdirSync(SHOTS, { recursive: true });

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL || 'chrome', headless: true });

const errors = [];
let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + String(e.message || e).split('\n')[0]); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function player(label, nick) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  await page.goto(BASE);
  await page.getByText('已連線・本機 Emulator').waitFor({ timeout: 20000 });
  await page.locator('input[maxlength="10"]').fill(nick);
  return { ctx, page, label };
}
const text = p => p.page.locator('body').innerText();
const waitText = (p, t, timeout = 10000) => p.page.getByText(t, { exact: false }).first().waitFor({ timeout });
const roomCode = async p => (await text(p)).match(/房號 (\d{6})/)?.[1];
async function joinCode(p, code) {
  await p.page.getByPlaceholder('輸入 6 位數房號').fill(code);
  await p.page.getByRole('button', { name: '加入', exact: true }).click();
}

let A, B, C, code;
try {
  console.log('線上房間 E2E（Emulator）');
  A = await player('A', '小明');
  B = await player('B', '小華');

  await step('A 建立線上房間，取得 6 位數房號', async () => {
    await A.page.getByRole('button', { name: '建立線上房間' }).click();
    await waitText(A, '把房號傳給朋友就能加入');
    code = await roomCode(A);
    expect(/^\d{6}$/.test(code || ''), '沒有房號');
    expect((await text(A)).includes('1/2'), '人數應為 1/2');
  });

  await step('房號格式錯誤或不存在時顯示錯誤', async () => {
    await joinCode(B, '12');
    await waitText(B, '房號是 6 位數字');
    const wrong = code === '999999' ? '888888' : '999999';
    await joinCode(B, wrong);
    await waitText(B, '找不到這個房間');
  });

  await step('B 用房號加入，雙方都看到對方', async () => {
    await joinCode(B, code);
    await waitText(B, '小明 的房間');
    await waitText(A, '小華 加入了房間');
    expect((await text(A)).includes('2/2'), 'A 應看到 2/2');
    expect((await text(B)).includes('小明') && (await text(B)).includes('房主'), 'B 應看到房主小明');
  });

  await step('第三人加入：房間已滿', async () => {
    C = await player('C', '小美');
    await joinCode(C, code);
    await waitText(C, '房間已滿');
  });

  await step('房主未全員準備時不能開始', async () => {
    await A.page.getByText('開始對戰!').click();
    await waitText(A, '等待 1 位玩家準備');
    expect(!(await text(B)).includes('對戰進行中'), '不應開始');
  });

  await step('B 準備 → A 看到已準備，可以開始', async () => {
    await B.page.getByText('準備!', { exact: true }).click();
    await waitText(B, '取消準備');
    await waitText(A, '全員已準備');
  });

  await step('聊天雙向同步', async () => {
    await B.page.getByPlaceholder('說點什麼…').fill('哈囉小明');
    await B.page.getByText('送出').click();
    await waitText(A, '哈囉小明');
    await A.page.getByPlaceholder('說點什麼…').fill('你好小華');
    await A.page.keyboard.press('Enter');
    await waitText(B, '你好小華');
    await A.page.screenshot({ path: `${SHOTS}/room-host.png` });
    await B.page.screenshot({ path: `${SHOTS}/room-guest.png` });
  });

  await step('房主改地形 → B 同步；B 不能改設定', async () => {
    await A.page.getByText('月球基地').first().click();
    await waitText(B, '已選:月球基地');
    await B.page.getByText('糖果王國').first().click();
    await B.page.waitForTimeout(800);
    expect((await text(B)).includes('已選:月球基地'), 'B 不應能改地形');
    expect((await text(A)).includes('已選:月球基地'), 'A 的地形不應被改');
  });

  await step('B 換動物 → A 看到新動物', async () => {
    const before = await A.page.locator('canvas[data-animal]').evaluateAll(cs => cs.map(c => c.dataset.animal).join(','));
    await B.page.locator('button[title="點擊更換動物"]').click();
    await A.page.waitForFunction(b => [...document.querySelectorAll('canvas[data-animal]')].map(c => c.dataset.animal).join(',') !== b, before, { timeout: 8000 });
  });

  await step('房主開始對戰 → 雙方進入遊戲畫面；房主結束 → 雙方回到房間並需重新準備', async () => {
    await A.page.getByText('開始對戰!').click();
    for (const p of [A, B]) await p.page.waitForFunction(() => ['live', 'replay'].includes(window.FurballNet.netDebug()?.phase), null, { timeout: 30000 });
    await A.page.getByText('← 離開').first().click();
    await waitText(A, '把房號傳給朋友就能加入');
    await waitText(B, '準備!');
    await waitText(A, '等待 1 位玩家準備');
  });

  await step('B 斷線（關閉瀏覽器）→ A 看到 B 離線', async () => {
    await B.ctx.close();
    await waitText(A, '小華 離線了', 20000);
    expect((await text(A)).includes('離線'), '應顯示離線');
  });

  await step('房主踢出離線玩家，空出座位讓 C 加入', async () => {
    await A.page.locator('button[title="移除"]').click();
    await waitText(A, '1/2');
    await joinCode(C, code);
    await waitText(C, '小明 的房間');
    await waitText(A, '小美 加入了房間');
  });

  await step('房主重新整理頁面 → 自動回到房間且仍是房主', async () => {
    await A.page.reload();
    await waitText(A, '把房號傳給朋友就能加入', 20000);
    expect((await roomCode(A)) === code, '應回到同一房號');
    expect((await text(A)).includes('2/2'), '應仍有 2 人');
  });

  await step('房主離開 → C 成為房主', async () => {
    await A.page.getByText('← 離開').click();
    await waitText(A, '建立線上房間');
    await waitText(C, '小明 離開了房間');
    await waitText(C, '把房號傳給朋友就能加入');
  });

  await step('最後一人離開 → 房間刪除，房號無法再加入', async () => {
    await C.page.getByText('← 離開').click();
    await waitText(C, '建立線上房間');
    await joinCode(A, code);
    await waitText(A, '找不到這個房間');
  });

  await step('房主斷線（關閉瀏覽器）超過 10 秒 → 房內玩家自動接手房主', async () => {
    const D = await player('D', '阿德'), E = await player('E', '阿依');
    await D.page.getByRole('button', { name: '建立線上房間' }).click();
    await waitText(D, '把房號傳給朋友就能加入');
    const c2 = await roomCode(D);
    await joinCode(E, c2);
    await waitText(E, '阿德 的房間');
    await D.ctx.close();
    await waitText(E, '阿德 離線了', 20000);
    await waitText(E, '阿依 成為房主', 25000);
    await waitText(E, '把房號傳給朋友就能加入');
    await E.page.getByText('← 離開').click();
    await E.ctx.close();
  });

  await step('單人對戰電腦仍可正常開局', async () => {
    await A.page.getByText('單人對戰電腦').click();
    await A.page.getByText('開始對戰!').click();
    await A.page.locator('canvas').first().waitFor();
    await A.page.waitForTimeout(1500);
    await A.page.screenshot({ path: `${SHOTS}/local-game.png` });
    expect((await text(A)).includes('鐵皮倉鼠'), 'HUD 應顯示電腦隊伍');
  });
} catch (e) {
  failed++; console.log('  ✗ 測試中斷：' + (e.message || e));
} finally {
  for (const p of [A, B, C]) if (p) await p.page.screenshot({ path: `${SHOTS}/${p.label}-final.png` }).catch(() => {});
  await browser.close();
  await new Promise(r => server.httpServer.close(r));
  if (errors.length) { console.log(`\n瀏覽器錯誤 ${errors.length} 筆：`); for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e.split('\n')[0]); }
  console.log(`\n${passed} 通過，${failed} 失敗`);
  process.exit(failed || errors.length ? 1 : 0);
}
