// 全域設定與資料表。所有檔案都掛在 FE 命名空間底下，用一般 <script> 載入，雙擊 index.html 就能玩。
window.FE = window.FE || {};

FE.CONFIG = {
  SAVE_VERSION: 13,     // 規則改到跟舊存檔不相容時加一；讀到舊版本會清掉存檔、歷史紀錄與錯誤報告（2：地形加上高度；3：氣候生態區；4：地形字元改成矮人要塞字元表；5：世界改成二維區塊格；6：聚落標籤與地貌；7：聚落的外形、房屋與小路；8：區塊放大四倍、聚落外牆；9：有外牆與室內的建築、村民的家；10：外牆貼建築、怪物進不了聚落周圍、64×64、回合制圍攻與攻防判定、怪物分級、世界狀態；11：房屋與外牆之間的走道鋪成路，舊世界的走道還是空地；12：創世改看算力、世界等級、士兵；13：背包、工具、採集點、城鎮固定 3 位士兵、怪物血量的世界等級加成加大）
  // 世界的比例：一塊世界 64×64（第十九版從 32×24 放大四倍成 64×48，第二十一版高度再加到 64）。
  // 按「每塊幾個」算的數字照面積乘 4（第二十一版再乘 4/3），按「走幾步」算的距離照長寬乘 2；每步的算力與事件間隔不變，冒險者身邊的密度跟原本一樣
  CHUNK_W: 64,          // 一塊世界的寬（世界是二維的區塊格，新的一塊長在離冒險者最近的邊界上）
  CHUNK_H: 64,          // 一塊世界的高
  MAX_HEIGHT: 4,        // 地形高度 0～4；相鄰兩格差 1 是坡可以走，差 2 以上是斷崖
  STAMPS: [5, 16],      // 每塊世界蓋幾塊氣候印章（怪物的來源之一）
  SPIKES: [16, 27],     // 每塊世界有幾小塊地高度突變（斷崖的來源）
  CHESTS: [5, 16],      // 每塊世界創世時放幾個寶箱
  // 聚落周圍的圈：從外牆（聚落的 mask 格子）量起的切比雪夫距離，寬度看聚落種類。
  // 圈裡不生怪物、不侵蝕、不重算地形，怪物也不能踏進來（追到圈邊就停）。要塞與城市還沒有，先記數字
  SETTLE_BUFFER: { village: 8, town: 12, fortress: 14, city: 16 },
  VIEW_W: 21,           // 畫面一次顯示幾格寬（奇數，冒險者才會剛好在正中央）；由 render.js 依視窗大小與縮放算出來
  VIEW_H: 21,           // 畫面一次顯示幾格高（奇數）
  MINIMAP_W: 128,       // 小地圖顯示冒險者附近幾格寬
  MINIMAP_H: 96,        // 小地圖顯示冒險者附近幾格高
  MID_SCOPE: 5,         // 影響範圍 1～4 是小怪物，5 以上是中型怪物（創世時的大錯、合體生出的都是）
  BOSS_SCOPE: 12,       // 影響範圍 12 以上才算大型怪物；大怪物只來自世界級事件，留到第 2 階段，這一版不會生出來
  PLAYER_MAX_HP: 30,
  LEVEL_FIRST: 50,      // 升到第 2 級要的經驗值
  LEVEL_STEP: 25,       // 之後每級多要的經驗值
  LEVEL_HP: 5,          // 每升一級生命上限 +5
  PLAYER_ATK: 4,        // 初始武器攻擊力。一般攻擊＝攻擊力＋0～3，深度除錯＝攻擊力×2＋1～5
  SMITH_PRICE: 30,      // 武器升級價格
  SMITH_PRICE_STEP: 15, // 每升一次多要的金幣
  QUEST_EXP: 15,        // 一個任務的基本經驗值
  QUEST_GOLD: 10,       // 一個任務的基本金幣
  QUEST_STEPS_PER_EXP: 8,   // 送貨路程每幾步多 1 經驗值（路程變兩倍，獎勵不跟著翻倍）
  QUEST_STEPS_PER_GOLD: 10, // 送貨路程每幾步多 1 金幣
  // 聚落的大小從內容算：村莊放 3～6 間民房、鐵匠工坊、小廣場，城鎮放 8～14 間民房、工坊、神殿或市場。
  // 下面的外框只是排版的工作範圍（最大值）：先在裡面排路、廣場、建築，外牆再貼著它們的外緣蓋，
  // 排完聚落的範圍縮到外牆的外接矩形
  VILLAGE_W: 29,        // 村莊的工作範圍（27×17 實測一成多蓋不齊民房）
  VILLAGE_H: 19,
  VILLAGE_HOUSES: [3, 3, 4, 5, 6], // 村莊蓋幾間民房（人口從大舉遷出到急速發展）
  VILLAGE_LANE: 7,      // 村莊的小巷離中央幾格
  VILLAGE_ARMS: [10, 5], // 村莊的大路從中央往東西、南北各延伸幾格（出入口外的路另外鋪出去）
  VILLAGE_MIN_STEPS: 80, // 新村莊離最近的村莊至少要走幾步（照實際路程算；120 步實測幾乎蓋不出村莊）
  VILLAGE_MAX_NPC: 6,    // 一個村莊最多住幾個村民（不含武器匠）
  TOWN_FIRST_LEVEL: 3,   // 世界等級到這一級，才開始蓋大城鎮（第一座在創出後世界等級達到這一級的那一塊）
  TOWN_GAP: [4, 5],      // 之後每隔 4 或 5 塊世界蓋一座（用那一塊的亂數決定 4 或 5）
  TOWN_W: 45,            // 城鎮的工作範圍
  TOWN_H: 29,
  TOWN_HOUSES: [8, 9, 10, 12, 14], // 城鎮蓋幾間民房
  TOWN_LANE: [13, 9],    // 城鎮的小巷：直的離中央幾格、橫的離中央幾格
  TOWN_ARMS: [18, 10],   // 城鎮的大路從中央往東西、南北各延伸幾格
  TOWN_VILLAGERS: [7, 9], // 城鎮一開始住幾個居民（不含武器匠）
  TOWN_MAX_NPC: 12,      // 城鎮最多住幾個居民
  RUNTIME_EXP: 5,       // 執行時錯誤生出的怪物，經驗值不算在創世門檻裡
  GLITCH_MS: 140,       // 怪物字元跳動的間隔

  // 算力（不顯示給玩家）：冒險者做事產生，分成兩份。
  //   創世力：累積到門檻，創世神就解出下一塊世界（門檻見 game.js 的 createChunk）。
  //   修補力（game.compute）：每隔幾步拿來演算事件、維持世界穩定。
  // 數字都是單人份量（raw）；冒險者產生的算力再乘 PLAYER_COMPUTE_SCALE。
  // 多人時算力是所有冒險者加總，事件跟著變多。
  PLAYER_COMPUTE_SCALE: 4,                // 單人先當成四位玩家的份量，所以冒險者產生的算力乘 4；之後做多人時改回 1（人數自然會加總）
  CREATION_SHARE: 0.5,                    // 冒險者的算力有幾成進創世力，其餘進修補力
  VIRTUAL_REPAIR: 0.5,                    // 回合制下，冒險者每個動作另外附帶的修補力（虛擬算力源，只進修補力、不進創世力；規格預設 1，測試調成 0.5）
  // 移動、出手的份量：規格預設各 1，但這樣光走路就能解出新世界（一塊世界約 130 步），怪物清不完、世界從第 2 塊起就失序；
  // 依四人等效模擬調成 0.15，創世力約六成來自打倒怪物與完成委託（見 DESIGN.md「算力與事件」）
  COMPUTE_PER_MOVE: 0.15,                 // 移動一步
  COMPUTE_PER_ATTACK: 0.15,               // 出手一次
  COMPUTE_PER_GATHER: 0.15,               // 採集一次（跟移動一樣）
  COMPUTE_KILL_SMALL: 3,                  // 打倒小怪物（影響範圍 1～4）
  COMPUTE_KILL_MID: 8,                    // 打倒中型怪物：8＋影響範圍÷2
  COMPUTE_KILL_MID_PER_SCOPE: 0.5,
  COMPUTE_DELIVER: 5,                     // 完成送貨委託：5＋路程÷20
  COMPUTE_DELIVER_STEPS: 20,
  COMPUTE_HUNT: 4,                        // 完成清除委託：4＋每隻 2
  COMPUTE_HUNT_PER: 2,
  EVENT_EVERY: 10,                        // 每移動幾步演算一次
  EVENT_COST: { quest: 6, recompute: 24 }, // 每種事件花多少修補力（地形重算會生出算錯的地面，比較貴）

  // 清除委託：村莊周遭有小怪物時，村民優先請冒險者清掉牠們
  HUNT_RADIUS: 24,                        // 離村莊邊緣幾步以內算「周遭」
  HUNT_MAX: 3,                            // 一個委託最多要清幾隻
  HUNT_EXP_BASE: 10,                      // 獎勵：經驗值 10＋每隻 6，金幣 8＋每隻 5
  HUNT_EXP_PER: 6,
  HUNT_GOLD_BASE: 8,
  HUNT_GOLD_PER: 5,
  COMPUTE_CAP: 45,                        // 修補力存量上限，沒事件可做時不會無限累積（每個動作的修補力約 0.8，跟舊版每步 1 差不多，所以維持 45）
  RECOMPUTE_FLASH_TICKS: 100,             // 地形重算的地方在小地圖上亮幾刻

  // 寶箱：只在創世時放在固定位置，拿了就沒有，不會重生；另外由怪物掉落
  DROP_SMALL_CHANCE: 0.4,                 // 小怪物掉寶箱的機率
  DROP_SMALL_GOLD: [5, 15],               // 小怪物寶箱的金幣
  DROP_GOLD_BASE: 15,                     // 其他怪物一定掉寶箱：15＋影響範圍×2＋0～5
  DROP_GOLD_PER_SCOPE: 2,

  NPC_MOVE_EVERY: 2,                      // 冒險者每走幾步，村民在村莊裡走動一次
  NPC_MOVE_CHANCE: 0.5,                   // 每次輪到時，每個村民走一步的機率（武器匠不走）
  NPC_HOME_CHANCE: 0.1,                   // 在外面走動的村民，每走一步有多少機率起身回家
  NPC_LEAVE_CHANCE: 0.15,                 // 在家的村民，每次輪到時有多少機率出門
  EVENT_GHOST_RATE: 0.25,                 // 新任務指向不存在村民的機率（事件生成器也是粗糙的）

  // 休息：按一次回 1 點生命，算作累積十步的算力；不演算事件，事件照移動步數演算
  REST_HEAL: 1,
  REST_COMPUTE: 4,                        // 休息只進修補力：4×4×0.5＝8，約十步的修補力（0.15×4×0.5＋0.5＝0.8 一步）

  // 怪物行動：冒險者每做一個動作（移動、攻擊、撤退、休息、對話），所有怪物各做一件事（移動一步或攻擊）；戰鬥中世界不暫停
  SIGHT: 8,                               // 會追人的怪物（m.small，事件與侵蝕生的）在幾步以內看得到冒險者就會追
  SIGHT_BLOCK: { '#': 1, '♣': 0.5, '↑': 0.5, '♠': 0.6, 'Γ': 0.3, '▓': 1, 'Θ': 1, 'Π': 0.5, 'Ω': 1, '†': 1, '⌂': 1, '∩': 1, '♦': 1, W: 1, w: 1, '▌': 0.5, 'π': 0.3, '╤': 0.3, '¤': 0.3, '╥': 0.3 }, // 視線經過的地形擋多少，累積到 1 就看不到（樹林兩格才擋住）

  // 時間（參考矮人要塞的刻）：每個動作花幾刻，怪物每 10 刻行動一次
  TICKS_MOVE: 10,                         // 一般地形走一格
  TICKS_HARD: 30,                         // 被怪物的異常扭曲過的地面走一格（怪物多動兩次）
  // 畫面縮放：地圖滿版，縮放改的是每格的像素大小，格數跟著視窗大小與格子大小變（格子越小、看得越多）。
  // 短邊至少 17 格＝四個方向各看 8 格，跟小怪物的視野一樣遠，不讓怪物在畫面外就看到你
  CELL_SIZES: [14, 18, 22, 26, 32, 40], // 每格的像素大小（縮放的檔位）
  CELL_DEFAULT: 2,                      // 預設檔位（CELL_SIZES 的索引）
  CELL_PX: 22,                          // 目前每格的像素大小，由 main.js 依檔位設
  VIEW_MIN: 17,                         // 地圖短邊至少幾格
  CHASE_MEMORY: 3,                        // 看不到之後還會往原方向追幾回合，追丟了就回生成點
  CHASE_LIMIT: 12,                        // 一趟最多追幾步，沒纏上冒險者就回生成點
  FLEE_FAIL: 0.3,                         // 撤退失敗的機率；失敗會挨一下，成功就移到那隻怪物的視野外
  WANDER_CHANCE: 0.3,                     // 每回合徘徊一步的機率
  WANDER_LEASH: 2,                        // 徘徊時離自己的 B 點最多幾步
  CORRUPT_CHANCE: 0.012,                  // 每隻怪物每回合侵蝕周遭的機率（再乘上世界狀態的倍率）
  CORRUPT_RANGE: 20,                      // 離冒險者幾步以內的怪物才會侵蝕
  SMALL_CAP: 20,                          // 安全上限：小怪物達到這個數量，侵蝕就不再生出新的（平常靠合體收斂）
  MERGE_RADIUS: 6,                        // 小怪物彼此在幾步以內算同一群
  MERGE_MIN: 3,                           // 一群至少幾隻才會合體
  MERGE_RATIO: 1.5,                       // 一群的難度評級達到冒險者生命上限的幾倍就合體（再乘上世界狀態的倍率；第二十三版從 1.0 提高到 1.5）
  CORRUPT_SPAWN_PER_TICK: 1,              // 每次演算事件，扭曲的地面最多生出幾隻小怪物

  // 攻防判定（combat.js）：冒險者與怪物共用同一套流程
  HIGH_GROUND: 2,                         // 攻擊方比防守方高 1 階以上，擲骰 +2；低 1 階以上 -2
  OPPORTUNITY_CHANCE: 0.5,                // 從貼著的怪物旁走開，那隻怪物趁機出手的機率
  PLAYER_DODGE: 0.1,                      // 冒險者的閃避、反擊、格擋機率
  PLAYER_COUNTER: 0.1,
  PLAYER_BLOCK: 0.2,
  BLOCK_BASE: 3,                          // 冒險者的格擋值上限＝3＋武器等級×2
  BLOCK_PER_LV: 2,
  BLOCK_REGEN: 0.2,                       // 格擋值每回合回最大值的幾成
  MID_DEF: { dodge: 0.05, block: 0.1, blockMax: 3 }, // 中型怪物的防禦在異常本身的數字上再加這些

  // 世界狀態（stability.js）：整體 BUG 值＝所有怪物的影響範圍總和；兩個分界把世界分成安穩、動盪、失序三級。
  // 以下陣列依序是安穩、動盪、失序
  STATE_CUTS: [250, 460],               // 整體 BUG 值達到第一個數字進入動盪，達到第二個進入失序（世界等級 1 的值，每級再加一成）。依四人等效模擬（世界每 4 個動作走 1 回合、算力不乘 4）調：4 個種子第一次失序在世界等級 4、4、6、沒出現
  STATE_HYST: 0.9,                        // 退回上一級要低於分界的幾成（免得在分界上來回跳、訊息洗版）
  STATE_MAX_SCOPE: [3, 4, 6],             // 事件與侵蝕生出的新錯，影響範圍上限
  STATE_CORRUPT: [1, 1.5, 2],             // 侵蝕頻率倍率
  STATE_ROUGH: [0, 2, 4],                 // 創出新的一塊之後，額外多蓋幾塊氣候印章或高度突變
  STATE_MERGE: [1, 0.8, 0.6],             // 合體門檻倍率
  STATE_RECUR: [0, 0.1, 0.2],             // 每次演算事件，修好的地形錯位或斷崖復發的機率
  STATE_SABOTAGE: [0, 0.1, 0.2],          // 每次演算事件，有東西被弄壞（任務指向不存在的人、寶箱金幣算壞）的機率
  STATE_COMPUTE: [1, 0.75, 0.5],          // 累積修補力的倍率（吃算力，事件變少；創世力不受影響）
  CHAOS_TIME: 2,                          // 失序時，冒險者每個動作花的刻是平常的幾倍（怪物跟著多動，士兵仍只動一次）

  // 世界等級（隱藏，不顯示給玩家）：＝1＋floor((創出的塊數－1)／CHUNKS_PER_WORLD_LEVEL)。
  // 每升一級（以等級 1 為基準，線性加上去）：下面每一項加上對應的比例或數值
  CHUNKS_PER_WORLD_LEVEL: 2,              // 每創出幾塊世界，世界等級加一（規格預設 3；調成 2，失序才落在世界等級 4～5 左右）
  WL_BONUS: {
    HP: 0.2,        // 怪物血量（第二十四版從 0.1 加大：以基準冒險者校準，小怪物約 3 下、中型怪物約 6 下打倒，見 DESIGN.md「世界等級」）
    ATK: 0.1,       // 怪物攻擊力
    DODGE: 0.01,    // 怪物閃避機率
    BLOCK: 0.01,    // 怪物格擋機率
    BLOCK_MAX: 1,   // 怪物格擋值（加數，不是比例）
    REWARD: 0.1,    // 打倒怪物的經驗值與算力
    CORRUPT: 0.1,   // 侵蝕頻率
    SCOPE: 0.1,     // 事件與侵蝕生出的新錯，影響範圍上限
    CUTS: 0.1,      // 世界狀態的分界（STATE_CUTS）
  },

  // 背包、工具與採集（第二十四版）：背包不限格數，同一種東西疊放；工具向武器匠買，買一次就一直有
  TOOL_PRICE: 20,                         // 礦鎬、鐮刀各多少金幣（不看聚落經濟）
  ORE_NODES: [3, 5],                      // 每座礦坑的空地上放幾處礦脈
  HERB_RATE: 0.02,                        // 溫帶森林、針葉林、熱帶雨林裡，每格有藥草的機率
  HERB_BIOMES: ['forest', 'taiga', 'jungle'],
  GATHER_YIELD: [1, 2],                   // 採一次得到幾份
  REGROW_TICKS: 2000,                     // 採完幾刻後長回來
  HERB_HEAL: 0.25,                        // 吃一份藥草回生命上限的幾成（無條件進位）
  ORE_FROM_LV: 5,                         // 武器 Lv5 起改良要礦石：Lv5→6 一顆，之後每級多一顆（金幣照舊）

  // 士兵（只有城鎮有，role 'soldier'）：數值以同世界等級、影響範圍 2 的小怪物為準
  SOLDIER_PER_TOWN: 3,                    // 每座城鎮固定幾位士兵（第二十四版從照人口 1～3 位改成固定 3 位）
  SOLDIER_BASE_SCOPE: 2,                  // 拿影響範圍幾的小怪物當基準
  SOLDIER_HP_MUL: 0.9,                    // 血量乘幾
  SOLDIER_ATK_MINUS: 1,                   // 攻擊力減幾（至少 1）
  SOLDIER_WANDER: 0.5,                    // 在城鎮裡每個動作走一步的機率（不然站著）
  SOLDIER_GATHER_WAIT: 8,                 // 失序出城時，隊長最多等其他士兵幾個動作再往小怪物前進
  SOLDIER_SEARCH: 10000,                  // 找路最多看幾格（城鎮中央到聚落周圍的圈外緣約 35 步；出城繞到另一側要 70 步上下，第二十四版從 5000 加大）
};

