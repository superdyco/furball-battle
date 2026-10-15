// 瀏覽器冒煙測試：用本機 Chrome（SMOKE_CHANNEL 可改 msedge）開啟遊戲，走「單人對戰電腦 → 開始對戰」並實際打一段時間。
// 用法：node tools/smoke.mjs <網址> <截圖資料夾> [秒數] [--lobby-only]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [url, outDir, secArg] = process.argv.slice(2);
const lobbyOnly = process.argv.includes('--lobby-only');
const seconds = Number(secArg) || 90;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push('http ' + r.status() + ': ' + r.url()); });

const shot = name => page.screenshot({ path: join(outDir, name + '.png') });
const report = {};
try {
  await page.goto(url, { waitUntil: 'load' });
  await page.getByText('單人對戰電腦').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !!window.FurballEngine, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot('1-lobby');
  await page.getByText('單人對戰電腦').click();
  await page.getByText('開始對戰!').waitFor();
  await page.waitForTimeout(800);
  await shot('2-room');
  if (lobbyOnly) throw 'done';

  // 不修改程式：包一層 create，把遊戲實例存到 window.__game 以便觀察
  await page.evaluate(() => {
    const FE = window.FurballEngine, orig = FE.create;
    FE.create = (...a) => (window.__game = orig(...a));
  });
  await page.getByText('開始對戰!').click();
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  report.cfg = await page.evaluate(() => { const c = window.__game.cfg; return { hp: c.hp, unitsPerTeam: c.unitsPerTeam, turnTime: c.turnTime, fallDamage: c.fallDamage, teams: c.teams.map(t => t.name + (t.ai ? '(AI:' + t.ai + ')' : '')) }; });
  await page.waitForTimeout(1500);
  await shot('3-game-start');

  const t0 = Date.now(); let n = 0, overAt = null;
  while (Date.now() - t0 < seconds * 1000) {
    const st = await page.evaluate(() => { const g = window.__game; return { state: g.state, ai: g.isAI() }; });
    if (st.state === 'over') { overAt = Math.round((Date.now() - t0) / 1000); break; }
    if (st.state === 'aim' && !st.ai) {
      // 真人回合：瞄準最近的敵人上方、蓄力發射火箭筒
      await page.evaluate(() => {
        const g = window.__game, u = g.active(); if (!u) return;
        const foe = g.units.filter(v => !v.dead && v.team !== u.team).sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
        if (foe) g.aimAt({ x: foe.x, y: foe.y - 220 });
      });
      await page.keyboard.down('Space'); await page.waitForTimeout(500 + (n % 4) * 150); await page.keyboard.up('Space');
      n++;
      if (n === 1) { await page.waitForTimeout(400); await shot('4-first-shot'); }
    }
    await page.waitForTimeout(500);
  }
  await shot('5-end');
  report.shotsFired = n;
  report.overAfterSec = overAt;
  report.state = await page.evaluate(() => {
    const g = window.__game;
    return {
      frame: g.frame, turnCount: g.turnCount, state: g.state, waterY: g.waterY,
      teams: g.teams.map(t => ({ name: t.name, dmg: t.dmg, kills: t.kills, hp: t.units.map(u => u.dead ? 'X' : u.hp) })),
    };
  });
} catch (e) {
  if (e !== 'done') errors.push('script: ' + (e && e.message || e));
} finally {
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
