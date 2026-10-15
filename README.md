# 毛球大砲戰

HTML5 Canvas 回合制砲擊遊戲（類百戰天蟲）。目前提供單機、本機多人和電腦 AI 對戰，以及 Firebase 線上房間（建立、加入、準備、聊天）。線上對戰本身尚未開放，見下方「里程碑」。

## 開發

```bash
npm install
npm run dev          # 開發伺服器（連正式 Firebase）
npm run emulators    # 另開終端機：本機 Firebase Emulator（需要 Java 11+）
npm run dev:emu      # 開發伺服器，改連本機 Emulator（網址帶 ?emulator=1）
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
| `src/config/firebase.ts` | Firebase 前端設定（公開資訊，不含任何私密金鑰） |
| `src/net/` | `FirebaseService`（連線、匿名登入）、`RoomManager`（線上房間），對外提供 `window.FurballNet` |
| `database.rules.json` | Realtime Database 安全規則 |
| `tests/golden/` | 原版引擎與新引擎逐幀比對 |
| `tests/unit/` | 數值與傷害公式的單元測試 |
| `tests/rules/` | 安全規則測試（Emulator） |
| `tests/e2e/` | 兩個瀏覽器的線上房間端對端測試（Emulator） |
| `tools/` | bundle 解包、瀏覽器冒煙測試 |

## 測試

```bash
npm test             # 全部測試（約 40 秒）
npm run test:unit    # 數值、傷害公式（幾秒）
npm run test:golden  # 原版 vs 新版逐幀比對
npm run test:rules   # 安全規則（自動啟動 Emulator，需要 Java 11+）
npm run test:e2e     # 兩個 Chrome 在 Emulator 上互動（建房、加入、準備、聊天、斷線、房主轉移）
```

規則測試和端對端測試只連本機 Emulator（專案 ID `demo-furball`），不會讀寫正式資料庫。

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

## 線上房間

### 使用方式

1. 在大廳按「建立線上房間」，會得到一組 6 位數房號。
2. 把房號傳給朋友，朋友在「加入好友的房間」輸入房號。
3. 非房主的玩家按「準備!」。全員準備好之後，房主按「開始對戰!」。

### 運作方式

- **身分**：使用匿名登入，身分存在分頁的 sessionStorage。
  - 同一個分頁重新整理後，會自動回到原本的座位。
  - 不同分頁是不同的玩家，所以一台電腦開兩個分頁就能自己測試。
- **人數上限**：房間目前限 2 人（`RoomManager` 的 `ROOM_DEFAULT_MAX_PLAYERS`），資料結構與安全規則都已支援 2～6 人。座位以 `transaction` 搶占，安全規則保證座位編號不會超過上限。
- **斷線**：由 `onDisconnect` 自動標記為離線，座位會保留；房主可以踢出長時間離線的玩家。
- **房主轉移**：房主主動離開時直接轉移給其他玩家；房主斷線超過 10 秒，由座位最前面的在線玩家接手。最後一人離開時刪除房間。
- **房間過期**：房間 12 小時沒有更新即視為過期，房號可以被新房間重複使用。目前沒有後端，所以過期的房間資料不會自動刪除；它們會留在資料庫裡，直到該房號被重新使用時才被覆蓋。
- **設定同步**：地形、規則、彈藥由房主決定並同步給所有人，其他玩家不能修改。

### 套用安全規則到正式資料庫

正式資料庫建立時是「鎖定模式」，**必須先套用 `database.rules.json`，線上房間才能運作**。以下兩種方式擇一：

- **控制台**：Firebase Console → Realtime Database →「規則」分頁 → 把 `database.rules.json` 的內容整段貼上 →「發布」。
- **CLI**：先執行 `npx firebase login`，再執行 `npx firebase deploy --only database --project furball-battle`。

### 限制

- 這是好友私人房間的架構，**不是防作弊架構**。安全規則只能檢查資料格式和「誰能寫哪裡」，無法驗證遊戲的物理結果。
- 房號是 6 位數字，有心人可以猜。房間資料僅限登入者讀取，但不需要額外密碼。
- `firebase-tools` 固定在 13.x，因為 14 版以後需要 Java 21，這台機器只有 Java 11。它的相依套件有 npm audit 警告，不過它只是本機開發與部署工具，不會打包進遊戲。

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
6. 排行榜混入了 10 位寫死的種子玩家，戰績只存在本機 localStorage，沒有跨裝置同步。

（原版的假房間列表、假玩家加入、假聊天回覆已在 M2 移除，改為真正的線上房間。原版 `componentDidUpdate` 在 console 報錯、聊天不會自動捲動的問題也一併修正，原因是 dc-runtime 不會傳入 prevState。）

## 里程碑

- [x] **M1** 遊戲數值整理：GameBalance、DamageSystem、測試
- [x] M2 Firebase 房間系統
- [ ] M3 雙人連線對戰（火箭筒、單一地圖）
- [ ] M4 全武器整合
- [ ] M5 穩定性與部署