// 世界等級每升一級加 per（比例）：等級 1 是 1 倍，等級 3 是 1＋2×per
FE.wlScale = (wl, per) => 1 + per * ((wl || 1) - 1);
// 世界裡有 n 塊區塊時的世界等級（創出的塊數算新生的那一塊）
FE.worldLevelFor = (n) => 1 + Math.floor((Math.max(1, n) - 1) / FE.CONFIG.CHUNKS_PER_WORLD_LEVEL);

// 地形：字元 → 名稱、能不能走、畫面樣式。顏色另外跟著生態區走（style.css 的 b-*）。
// 字元參考矮人要塞用的 CP437 字元表：▲ 是坡（矮人要塞的 ramp），♣ 闊葉樹、↑ 針葉樹、≈ 水。
// 能走的地形一律不用會被誤認成牆的字元；擋路的只有 ≈ 水和 # 巨石。
FE.TERRAIN = {
  '.': { name: '空地', pass: true, cls: 't-plain' },
  '"': { name: '草', pass: true, cls: 't-grass' },
  ',': { name: '灌木', pass: true, cls: 't-grass' },
  '♣': { name: '闊葉樹', pass: true, cls: 't-forest' },
  '↑': { name: '針葉樹', pass: true, cls: 't-forest' },
  '♠': { name: '雨林', pass: true, cls: 't-forest' },
  'Γ': { name: '孤樹', pass: true, cls: 't-forest' },
  ';': { name: '泥沼', pass: true, cls: 't-plain' },
  '*': { name: '冰雪', pass: true, cls: 't-snow' },
  ':': { name: '沙', pass: true, cls: 't-sand' },
  '▲': { name: '山坡', pass: true, cls: 't-mount' },
  '≈': { name: '水', pass: false, cls: 't-water' },
  '#': { name: '巨石', pass: false, cls: 't-rock' },
  // 聚落的外牆：存成 W／w，畫面上照矮人要塞蓋的牆自動接角（石牆雙線 ╔═╗、木牆單線 ┌─┐）
  W: { name: '石牆', pass: false, cls: 't-stonewall' },
  w: { name: '木牆', pass: false, cls: 't-woodwall' },
  // 聚落裡的建築外牆與路：民房與鐵匠工坊 ⌂、神殿 ∩、市場 ♦；門 +（之後要做鎖門）
  '⌂': { name: '房屋的牆', pass: false, cls: 't-house' },
  '∩': { name: '神殿的牆', pass: false, cls: 't-temple' },
  '♦': { name: '市場的牆', pass: false, cls: 't-market' },
  '+': { name: '門', pass: true, cls: 't-door' },
  '·': { name: '小路', pass: true, cls: 't-road' },
  // 家具：先只有符號，還沒有作用；床能走，其他擋路
  '≡': { name: '床', pass: true, cls: 't-bed' },
  'π': { name: '桌子', pass: false, cls: 't-furniture' },
  '▌': { name: '物品櫃', pass: false, cls: 't-furniture' },
  '╤': { name: '工作台', pass: false, cls: 't-furniture' },
  '¤': { name: '祭台', pass: false, cls: 't-furniture' },
  '╥': { name: '市場攤位', pass: false, cls: 't-furniture' },
  // 聚落附近的獨特地貌：法師塔、聖所、礦坑、堡壘是有外框的建築
  '▓': { name: '斷牆', pass: false, cls: 't-ruin' },
  '░': { name: '碎石地', pass: true, cls: 't-ruin' },
  'Π': { name: '立石', pass: false, cls: 't-relic' },
  'Θ': { name: '法師塔的牆', pass: false, cls: 't-relic' },
  '†': { name: '聖所的牆', pass: false, cls: 't-relic' },
  'Ω': { name: '礦坑的牆', pass: false, cls: 't-relic' },
  '‡': { name: '墓碑', pass: true, cls: 't-relic' },
};

