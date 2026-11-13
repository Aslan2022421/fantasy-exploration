# Fantasy Exploration 的工作規則

給在這個專案工作的 Claude（包括子代理與雲端工作階段）。使用者提供概念、決定好不好玩，Claude 寫程式。

## 開工前

- 讀 `design/PLAN.md`：目前在哪個階段、這階段做什麼。規則以 `design/` 為準。
- 使用者交代的規格照做。做不到或互相衝突時，用最接近的做法完成其他部分，在回報裡逐條列出，由使用者決定。

## 指令

- `npm run check`：Biome 檢查＋全部測試。交出前必須通過。
- `npm run play`：開發伺服器（http://127.0.0.1:8765）。網址加 `?nosave` 用記憶體存檔，不碰使用者的存檔。
- `npm run build`：打包成單一檔 `dist/Fantasy Exploration.html`（檔名使用者定）（字型、字元表、程式全內嵌，約 10 MB），任何瀏覽器雙擊就能開，不需要伺服器。改完程式要給使用者玩時重跑一次。
- `npm run tiles`：重新產生 CP437 字元表。
- 已知限制：ROT.js 的 Display 每畫一格就重新染色，整張地圖重畫比自己的 `tiles.js` 慢 15～40 倍，地圖不用它。
- 開發途中只跑跟改動有關的測試：`npx vitest run --sinceLastRun`（上次之後改過的，加上次失敗的）；只跑某個檔：`npx vitest run <檔名>`。
- 用之前先讀已裝套件實際提供的功能（`node_modules` 裡的型別定義、README、`--help`），有現成的就不自己寫。

## 程式

- ES modules、純 JavaScript，Vite 開發與建置，Vitest 測試，Biome 檢查格式與 lint。
- 資料夾：`src/core`（存檔、紀錄、亂數）、`src/data`（資料載入與 Zod 規格）、`src/world`（地圖與世界）、`src/view`（繪製）、`src/app`（入口與輸入）、`data/`（JSON 資料，一類型一資料夾，條目帶 `id`）、`assets/`（隨遊戲帶走的檔案）、`tools/`（腳本與原料）。
- 依賴只往下走：`view` 可以讀 `world`，`world` 不讀 `view`；`core` 不依賴任何人。模擬層要能在 Node 裡測。
- 一個檔案管一件事，超過 300 行就拆。測試放在被測檔案旁邊（`x.js` 配 `x.test.js`），跨檔的測試放 `test/`。
- 存檔只透過 `src/core/store.js` 的介面，不直接碰 `localStorage`。
- 存檔只存種子＋紀錄，地圖讀檔時重生。改了地形生成（`src/world/landform.js`、`terrain.js`，或 `data/terrain`、`data/biome`、`data/object`）就把 `src/world/world.js` 的 `WORLD_VERSION` 加一，否則舊紀錄會套到新地圖上錯位。
- 地圖用 `assets/tiles/cp437.png` 蓋印章，介面字用 `src/view/font.js` 烘焙點陣；格子永遠是 8 的整數倍、文字 12 的整數倍。
- 註解用繁體中文，寫為什麼，不寫顯而易見的事。
- 不使用區塊鏈、挖礦、虛擬貨幣的概念與用語。

## 素材

加任何外部素材（字型、圖、資料、規則文字）都要在 `CREDITS.md` 補一筆：來源、作者、授權、有沒有修改，授權全文放在素材旁邊。

## git

- 每個階段一支短分支（例如 `v0.1-s0`），目前從 `rebuild` 開、合回 `rebuild`；`rebuild` 合進 `main` 由使用者決定。
- 不要直接推到 `main`；推送前先問使用者。

## 文件與文字

- 開發日誌在使用者電腦上的 Obsidian vault，不在這個儲存庫；雲端工作階段在回報裡寫好要加進日誌的那一段。
- 一律繁體中文、台灣用語；全形標點，引號用「」；中文與英文、數字之間加半形空格。日期 YYYY-MM-DD。
