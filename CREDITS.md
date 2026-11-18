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

## 物種名單與體型

- 檔案：`data/species/*.json` 的 `name`（中文名是自取的）、`source`（SRD 原名）、體型與攻擊方式
- 來源：System Reference Document 5.2.1，(c) Wizards of the Coast LLC。名單只取 SRD 5.2.1 收錄的生物，不取只在 OGL 名單上的怪物
- 授權：CC BY 4.0，<https://creativecommons.org/licenses/by/4.0/legalcode>
- 出處聲明：This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at <https://www.dndbeyond.com/srd>. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at <https://creativecommons.org/licenses/by/4.0/legalcode>.
- 核對：這段聲明讀自轉載 SRD 法律段的網頁（<https://rules.omnisgm.com/en/dnd/srd-5.2/legal/>），還沒對照官方 PDF 原文，上架前要核對一次
- 修改：只取名字、體型分類與攻擊方式當參考；數值塊不用 SRD 的（戰鬥不用 d20 對 AC），照下一條的問答換算

## 建怪問答與數值換算

- 檔案：`src/data/blocks.js`、`data/species/*.json` 的 `answers`
- 來源：Dungeon World，(c) Sage Kobold Productions（作者 Sage LaTorra、Adam Koebel），<https://github.com/Sagelt/Dungeon-World>，其中 Making Monsters 的問答順序與各答案對應的傷害骰、生命、護甲數字
- 授權：CC BY 3.0 Unported，<https://creativecommons.org/licenses/by/3.0/>
- 修改：只取問答的結構與數字，改成資料檔的選項與換算函式；動物的本能與招式是自己寫的，不照搬原文。Dungeon World 的儲存庫另含 SRD 5.1 的內容，這裡沒有取用

## 怪物的本能與招式

- 檔案：`data/species/monsters.json` 的 `instinct`、`moves`（哥布林、骷髏、巨魔），以及各自的問卷答案（照原書的數值塊反推）
- 來源：Dungeon World 的 Cavern Dwellers（Goblin）、Legions of the Undead（Skeleton）、Denizens of the Swamp（Troll），(c) Sage Kobold Productions，<https://github.com/Sagelt/Dungeon-World>（`text/monster_settings/`）；中譯取自地城世界 HTML SRD 中文化（免費開源 TRPG 中文化團隊，Hazmole 等譯）
- 授權：CC BY 3.0 Unported，<https://creativecommons.org/licenses/by/3.0/>
- 修改：本能照中譯；招式只取一部分，哥布林的「撤退後帶更多同伴回來」是自己譯的；骷髏的「重擊」、巨魔的「掄棍棒砸」等攻擊方式是自己寫的

## 程式套件

執行時用到的套件，授權全文在各套件的 `node_modules/<套件>/LICENSE`，打包時一起附上：

- rot-js 2.2.1：BSD-3-Clause
- zod 4.6.7：MIT
- geotic 4.3.2：MIT