// 生態區：參考矮人要塞，由海拔、溫度、雨量決定（world.js 的 classify）。
// paint 決定每格畫成什麼地形字元；rocks 是巨石（擋路）的比例；cold／hot 用來判斷冷熱直接相鄰的錯。
// hit 是冒險者站在這裡出手時擲骰的加減值：開闊的地方看得清楚好出手，樹林、泥沼礙手礙腳。
FE.BIOMES = {
  plain:     { name: '整平的空地', paint: () => '.', rocks: 0, hit: 1 },
  grassland: { name: '草原', paint: (r) => (r() < 0.6 ? '"' : '.'), rocks: 0.02, hit: 2 },
  shrubland: { name: '灌木地', paint: (r) => { const n = r(); return n < 0.5 ? ',' : n < 0.8 ? '"' : '.'; }, rocks: 0.03, hit: 0 },
  forest:    { name: '溫帶森林', paint: (r) => (r() < 0.55 ? '♣' : '"'), rocks: 0.03, hit: -2 },
  taiga:     { name: '針葉林', paint: (r) => (r() < 0.55 ? '↑' : '.'), rocks: 0.04, cold: true, hit: -2 },
  tundra:    { name: '苔原', paint: (r) => (r() < 0.7 ? '.' : ','), rocks: 0.04, cold: true, hit: 1 },
  glacier:   { name: '冰川', paint: () => '*', rocks: 0, cold: true, hit: -1 },
  jungle:    { name: '熱帶雨林', paint: (r) => (r() < 0.65 ? '♠' : '"'), rocks: 0.02, hot: true, hit: -3 },
  savanna:   { name: '莽原', paint: (r) => { const n = r(); return n < 0.45 ? ',' : n < 0.92 ? '.' : 'Γ'; }, rocks: 0.02, hot: true, hit: 2 },
  desert:    { name: '沙漠', paint: (r) => (r() < 0.9 ? ':' : '.'), rocks: 0.04, hot: true, hit: 1 },
  marsh:     { name: '沼澤', paint: (r) => (r() < 0.5 ? ';' : '"'), rocks: 0, hit: -2 },
  swamp:     { name: '濕地', paint: (r) => (r() < 0.45 ? ';' : '♠'), rocks: 0, hit: -3 },
  mountain:  { name: '山地', paint: (r, h) => (h >= 4 || r() < 0.5 ? '▲' : '.'), rocks: 0.08, hit: -1 },
  lake:      { name: '湖', paint: () => '≈', rocks: 0, hit: 0 },
};

