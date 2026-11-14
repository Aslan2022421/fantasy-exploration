# 出處與授權

遊戲隨附或改作的外部素材。加新素材時在這裡補一筆，授權全文放在素材旁邊。

## 地圖字元表

- 檔案：`assets/tiles/cp437.png`
- 來源：PxPlus IBM BIOS，出自 The Ultimate Oldschool PC Font Pack，(c) 2016-2020 VileR，<https://int10h.org/oldschool-pc-fonts/>
- 授權：CC BY-SA 4.0，<https://creativecommons.org/licenses/by-sa/4.0/>；全文見 `tools/cp437/LICENSE-oldschool-pc-font-pack.txt`
- 修改：把字型的 CP437 256 個字轉成 8×8 點陣、排成 16×16 的圖（`tools/cp437/make.mjs`）。這張字元表同樣以 CC BY-SA 4.0 釋出。
- 原字型 `tools/cp437/PxPlus_IBM_BIOS.ttf` 只用來產生字元表，不隨遊戲散布。

## 介面字型

- 檔案：`assets/fonts/fusion-pixel-12px-proportional-zh_tw.ttf`
- 來源：Fusion Pixel Font 2026.11.10 版，(c) 2022 TakWolf，<https://github.com/TakWolf/fusion-pixel-font>
- 授權：SIL Open Font License 1.1；全文見 `assets/fonts/OFL-fusion-pixel.txt`
- 未修改。字型內含其他字型的字形，各自的授權見 `assets/fonts/licenses/`：Ark Pixel Font（TakWolf，OFL 1.1）、俐方體11號 Cubic 11（含 M+ FONTS 等來源，OFL 1.1）、Galmuri（Lee Minseo，OFL 1.1）。

## 礦物數值

- 檔案：`data/material/minerals.json` 的 `hardness`
- 來源：Anthony, Bideaux, Bladh, Nichols 編，Handbook of Mineralogy，Mineralogical Society of America，<https://www.handbookofmineralogy.org/>（Chalcopyrite、Hematite、Quartz、Gold 各條）
- 授權：只取莫氏硬度的數值（事實資料），沒有收錄原文
- 修改：範圍取中間值（例如 5–6 取 5.5）；每筆的出處寫在該筆的 `source`

## 程式套件

執行時用到的套件，授權全文在各套件的 `node_modules/<套件>/LICENSE`，打包時一起附上：

- rot-js 2.2.1：BSD-3-Clause
- zod 4.6.7：MIT
- geotic 4.3.2：MIT
