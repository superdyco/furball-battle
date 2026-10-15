# 毛球大砲戰

HTML5 Canvas 回合制砲擊遊戲（類百戰天蟲）。目前提供單機、本機多人和電腦 AI 對戰；Firebase 線上多人對戰規劃中（見下方「里程碑」）。

## 開發

```bash
npm install
npm run dev          # 開發伺服器
npm run build        # 型別檢查 + 正式版建置（輸出到 dist/）
npm run preview      # 預覽正式版（http://localhost:4173/）
```

需要 Node.js 20 以上。

## 專案結構

| 路徑 | 內容 |
|---|---|
| `線上百戰天蟲遊戲企劃.html` | 原始 Claude Design bundle。**行為基準，請勿修改**：golden 測試會從這個檔案解出原版引擎來比對 |
| `index.html` | 大廳、房間、排行榜 UI（dc-runtime + React 外殼，由 bundle 還原而來） |
| `public/vendor/` | dc-runtime、React 18、字型（由 `npm run unbundle` 從 bundle 產生） |
| `src/engine/` | Canvas 遊戲引擎，對外提供 `window.FurballEngine` |
| `src/config/GameBalance.ts` | **所有遊戲平衡數值**：HP、爆炸、墜落、物理、回合、空投、15 種武器 |
| `src/systems/DamageSystem.ts` | 傷害計算的純函式：爆炸衰減、擊退、墜落、扣血、補血 |
| `tests/golden/` | 原版引擎與新引擎逐幀比對 |
| `tests/unit/` | 數值與傷害公式的單元測試 |
| `tools/` | bundle 解包、瀏覽器冒煙測試 |

## 測試

```bash
npm test             # 全部測試（約 40 秒）
npm run test:unit    # 數值、傷害公式（幾秒）
npm run test:golden  # 原版 vs 新版逐幀比對
```

**Golden-master 測試**會在 Node 裡用 `@napi-rs/canvas` 模擬瀏覽器，同時執行原版 bundle 內的引擎和 `src/engine`，餵入相同的 seed 和輸入，逐幀比對以下項目，必須完全相同：

- 角色、砲彈、火焰、地雷、補給箱的狀態
- 地形遮罩
- 畫面像素
- HUD 事件
- 勝負結果
- RNG 序列

情境包含 6 張地圖、3 種重力、AI 三種難度，以及由腳本模擬的真人玩家輪流使用全部 15 種武器。

> 只要刻意改變遊戲行為，例如修 bug 或調整平衡，golden 測試就一定會失敗。這時要先確認改動是預期中的，再更新對應的情境或預期值。

**瀏覽器冒煙測試**（需要本機 Chrome）會走一次「單人對戰電腦 → 開始對戰」，實際打 90 秒，截圖輸出到 `.smoke/`：

```bash
npm run build && npm run preview   # 另開一個終端機
npm run smoke
```

## 調整遊戲數值

所有數值都在 `src/config/GameBalance.ts`，每一項都有註解。注意：

- 遊戲以固定 60 幀/秒更新，時間單位一律是「幀」。
- 所有隨機事件（地形、風、空投、粒子特效、AI）共用同一個 RNG。增加或刪除任何一次 `R()` 呼叫，都會改變之後所有的隨機結果。
- 改了數值之後，`tests/unit/DamageSystem.test.ts` 裡「數值與原版相同」那幾項要一起更新。

## 已知的原版問題（尚未修正，golden 測試鎖定現狀）

1. **AI 在沒有敵人時會讓遊戲卡死**：水位上升把最後的敵人淹死在新回合開頭時，AI 會沿用上回合的追蹤導彈，在沒有目標的情況下發射並拋出例外，遊戲迴圈因此停止。重現方式見 `tests/golden/scenarios.ts` 的第一個情境。
2. 內部 HP 可以低於 0（畫面上顯示 0）。HP ≤ 0 的角色要等回合結算才會倒下，在那之前仍可行動，也能被醫療箱救回。
3. 醫療箱補血沒有上限（`HP.allowOverheal = true`）。
4. 延遲生效的傷害（地雷、火焰）在別隊回合觸發時，戰績會算給「當時輪到的隊伍」。
5. 補給箱的武器池使用預設彈藥表，不會套用房間裡的彈藥設定。
6. 大廳 UI 的 `componentDidUpdate` 每次更新都會在 console 拋出 `Cannot read properties of undefined (reading 'chat')`（dc-runtime 沒有傳入 prevState）。
7. 房間列表、加入房間、聊天、邀請、排行榜的種子玩家都是**本機模擬**，沒有真正的網路連線。

## 里程碑

- [x] **M1** 遊戲數值整理：GameBalance、DamageSystem、測試
- [ ] M2 Firebase 房間系統
- [ ] M3 雙人連線對戰（火箭筒、單一地圖）
- [ ] M4 全武器整合
- [ ] M5 穩定性與部署