// 怪物種族：系統把 BUG 包裝成怪物時，看 B 點所在的環境決定種族（外形字母與名字）；
// 錯誤種類變成牠身上的「異常」，決定抗性、行為與閃爍方式（bugs.js 的 BUG_TYPES）。
// 以下對照是 Claude 的提議，使用者還沒逐項確認，名字與字母可以直接改這裡。
FE.RACES = {
  goblin:     { name: '哥布林', glyph: 'g', biomes: ['grassland', 'shrubland', 'plain'] },
  bugbear:    { name: '熊地精', glyph: 'b', biomes: ['forest'] },
  werewolf:   { name: '狼人', glyph: 'w', biomes: ['taiga'] },
  yeti:       { name: '雪怪', glyph: 'Y', biomes: ['tundra', 'glacier'] },
  lizardfolk: { name: '蜥蜴人', glyph: 'l', biomes: ['jungle'] },
  gnoll:      { name: '豺狼人', glyph: 'n', biomes: ['savanna'] },
  skeleton:   { name: '骷髏', glyph: 's', biomes: ['desert'] },
  troll:      { name: '沼澤巨魔', glyph: 'R', biomes: ['marsh', 'swamp', 'lake'] },
  kobold:     { name: '狗頭人', glyph: 'k', biomes: ['mountain'] },
};
FE.raceFor = (biome) => Object.keys(FE.RACES).find((k) => FE.RACES[k].biomes.includes(biome)) || 'goblin';

// 冷的生態區跟熱的直接相鄰，就是「氣候算錯了」的地形錯位
FE.isClimateConflict = (a, b) => {
  const A = FE.BIOMES[a] || {};
  const B = FE.BIOMES[b] || {};
  return (A.cold && B.hot) || (A.hot && B.cold);
};

// 擲 d20 的五段結果（參考《奇幻探索物語》，判定流程見 combat.js），由高往低比對：
// 暴擊、命中、命中且對方必定反擊（只在冒險者出手時，見 combat.js）、沒命中、失手（失手後防守方還要擲閃避）
FE.ROLL_BANDS = [
  { min: 20, key: 'crit', name: '暴擊' },
  { min: 11, key: 'hit', name: '命中' },
  { min: 6, key: 'hard', name: '命中，對方必定反擊' },
  { min: 2, key: 'miss', name: '沒命中' },
  { min: 1, key: 'fumble', name: '失手' },
];

// 以下是原型用的暫用詞庫
FE.TOWN_NAMES = ['銀橋城', '石冠城', '白塔城', '風語城', '金麥城', '黑鐵城', '晨星城', '霜門城'];
FE.VILLAGE_NAMES = ['石橋村', '鐵杉村', '白霧村', '灰岩村', '長風村', '柳溪村', '赤土村', '雲杉村', '青苔村', '銅鈴村'];
FE.NAMES = ['艾德', '蜜拉', '洛恩', '希雅', '巴頓', '妮可', '托爾', '葵', '歐文', '莉絲', '加隆', '芙蘭', '塞斯', '茉莉', '雷恩', '朵拉'];
// 背包裡的東西：use 是能在背包裡直接用的（只有藥草）；送貨的物品另外用 id 'goods'、名字照委託
FE.BAG_ITEMS = {
  herb: { name: '藥草', use: true },
  ore: { name: '礦石' },
  pick: { name: '礦鎬', tool: true },
  sickle: { name: '鐮刀', tool: true },
};
// 採集點：都可以走過去；拿著對的工具撞上去就採，採完變回普通地面，REGROW_TICKS 刻後長回來
FE.NODES = {
  ore: { name: '礦脈', glyph: '◊', tool: 'pick', item: 'ore', verb: '挖' },
  herb: { name: '藥草', glyph: '♥', tool: 'sickle', item: 'herb', verb: '割' },
};
FE.ITEMS = ['修補符文', '舊地圖', '發光苔蘚', '空白卷軸', '鐵釘', '藥草'];
FE.QUEST_LINES = [
  '{giver}：可以幫我把{item}交給{village}的{target}嗎？',
  '{giver}：{village}的{target}在等這份{item}，路上小心怪物。',
  '{giver}：外面還沒修好，{village}的{target}需要{item}才撐得下去，拜託你了。',
];
FE.IDLE_LINES = [
  '最近地上常冒出亂碼，看久了頭會痛。',
  '聽說冒險者走得越遠、打得越多，邊界外就越快長出新的土地。',
  '雪地旁邊直接是沙漠，這種地方最容易冒出怪物。',
  '有冒險者打倒大型怪物的話，名字會寫進世界裡。',
];
FE.SOLDIER_LINES = [
  '城裡有我們看著，外面的路你自己小心。',
  '世界亂起來的時候，我們才會出城。',
  '別走太遠，累了就回來休息。',
  '怪物進不了城牆外這一圈，放心睡吧。',
];
