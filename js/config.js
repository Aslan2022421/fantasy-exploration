// 全域設定與資料表。所有檔案都掛在 FE 命名空間底下，用一般 <script> 載入，雙擊 index.html 就能玩。
window.FE = window.FE || {};

FE.CONFIG = {
  SAVE_VERSION: 20,     // 規則改到跟舊存檔不相容時加一；讀到舊版本會清掉存檔、歷史紀錄與錯誤報告（20：建角改版（擲 5 項技能、從全部裝備挑）、反擊、逃跑取代撤退與撤離、施法與加護（player.ward、battle.spellCd）；19：時鐘（一天 2,400 刻）、野外短休與村莊長休、生活開支、聚落經濟值、貨幣改銅記帳、採藥與採礦委託、四種委託各接一個、世界裡的人有種族、力竭；18：六個職業、技能合併與穿甲拆三項、起始技能、防具換成十二件、投擲、精通一律要技能 5 級；17：種族與體型、技能照 Dwarf Fortress 重做（經驗值、新技能、等級沒有上限）、升級經驗表、負重改磅數、擴充武器第一批與弩矢；16：武器改用傷害骰與特質、精通、優勢與劣勢、遠程與範圍攻擊、箭矢、地上的武器、盾擊與治療、攻擊速度；2：地形加上高度；3：氣候生態區；4：地形字元改成矮人要塞字元表；5：世界改成二維區塊格；6：聚落標籤與地貌；7：聚落的外形、房屋與小路；8：區塊放大四倍、聚落外牆；9：有外牆與室內的建築、村民的家；10：外牆貼建築、怪物進不了聚落周圍、64×64、回合制圍攻與攻防判定、怪物分級、世界狀態；11：房屋與外牆之間的走道鋪成路，舊世界的走道還是空地；12：創世改看算力、世界等級、士兵；13：背包、工具、採集點、城鎮固定 3 位士兵、怪物血量的世界等級加成加大；14：裝備欄與裝備物件（品質、耐久）、拿掉改良武器與武器等級、重量與負重、城鎮的盔甲匠與工坊、打造與修復、裝備掉落；15：職業、六項屬性與技能、生命與負重上限照職業和屬性算、升級加點）
  // 世界的比例：一塊世界 64×64（第十九版從 32×24 放大四倍成 64×48，第二十一版高度再加到 64）。
  // 按「每塊幾個」算的數字照面積乘 4（第二十一版再乘 4/3），按「走幾步」算的距離照長寬乘 2；每步的算力與事件間隔不變，冒險者身邊的密度跟原本一樣
  CHUNK_W: 64,          // 一塊世界的寬（世界是二維的區塊格，新的一塊長在離冒險者最近的邊界上）
  CHUNK_H: 64,          // 一塊世界的高
  MAX_HEIGHT: 4,        // 地形高度 0～4；相鄰兩格差 1 是坡可以走，差 2 以上是斷崖
  STAMPS: [5, 16],      // 每塊世界蓋幾塊氣候印章（怪物的來源之一）
  SPIKES: [16, 27],     // 每塊世界有幾小塊地高度突變（斷崖的來源）
  CHESTS: [1, 3],       // 每處地貌裡創世時放幾個寶箱（第二十七版起只放在地貌裡，原本每塊世界隨處放 5～16 個）
  CHEST_LANDMARKS: ['fort', 'stones', 'graves', 'tower', 'shrine', 'mine'], // 放寶箱的地貌；古老森林（grove）不放
  // 聚落周圍的圈：從外牆（聚落的 mask 格子）量起的切比雪夫距離，寬度看聚落種類。
  // 圈裡不生怪物、不侵蝕、不重算地形，怪物也不能踏進來（追到圈邊就停）。要塞與城市還沒有，先記數字
  SETTLE_BUFFER: { village: 8, town: 12, fortress: 14, city: 16 },
  VIEW_W: 21,           // 畫面一次顯示幾格寬（奇數，冒險者才會剛好在正中央）；由 render.js 依視窗大小與縮放算出來
  VIEW_H: 21,           // 畫面一次顯示幾格高（奇數）
  MINIMAP_W: 128,       // 小地圖顯示冒險者附近幾格寬
  MINIMAP_H: 96,        // 小地圖顯示冒險者附近幾格高
  MID_SCOPE: 5,         // 影響範圍 1～4 是小怪物，5 以上是中型怪物（創世時的大錯、合體生出的都是）
  BOSS_SCOPE: 12,       // 影響範圍 12 以上才算大型怪物；大怪物只來自世界級事件，留到第 2 階段，這一版不會生出來
  // 升級的累計經驗值（第二十九版，《D&D》第五版經驗表 ÷10）：LEVEL_EXP[n] 是升到第 n 級要的累計經驗值，最高 20 級
  LEVEL_EXP: [0, 0, 30, 90, 270, 650, 1400, 2300, 3400, 4800, 6400, 8500, 10000, 12000, 14000, 16500, 19500, 22500, 26500, 30500, 35500],
  LEVEL_MAX: 20,        // 角色等級上限（技能等級沒有上限）
  // 角色（第二十六版）：職業、六項屬性、技能。職業的數字見下面的 FE.CLASSES，屬性與技能的名單見 FE.ATTRS、FE.SKILLS
  // 生命上限＝(職業基礎＋體質)×HP_MULT 無條件捨去，再加 (等級－1)×(職業基礎÷2＋體質修正值)；負重上限＝力量值×15 磅（js/char.js）
  HP_MULT: 1.5,         // 起始生命上限＝(職業基礎＋體質)×這個數，無條件捨去
  ATTR_CAP: 18,         // 屬性加點的上限
  LEVEL_POINTS: 1,      // 升到加點的那幾級時可以加幾點屬性
  LEVEL_POINT_AT: [4, 8, 12, 16, 19], // 只有升到這幾級才加 1 點屬性（《D&D》），其他等級升級只加生命
  DEX_DODGE: 0.02,      // 敏捷每點修正值，閃避機率 +2%
  MOVE_TICKS_MIN: 8,    // 敏捷讓移動變快，一步最少幾刻（第二十九版）
  CHA_PRICE: 0.05,      // 魅力每點修正值：向工匠買東西（含修復費、打造工錢）−5%，賣東西 +5%，委託與任務的金幣獎勵 +5%
  // 技能照 Dwarf Fortress（第二十九版）：升到第 N 級要 400＋100N 點經驗，等級沒有上限，15 級以上都是傳奇
  SKILL_NEED_BASE: 400, // 升到第 N 級要 SKILL_NEED_BASE＋SKILL_NEED_STEP×N 點經驗（1 級要 500）
  SKILL_NEED_STEP: 100,
  SKILL_EXP_HIT: 10,    // 出手命中一次的經驗（沒命中 5 點）
  SKILL_EXP_MISS: 5,
  SKILL_EXP_DODGE: 10,  // 閃開一次
  SKILL_EXP_BLOCK: 10,  // 格擋成功一次
  SKILL_EXP_ARMOR: 10,  // 穿著防具被打中、而且防具擋下了傷害
  SKILL_INT_STEP: 0.1,  // 每點智力修正值，技能經驗 ±10%
  SKILL_INT_MIN: 0.5,   // 技能經驗倍率最少 ×0.5
  SKILL_LEGEND: 15,     // 15 級起是傳奇（顯示「傳奇 +N」）
  SKILL_HIT_EVERY: 5,   // 武器技能每幾級，出手 d20 +1
  SKILL_DMG_EVERY: 3,   // 武器技能每幾級，傷害 +1
  FIGHT_HIT_EVERY: 10,  // 格鬥（所有近戰出手都練）每幾級，近戰出手 d20 +1，跟武器技能疊加
  SKILL_DODGE: 0.01,    // 閃避技能每級，閃避機率 +1%
  SKILL_BLOCK: 0.02,    // 盾牌使用每級，格擋機率 +2%
  // 穿甲技能減輕身上防具的重量（照 Dwarf Fortress 的表，依技能等級 0、1、2⋯⋯15 以上）
  ARMOR_WEIGHT_MUL: [1, 1, 0.8125, 0.75, 0.6875, 0.625, 0.5625, 0.5, 0.4375, 0.375, 0.3125, 0.25, 0.1875, 0.125, 0.0625, 0],
  // 閃避的敏捷加成看防具類別（第二十九版追加）：輕甲與無甲照加、負的照扣；中甲最多 +MEDIUM_DEX_CAP 點修正值（負的照扣）；重甲不加也不扣
  MEDIUM_DEX_CAP: 2,
  STR_REQ_TICKS: 15,    // 力量不到防具的需求，走一步花幾刻（跟被扭曲的地面、超重取最大的）
  THROW_RANGE: [4, 12], // 投擲的正常射程與最遠射程（所有武器一律，再加感知修正值）
  THROW_JUNK_DIE: [1, 4], // 丟沒有投擲特質的武器：臨時武器的傷害骰（鈍擊，加力量修正值）；弓、輕弩只有 1 點
  LIGHT_DIE: [1, 8],    // 牧師的神聖之光：傷害骰（神聖，加感知修正值）
  BARE_DMG: 1,          // 徒手（主手空著）固定造成幾點鈍擊傷害（再加力量修正值，最少 1）；武器的傷害骰見 FE.GEAR
  // 貨幣（第三十版）：1 金＝10 銀＝100 銅，內部一律用銅記帳。下面的價錢、委託、寶箱數字的單位都是「銀」（原本的「金幣」，數值不動），用的時候乘 SILVER 換成銅
  SILVER: 10,           // 1 銀＝幾銅
  GOLD: 100,            // 1 金＝幾銅
  QUEST_EXP: 15,       // 一個任務的基本經驗值
  QUEST_GOLD: 10,       // 一個任務的基本金錢（銀；採藥、採礦委託的基礎也用這個）
  QUEST_STEPS_PER_EXP: 8,   // 送貨路程每幾步多 1 經驗值（路程變兩倍，獎勵不跟著翻倍）
  QUEST_STEPS_PER_GOLD: 10, // 送貨路程每幾步多 1 銀
  // 聚落的大小從內容算：村莊放 3～6 間民房、鐵匠工坊、小廣場，城鎮放 8～14 間民房、工坊、神殿或市場。
  // 下面的外框只是排版的工作範圍（最大值）：先在裡面排路、廣場、建築，外牆再貼著它們的外緣蓋，
  // 排完聚落的範圍縮到外牆的外接矩形
  VILLAGE_W: 29,        // 村莊的工作範圍（27×17 實測一成多蓋不齊民房）
  VILLAGE_H: 19,
  VILLAGE_HOUSES: [3, 3, 4, 5, 6], // 村莊蓋幾間民房（人口從大舉遷出到急速發展）
  VILLAGE_LANE: 7,      // 村莊的小巷離中央幾格
  VILLAGE_ARMS: [10, 5], // 村莊的大路從中央往東西、南北各延伸幾格（出入口外的路另外鋪出去）
  VILLAGE_MIN_STEPS: 80, // 新村莊離最近的村莊至少要走幾步（照實際路程算；120 步實測幾乎蓋不出村莊）
  VILLAGE_MAX_NPC: 6,    // 一個村莊最多住幾個村民（不含工匠）
  TOWN_FIRST_LEVEL: 3,   // 世界等級到這一級，才開始蓋大城鎮（第一座在創出後世界等級達到這一級的那一塊）
  TOWN_GAP: [4, 5],      // 之後每隔 4 或 5 塊世界蓋一座（用那一塊的亂數決定 4 或 5）
  TOWN_W: 45,            // 城鎮的工作範圍
  TOWN_H: 29,
  TOWN_HOUSES: [8, 9, 10, 12, 14], // 城鎮蓋幾間民房
  TOWN_LANE: [13, 9],    // 城鎮的小巷：直的離中央幾格、橫的離中央幾格
  TOWN_ARMS: [18, 10],   // 城鎮的大路從中央往東西、南北各延伸幾格
  TOWN_VILLAGERS: [7, 9], // 城鎮一開始住幾個居民（不含工匠）
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
  EVENT_TICKS: 100,                       // 每幾刻演算一次事件（第三十版：一小時；原本是每移動 10 步）
  EVENT_COST: { quest: 6, recompute: 24 }, // 每種事件花多少修補力（地形重算會生出算錯的地面，比較貴）
  // 採藥、採礦委託（第三十版，由事件生出，不算進創世門檻）：帶幾份藥草或幾顆礦石交給委託人
  GATHER_QUEST: {
    herb: { n: [5, 10], compute: 3, computePer: 0.5, value: 2 },  // 5～10 份藥草；算力 3＋每份 0.5；藥草一份算 2 銀（藥草不能賣，價錢是 Claude 定的）
    ore: { n: [3, 6], compute: 3, computePer: 1, value: 5 },      // 3～6 顆礦石；算力 3＋每顆 1；礦石一顆算 5 銀（跟賣給工匠的價錢一樣）
  },
  GATHER_QUEST_EXP_PER: 1,                // 採藥、採礦委託的經驗值＝QUEST_EXP＋每份 1（Claude 定的）
  GATHER_QUEST_CHANCE: 0.5,               // 沒發清除委託時，發採藥或採礦委託（各一半）的機率；其餘發送貨委託

  // 清除委託：村莊周遭有小怪物時，村民優先請冒險者清掉牠們
  HUNT_RADIUS: 24,                        // 離村莊邊緣幾步以內算「周遭」
  HUNT_MAX: 3,                            // 一個委託最多要清幾隻
  HUNT_EXP_BASE: 10,                      // 獎勵：經驗值 10＋每隻 6，錢 8 銀＋每隻 5 銀
  HUNT_EXP_PER: 6,
  HUNT_GOLD_BASE: 8,
  HUNT_GOLD_PER: 5,
  COMPUTE_CAP: 45,                        // 修補力存量上限，沒事件可做時不會無限累積（每個動作的修補力約 0.8，跟舊版每步 1 差不多，所以維持 45）
  RECOMPUTE_FLASH_TICKS: 100,             // 地形重算的地方在小地圖上亮幾刻

  // 寶箱：只在創世時放在固定位置，拿了就沒有，不會重生；另外由怪物掉落
  DROP_SMALL_CHANCE: 0.2,                 // 小怪物（會追人的 m.small）掉寶箱的機率（第二十五版再試玩後從 0.4 降）
  DROP_BIG_CHANCE: 0.5,                   // 其他怪物（創世時的、合體生出的中型怪物）掉寶箱的機率（原本必掉）
  CHEST_GOLD_MUL: 0.5,                    // 所有寶箱的金幣乘這個數（創世時放的與怪物掉的都是；第二十五版試玩金幣太多，減半）
  DROP_SMALL_GOLD: [5, 15],               // 小怪物寶箱的金幣（乘 CHEST_GOLD_MUL 之前）
  DROP_GOLD_BASE: 15,                     // 其他怪物掉的寶箱：15＋影響範圍×2＋0～5（再乘 CHEST_GOLD_MUL）
  DROP_GOLD_PER_SCOPE: 2,

  NPC_MOVE_EVERY: 2,                      // 冒險者每走幾步，村民在村莊裡走動一次
  NPC_MOVE_CHANCE: 0.5,                   // 每次輪到時，每個村民走一步的機率（工匠不走）
  NPC_HOME_CHANCE: 0.1,                   // 在外面走動的村民，每走一步有多少機率起身回家
  NPC_LEAVE_CHANCE: 0.15,                 // 在家的村民，每次輪到時有多少機率出門

  // 時鐘（第三十版）：一刻＝36 秒，一小時＝100 刻，一天＝2,400 刻；怪物、士兵、事件都照這個時鐘（怪物與士兵每 10 刻動一次，事件每 100 刻一次）
  HOUR_TICKS: 100,
  DAY_TICKS: 2400,
  // 休息（第三十版）：野外短休 1 小時，回 1d10＋體質修正值，不花錢；聚落裡長休 8 小時，生命回滿，付生活開支。
  // 休息時世界同步跑（短休 10 回合、長休 80 回合）；短休途中有怪物貼上來就被打斷，沒回生命
  SHORT_REST_TICKS: 100,
  LONG_REST_TICKS: 800,
  SHORT_REST_DIE: [1, 10],
  REST_COMPUTE: 4,                        // 休息一次只進修補力（4×4×0.5＝8，約十步的修補力）
  // 生活開支（依聚落的經濟標籤：荒蕪、貧窮、普通、繁盛、富裕；富裕規格沒定，照繁盛）：長休付幾銀、身上裝備的耐久回幾成、這個聚落的委託獎勵加幾成
  LIVING_COST: [3, 6, 15, 30, 30],
  LIVING_REPAIR: [0, 0.03, 0.05, 0.1, 0.1],
  LIVING_QUEST: [0, 0, 0.05, 0.1, 0.1],
  // 委託的金錢照委託人聚落的經濟標籤乘這個倍率（荒蕪、貧窮、普通、繁盛、富裕）
  QUEST_ECON: [0.8, 0.9, 1, 1.2, 1.2],
  // 聚落的經濟值（不顯示）：0～100，每 20 一段對應一個經濟標籤；初始值落在原本標籤那一段的中間
  ECON_MAX: 100,
  ECON_STEP: 20,
  ECON_PER_SPEND: 10,                     // 在這個聚落每花幾銀，經濟值 +1（買、修、打造、長休）
  ECON_QUEST: 3,                          // 完成這個聚落的委託，經濟值 +3
  ECON_MONSTER: 1,                        // 每天：聚落 24 步內每有 1 隻怪物，經濟值 −1（範圍同 HUNT_RADIUS）
  SPEND_REPAIR: 20,                       // 花掉的錢每幾銀換 1 點修補力（單人份量，只進修補力、不進創世力）
  // 力竭（第三十版，《D&D》2024 Exhaustion 的雛形）：連續一整天沒有長休 +1 級，長休一次 −1 級；6 級倒下（在聚落醒來，降到 5 級再照長休 −1）
  EXHAUST_MAX: 6,
  EXHAUST_D20: 2,                         // 每級，冒險者出手的 d20 −2
  EXHAUST_FT: 5,                          // 每級，速度少幾呎（《D&D》2024）：基本 30 呎，走一步的刻＝原本 × 30 ÷（30 − 5×級數），1 級 ×1.2、3 級 ×2、5 級 ×6
  BASE_SPEED_FT: 30,
  WEAR_TIERS: [[0.5, 1, 'x'], [0.25, 2, 'X']], // 耐久低於最大值的這個比例：武器傷害、防具減傷各 −N，名稱兩邊加這個符號（參考 DF 的磨損標記）；由寬到嚴
  // 世界裡的人（村民、工匠、士兵）的種族：人類 70%、矮人 15%、精靈 15%（第三十版，暫時不影響行為）
  NPC_RACES: [['human', 0.7], ['dwarf', 0.15], ['elf', 0.15]],

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
  // 逃跑（第三十一版，取代撤退與撤離）：成功率＝FLEE_BASE＋敏捷修正值×FLEE_DEX，貼身的怪物每多 1 隻 −FLEE_SURROUND，介於 FLEE_MIN～FLEE_MAX；
  // 成功就直接移到離所有怪物 2 格以上、走得到的地方，最多走 2＋敏捷修正值格（FLEE_STEPS 之間）
  FLEE_BASE: 0.8,
  FLEE_DEX: 0.05,
  FLEE_SURROUND: 0.15,
  FLEE_MIN: 0.1,
  FLEE_MAX: 0.95,
  FLEE_STEPS: [2, 5],
  WANDER_CHANCE: 0.3,                     // 每回合徘徊一步的機率
  WANDER_LEASH: 2,                        // 徘徊時離自己的 B 點最多幾步
  CORRUPT_CHANCE: 0.019,                  // 每隻怪物每回合侵蝕周遭的機率（再乘上世界狀態的倍率）。第三十版照新時鐘校準：長休一晚（80 回合）每隻附近的怪物量到 1.35 次（原本 0.012 量到 0.88 次；圈邊的怪物有些格子不能侵蝕，所以比 80×機率少一點）
  CORRUPT_RANGE: 20,                      // 離冒險者幾步以內的怪物才會侵蝕
  SMALL_CAP: 20,                          // 安全上限：小怪物達到這個數量，侵蝕就不再生出新的（平常靠合體收斂）
  MERGE_RADIUS: 6,                        // 小怪物彼此在幾步以內算同一群
  MERGE_MIN: 3,                           // 一群至少幾隻才會合體
  MERGE_RATIO: 1.5,                       // 一群的難度評級達到冒險者生命上限的幾倍就合體（再乘上世界狀態的倍率；第二十三版從 1.0 提高到 1.5）
  CORRUPT_SPAWN_PER_TICK: 1,              // 每次演算事件，扭曲的地面最多生出幾隻小怪物

  // 攻防判定（combat.js）：冒險者與怪物共用同一套流程
  HIGH_GROUND: 2,                         // 攻擊方比防守方高 1 階以上，擲骰 +2；低 1 階以上 -2
  OPPORTUNITY_CHANCE: 0.5,                // 從貼著的怪物旁走開，那隻怪物趁機出手的機率
  PLAYER_DODGE: 0.1,                      // 冒險者的閃避、反擊機率（格擋機率與格擋值看盾牌，沒拿盾牌是 0；見 FE.GEAR.shield）
  // 冒險者的反擊（第三十一版）：機率是各來源相加，最多 50%；傷害是手上各來源的傷害相加（固定值，照技能慢慢加，傳奇時 ×1.5）。
  // 防具：那一類甲的技能每級加（傳奇時輕甲 15%、中甲 7.5%、重甲 3.75%），練過（1 級以上）才再加敏捷修正值每點 1%（照閃避的上限：中甲最多 +2、重甲不加）；
  // 重型武器：武器技能每級 0.8%（傳奇 12%）；盾牌：盾牌使用每級 7/15%（傳奇 7%）；兩者再加品質（清除等級每級 1%）。全部疊滿剛好 50%
  COUNTER_ARMOR: { light: 0.15, medium: 0.075, heavy: 0.0375 },
  COUNTER_HEAVY: 0.12,
  COUNTER_SHIELD: 0.07,
  COUNTER_CLEAR: 0.01,
  COUNTER_DEX: 0.01,
  COUNTER_MAX: 0.5,
  COUNTER_DMG: { heavy: 6, normal: 4, light: 3, shield: 3 }, // 主手武器的類別（遠程武器、徒手算輕型）＋盾牌
  COUNTER_DMG_LEGEND: 0.5,                // 技能到傳奇時反擊傷害多 50%（照等級線性加，四捨五入）
  // 戰鬥（第二十八版）：傷害骰、特質、精通、優勢與劣勢、遠程與範圍、速度。武器的資料見下面的 FE.GEAR
  HEAVY_MIN: 13,                          // 重型武器：近戰力量、遠程敏捷不到這個數，出手有劣勢
  REACH: 2,                               // 觸及：旁邊沒有目標時，打上下左右直線幾格外的目標（中間要是空格）
  CRIT_WIS: 2,                            // 感知修正值到這個數以上，擲出 19 也算暴擊（短刀再擴大 1）
  TOPPLE_BASE: 0.3,                       // 失衡：命中後讓目標倒地的機率＝這個數＋那次出手用的屬性修正值×TOPPLE_PER
  TOPPLE_PER: 0.05,
  PUSH_DIST: 2,                           // 推擊：命中後把目標直線推離幾格（擋住就停，大型怪物推不動）
  ATTACK_TICKS: { light: 8, normal: 10, heavy: 12 }, // 攻擊動作花幾刻（輕型、一般、重型武器），再減敏捷修正值
  ATTACK_TICKS_MIN: 6,                    // 攻擊動作最少幾刻（防具與超重多花的刻另外疊加）
  DUAL_TICKS: 5,                          // 雙持的動作沒有迅切時多花幾刻
  SLOW_TURNS: 1,                          // 緩速：命中且造成傷害後，目標下一次移動多花 10 刻＝怪物 10 刻動一次，所以牠下一次移動晚一回合
  DEEP_COOLDOWN: 3,                       // 重擊用完冷卻幾回合
  BASH_DIE: [1, 4],                       // 戰士盾擊的傷害骰（鈍擊，加力量修正值）
  OFF_CLUMSY_DIE: [1, 4],                 // 副手拿非輕型武器時那一下的傷害骰（另外有劣勢）；之後定好單手雙手或有雙持技能再放回
  BOW_MELEE_DIE: [1, 4],                 // 拿弓近戰打人的傷害骰（鈍擊，加力量修正值；當臨時武器，沒有精通、不算技能）
  HOLY_DIE: [1, 8],                       // 聖騎士：每個動作第一下命中時，目標多受的神聖傷害
  HEAL_DIE: [1, 8],                       // 牧師、聖騎士治療：回 1d8＋修正值（牧師加感知、聖騎士加魅力，最少 1），只治自己
  HEAL_COOLDOWN: 3,                       // 治療用完冷卻幾回合
  SPELL_DIE: [1, 6],                      // 法師拿法杖按 F 的範圍魔攻：傷害骰（魔法，加智力修正值）
  SPELL_RANGE: [5, 20],                   // 範圍魔攻的正常射程與最遠射程（規格沒寫，先照弓箭；再加感知修正值）
  SPELL_RADIUS: [1, 2],                   // 打目標與周圍幾格的怪物：平常 1 格，智力修正值到 SPELL_BIG_INT 起 2 格
  SPELL_BIG_INT: 3,
  ARROW_BACK: 0.5,                        // 目標倒下或冒險者脫離戰鬥時，自動撿回用掉的箭的幾成（捨去）
  BLOCK_REGEN: 0.2,                      // 格擋值每回合回最大值的幾成
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
  SMALL_HP_MUL: 1.5,                      // 小怪物血量倍率（第二十六版以戰士校準）
  MID_HP_MUL: 1.2,                        // 中型以上怪物血量倍率
  CHUNKS_PER_WORLD_LEVEL: 2,             // 每創出幾塊世界，世界等級加一（規格預設 3；調成 2，失序才落在世界等級 4～5 左右）
  WL_BONUS: {
    HP: 0.3,        // 怪物血量（第二十四版 0.1→0.2；第二十六版以戰士校準再加到 0.3：技能與加點讓傷害成長，小怪物約 3 下、中型怪物約 6 下打倒，見 DESIGN.md「世界等級」）
    ATK: 0.1,       // 怪物攻擊力
    DODGE: 0.01,    // 怪物閃避機率
    BLOCK: 0.01,    // 怪物格擋機率
    BLOCK_MAX: 1,   // 怪物格擋值（加數，不是比例）
    REWARD: 0.1,    // 打倒怪物的經驗值與算力
    CORRUPT: 0.1,   // 侵蝕頻率
    SCOPE: 0.1,     // 事件與侵蝕生出的新錯，影響範圍上限
    CUTS: 0.1,      // 世界狀態的分界（STATE_CUTS）
  },

  // 背包、工具與採集（第二十四版）：背包不限格數，同一種東西疊放；工具向鐵匠或武器匠買
  TOOL_PRICE: 20,                         // 礦鎬、鐮刀各多少銀（不看聚落經濟）
  ORE_NODES: [3, 5],                      // 每座礦坑的空地上放幾處礦脈
  HERB_RATE: 0.02,                        // 溫帶森林、針葉林、熱帶雨林裡，每格有藥草的機率
  HERB_BIOMES: ['forest', 'taiga', 'jungle'],
  GATHER_YIELD: [1, 2],                   // 採一次得到幾份
  REGROW_TICKS: 2000,                     // 採完幾刻後長回來
  HERB_HEAL: 0.25,                        // 吃一份藥草回生命上限的幾成（無條件進位）

  // 裝備與物品（第二十五版）。裝備的數字（攻擊力、減傷、重量、價錢、耐久）見下面的 FE.GEAR，品質見 FE.QUALITIES
  // 負重（第二十九版，《D&D》2024 的磅數）：能背＝力量值×15 磅，推拖上限＝力量值×30 磅，範圍內沒有減值；
  // 超過能背：移動一步 60 刻；超過推拖上限：不能移動（還能丟東西）
  CARRY_PER_STR: 15,
  PUSH_PER_STR: 30,
  OVER_MOVE_TICKS: 60,
  ORE_PRICE: 5,                           // 礦石賣給工匠，一顆多少銀
  REPAIR_RATE: 1,                         // 修復費＝修回耐久佔上限的比例×原價×這個數×經濟倍率（至少 1）
  SELL_RATE: 0.5,                         // 賣回裝備＝原價（含品質）×這個數×剩餘耐久比例
  CRAFT_FEE_RATE: 0.5,                    // 打造的工錢＝原價的幾成（乘經濟倍率）
  WARN_DUR: 0.2,                          // 耐久剩這麼多以下，訊息提醒一次
  DROP_MID_GEAR: 0.1,                    // 創世時的中型怪物與合體生出的中型怪物，打倒時多掉一件裝備的機率（品質做工好～優秀）
  CHEST_GEAR: 0.1,                      // 寶箱多開出一件裝備的機率（品質普通～傑作）
  CRAFT_RANGE: { village: [0, 2], town: [1, 3] }, // 打造的品質範圍（QUALITIES 的索引）：村莊鐵匠普通～精良，城鎮武器匠與盔甲匠做工好～優秀
  REPAIR_ALL: { village: true, town: true },      // 修復：村莊的鐵匠、城鎮的武器匠與盔甲匠都一次修到完整（false 是只修回損失的一半）

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
// 錢（內部用銅記帳）的寫法：「3 金 5 銀 2 銅」，零的省略；一毛都沒有寫「0 銅」
FE.money = (copper) => {
  const C = FE.CONFIG;
  const n = Math.max(0, Math.round(copper || 0));
  const g = Math.floor(n / C.GOLD);
  const s = Math.floor((n % C.GOLD) / C.SILVER);
  const c = n % C.SILVER;
  const parts = [g ? `${g} 金` : '', s ? `${s} 銀` : '', c ? `${c} 銅` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 銅';
};
// 委託的四種（第三十版）：每種同時只能接一個；右側欄照這個順序每種一行
FE.JOB_KINDS = ['hunt', 'deliver', 'herb', 'ore'];
FE.JOB_NAMES = { hunt: '清除', deliver: '送貨', herb: '採藥', ore: '採礦' };
// 遊戲裡的時間：第幾天幾時（第 1 天 0 時開始；一小時 100 刻、一天 2,400 刻）
FE.clockText = (ticks) => {
  const C = FE.CONFIG;
  const t = Math.max(0, ticks || 0);
  return `第 ${Math.floor(t / C.DAY_TICKS) + 1} 天 ${Math.floor((t % C.DAY_TICKS) / C.HOUR_TICKS)} 時`;
};
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
// 背包裡疊放的東西：use 是能在背包裡直接用的（只有藥草）；weight 是一份的重量，單位磅（有 bundle 的是一捆的重量）；送貨的物品另外用 id 'goods'、名字照委託（重量 5）。
// 箭矢（第二十八版開放）、弩矢（第二十九版）：一捆 20 支，n 是支數；分品質（背包裡同品質的疊在一起，記在 q），向工匠買、寶箱與怪物也會掉一捆
FE.BAG_ITEMS = {
  herb: { name: '藥草', use: true, weight: 0.5 },
  ore: { name: '礦石', weight: 10 },
  goods: { name: '送貨的東西', weight: 5 },
  arrow: { name: '箭矢', weight: 1, bundle: 20 },
  bolt: { name: '弩矢', weight: 1.5, bundle: 20 },
};
// 品質（參考矮人要塞的物品品質）：value 價值倍率；hit 武器命中 d20 加值；armor 防具減傷與盾牌格擋值倍率（乘完四捨五入）；
// pierce 穿甲比例：穿刺傷害無視防守方這個比例的物理減傷（無條件捨去；箭看箭矢的品質）；clear 清除等級（抗性門檻看它）；
// sym 畫在名字兩邊的符號；weight 隨機品質時的相對機率（每高一級減半，各範圍用 FE.Gear.rollQuality 算）。傳說物（索引 6）有獨有的名字，本版不會生出
FE.QUALITIES = [
  { name: '普通', sym: '', value: 1, hit: 0, armor: 1, pierce: 0, clear: 0 },
  { name: '做工好', sym: '-', value: 1.1, hit: 1, armor: 1.2, pierce: 0.1, clear: 1 },
  { name: '精良', sym: '+', value: 1.2, hit: 2, armor: 1.4, pierce: 0.2, clear: 2 },
  { name: '優秀', sym: '*', value: 1.333, hit: 3, armor: 1.6, pierce: 0.3, clear: 3 },
  { name: '卓越', sym: '≡', value: 1.5, hit: 4, armor: 1.8, pierce: 0.4, clear: 4 },
  { name: '傑作', sym: '☼', value: 2, hit: 5, armor: 2, pierce: 0.5, clear: 5 },
  { name: '傳說物', sym: '', value: 20, hit: 8, armor: 3, pierce: 0.5, clear: 6 },
];
// 裝備與工具（cat：weapon 武器、ammo 彈藥（箭矢，放在背包裡疊放）、armor 防具、shield 盾牌、tool 工具）。
// 武器（第二十八版）：die 傷害骰 [顆數, 面數]、type 傷害種類（FE.DMG_TYPES）、mastery 精通（FE.MASTERIES）；
// 特質（標籤，規則照標籤走，名字見 FE.WEAPON_TAGS）：versatile 可雙手（副手空著時改用這個面數）、heavy 重型、light 輕型（副手只能拿輕型）、
// finesse 靈巧、reach 觸及、twoHand 雙手、thrown 投擲 [正常射程, 最遠射程]、ammo 彈藥（要箭矢）、range 射程 [正常, 最遠]、loading 裝填（只建標籤，現有武器都沒有）；
// 防具 phys／magic 物理／魔法的固定減傷（扣完至少吃 1 點）、ticks 每個動作多花幾刻、dodge 閃避加減；
// 盾牌 block 格擋機率、value 格擋值；weight 重量，單位磅（箭矢、弩矢是一捆）；price 普通品質的原價（箭矢、弩矢是一捆）；ore 打造要幾顆礦石（沒寫的不能打造）；dur 耐久；
// sold 商店有沒有賣（魔法衣袍只從掉落來，price 是賣回與修復用的暫定值）；drop 寶箱與怪物會不會掉。
// 第二十九版：skill 這把武器練哪一項技能（FE.SKILLS）、meleeSkill 拿來近戰時練哪一項（弓、弩）、
// grip [能拿, 能單手]：冒險者體型（種族與身高、體格決定）不到「能拿」就拿不起來，到「能單手」可以單手拿（配盾、雙持），
// 兩個門檻之間只能雙手拿（副手要空著）；弓、輕弩射擊一律雙手（twoHand）。ammo 是用哪種彈藥（arrow 箭矢、bolt 弩矢）
FE.GEAR = {
  sword: { cat: 'weapon', name: '長劍', die: [1, 8], type: 'slash', versatile: 10, mastery: 'sap', skill: 'sword', grip: [52500, 57500], weight: 3, price: 30, ore: 3, dur: 200, sold: true, drop: true },
  spear: { cat: 'weapon', name: '長槍', die: [1, 10], type: 'pierce', heavy: true, reach: true, mastery: 'push', skill: 'spear', grip: [62500, 77500], weight: 18, price: 25, ore: 3, dur: 200, sold: true, drop: true },
  shortspear: { cat: 'weapon', name: '短矛', die: [1, 6], type: 'pierce', thrown: [4, 12], versatile: 8, mastery: 'sap', skill: 'spear', grip: [5000, 47500], weight: 3, price: 20, ore: 3, dur: 200, sold: true, drop: true },
  dagger: { cat: 'weapon', name: '短刀', die: [1, 4], type: 'pierce', finesse: true, light: true, thrown: [4, 12], mastery: 'nick', skill: 'knife', grip: [5000, 27500], weight: 1, price: 15, ore: 3, dur: 200, sold: true, drop: true },
  bow: { cat: 'weapon', name: '弓箭', die: [1, 6], type: 'pierce', ammo: 'arrow', range: [5, 20], twoHand: true, mastery: 'vex', skill: 'bow', meleeSkill: 'sword', grip: [15000, 0], weight: 2, price: 30, dur: 200, sold: true, drop: true },
  staff: { cat: 'weapon', name: '法杖', die: [1, 6], type: 'blunt', versatile: 8, mastery: 'topple', skill: 'staff', grip: [5000, 47500], weight: 4, price: 30, dur: 200, sold: true, drop: true },
  // 第二十九版：擴充武器第一批
  shortsword: { cat: 'weapon', name: '短劍', die: [1, 6], type: 'pierce', finesse: true, light: true, mastery: 'vex', skill: 'sword', grip: [32500, 37500], weight: 2, price: 20, ore: 3, dur: 200, sold: true, drop: true },
  waraxe: { cat: 'weapon', name: '戰斧', die: [1, 8], type: 'slash', versatile: 10, mastery: 'topple', skill: 'axe', grip: [42500, 47500], weight: 4, price: 25, ore: 3, dur: 200, sold: true, drop: true },
  greataxe: { cat: 'weapon', name: '巨斧', die: [1, 12], type: 'slash', heavy: true, mastery: 'cleave', skill: 'axe', grip: [62500, 77500], weight: 7, price: 45, ore: 5, dur: 200, sold: true, drop: true },
  greatsword: { cat: 'weapon', name: '巨劍', die: [2, 6], type: 'slash', heavy: true, mastery: 'graze', skill: 'sword', grip: [62500, 77500], weight: 6, price: 50, ore: 5, dur: 200, sold: true, drop: true },
  club: { cat: 'weapon', name: '硬頭錘', die: [1, 6], type: 'blunt', mastery: 'sap', skill: 'mace', grip: [32500, 37500], weight: 4, price: 15, ore: 3, dur: 200, sold: true, drop: true },
  warhammer: { cat: 'weapon', name: '戰錘', die: [1, 8], type: 'blunt', versatile: 10, mastery: 'push', skill: 'mace', grip: [32500, 37500], weight: 5, price: 30, ore: 3, dur: 200, sold: true, drop: true },
  whip: { cat: 'weapon', name: '鞭子', die: [1, 4], type: 'slash', finesse: true, reach: true, mastery: 'slow', skill: 'whip', grip: [22500, 27500], weight: 3, price: 10, dur: 200, sold: true, drop: true },
  crossbow: { cat: 'weapon', name: '輕弩', die: [1, 8], type: 'pierce', ammo: 'bolt', range: [5, 20], loading: true, twoHand: true, mastery: 'slow', skill: 'crossbow', meleeSkill: 'mace', grip: [15000, 0], weight: 5, price: 35, dur: 200, sold: true, drop: true },
  arrow: { cat: 'ammo', name: '箭矢', weight: 1, price: 5, bundle: 20, sold: true, drop: true },
  bolt: { cat: 'ammo', name: '弩矢', weight: 1.5, price: 5, bundle: 20, sold: true, drop: true },
  // 防具（第二十九版追加）：cls 類別（light 輕甲、medium 中甲、heavy 重甲、none 無甲＝衣袍）決定敏捷加不加閃避、多花幾刻、練哪一項穿甲技能；
  // str 力量需求（力量不到，走一步 15 刻）；stealth 隱匿劣勢（只建標籤，潛行第 3 階段才做）；desc 遊戲裡的一句說明。
  // 內部 id：light＝皮甲、medium＝鱗甲、heavy＝鎖子甲（原本的輕甲、中甲、重甲改名）
  padded: { cat: 'armor', cls: 'light', name: '布甲', phys: 0, magic: 1, ticks: 0, weight: 8, price: 22, ore: 2, stealth: true, desc: '縫了棉絮的布衣，擋不了刀劍，勉強隔一點魔力。', dur: 150, sold: true, drop: true },
  light: { cat: 'armor', cls: 'light', name: '皮甲', phys: 0, magic: 1, ticks: 0, weight: 10, price: 32, ore: 2, desc: '鞣過的皮革，輕便，動作不受拘束。', dur: 150, sold: true, drop: true },
  studded: { cat: 'armor', cls: 'light', name: '鑲釘皮甲', phys: 1, magic: 1, ticks: 0, weight: 13, price: 67, ore: 3, desc: '皮甲上釘了金屬釘，多擋一點砍刺。', dur: 150, sold: true, drop: true },
  hide: { cat: 'armor', cls: 'medium', name: '厚皮甲', phys: 1, magic: 2, ticks: 1, weight: 12, price: 32, ore: 3, desc: '獸皮縫成的厚甲，不重，但走起來有點悶。', dur: 150, sold: true, drop: true },
  chainshirt: { cat: 'armor', cls: 'medium', name: '鎖子襯衫', phys: 1, magic: 2, ticks: 1, weight: 20, price: 71, ore: 4, desc: '貼身穿的短鎖環衫，罩住上身。', dur: 150, sold: true, drop: true },
  medium: { cat: 'armor', cls: 'medium', name: '鱗甲', phys: 2, magic: 2, ticks: 1, weight: 45, price: 71, ore: 4, stealth: true, desc: '一片片金屬鱗疊成的甲，扎實但吵。', dur: 150, sold: true, drop: true },
  breastplate: { cat: 'armor', cls: 'medium', name: '胸甲', phys: 2, magic: 2, ticks: 1, weight: 20, price: 200, ore: 5, desc: '整片鍛成的胸甲，輕又擋得住，價錢也高。', dur: 150, sold: true, drop: true },
  halfplate: { cat: 'armor', cls: 'medium', name: '半身板甲', phys: 2, magic: 2, ticks: 1, weight: 40, price: 274, ore: 5, stealth: true, desc: '護住軀幹與肩臂的板甲，稜角分明，動起來叮噹響。', dur: 150, sold: true, drop: true },
  ringmail: { cat: 'armor', cls: 'heavy', name: '環甲', phys: 2, magic: 1, ticks: 2, weight: 40, price: 55, ore: 5, stealth: true, desc: '把鐵環縫在皮底上，粗糙但便宜的重甲。', dur: 150, sold: true, drop: true },
  heavy: { cat: 'armor', cls: 'heavy', name: '鎖子甲', phys: 3, magic: 1, ticks: 2, str: 13, weight: 50, price: 87, ore: 5, stealth: true, desc: '一整套鎖環編成的長甲，擋砍很好，要有點力氣才穿得動。', dur: 150, sold: true, drop: true },
  splint: { cat: 'armor', cls: 'heavy', name: '條板甲', phys: 3, magic: 1, ticks: 2, str: 15, weight: 55, price: 141, ore: 6, stealth: true, desc: '縱向的鐵條板綁在皮底上，護得周全，穿脫費事。', dur: 150, sold: true, drop: true },
  plate: { cat: 'armor', cls: 'heavy', name: '全身板甲', phys: 4, magic: 1, ticks: 2, str: 15, weight: 60, price: 387, ore: 7, stealth: true, desc: '從頭到腳的鋼板，什麼都擋得住，也最沉最貴。', dur: 150, sold: true, drop: true },
  robe: { cat: 'armor', cls: 'none', name: '一般衣袍', phys: 0, magic: 1, ticks: 0, weight: 4, price: 10, dur: 150, sold: true, drop: true },
  mrobe: { cat: 'armor', cls: 'none', name: '魔法衣袍', phys: 0, magic: 3, ticks: 0, weight: 4, price: 40, dur: 150, sold: false, drop: true },
  shield: { cat: 'shield', name: '盾牌', block: 0.25, value: 4, weight: 6, price: 32, ore: 2, dur: 100, sold: true, drop: true },
  pick: { cat: 'tool', name: '礦鎬', weight: 10, price: 20, dur: 50, sold: true },
  sickle: { cat: 'tool', name: '鐮刀', weight: 2, price: 20, dur: 50, sold: true },
};
// 傷害種類：揮砍打中甲、重甲時防具多擋 1 點；穿刺照品質的穿甲比例無視一部分物理減傷；鈍擊無視一半物理減傷（無條件進位）；
// 魔法、神聖只看魔法減傷。扣完至少吃 1 點（見 combat.js 的 reduce）
FE.DMG_TYPES = { slash: '揮砍', pierce: '穿刺', blunt: '鈍擊', magic: '魔法', holy: '神聖' };
// 武器特質的名字（說明與商店用）
FE.WEAPON_TAGS = { versatile: '可雙手', heavy: '重型', light: '輕型', finesse: '靈巧', reach: '觸及', twoHand: '雙手', thrown: '投擲', ammo: '彈藥', loading: '裝填' };
// 精通（第二十八版；第二十九版再追加：不分職業，一律要那把武器的技能 5 級才解鎖，MASTERY_SKILL）；怪物沒有
FE.MASTERIES = {
  sap: { name: '削弱', desc: '命中後，目標下一次出手有劣勢' },
  vex: { name: '侵擾', desc: '命中且造成傷害後，你下一次打牠有優勢' },
  topple: { name: '失衡', desc: '命中後有機會讓目標倒地：下一回合不能動，打牠有優勢' },
  push: { name: '推擊', desc: '命中後把目標直線推開 2 格，大型怪物推不動' },
  nick: { name: '迅切', desc: '雙持的動作不多花時間' },
  cleave: { name: '順劈', desc: '命中後可以順手打目標旁邊、也在你身邊的另一隻怪物，這一下不加屬性修正值；一個動作最多一次' },
  graze: { name: '擦掠', desc: '沒命中時照樣造成等於屬性修正值的傷害（修正值是正數才有）' },
  slow: { name: '緩速', desc: '命中且造成傷害後，目標下一次移動多花 10 刻' },
};
FE.MASTERY_SKILL = 5;
// 採集點：都可以走過去；拿著對的工具撞上去就採，採完變回普通地面，REGROW_TICKS 刻後長回來
FE.NODES = {
  ore: { name: '礦脈', glyph: '☼', tool: 'pick', item: 'ore', verb: '挖' },
  herb: { name: '藥草', glyph: '♥', tool: 'sickle', item: 'herb', verb: '割' },
};
// 六項屬性（順序固定：力量、敏捷、體質、智力、感知、魅力）。修正值＝(屬性－10)÷2 無條件捨去（9 和 8 都算 -1）。
// 力量（近戰與投擲傷害、重型近戰武器、戰士的格擋值與盾擊、負重）、敏捷（出手 d20、遠程傷害、重型遠程武器、閃避、攻擊速度）、體質（生命、休息回復）、
// 智力（法師的範圍魔攻：命中、傷害、範圍）、感知（射程、暴擊）、魅力（價錢、金幣獎勵、牧師的治療）
FE.ATTRS = [
  { key: 'str', name: '力量', info: '近戰與投擲的傷害、能背的重量（力量值×15 磅）；戰士拿盾牌時格擋值與盾擊也加' },
  { key: 'dex', name: '敏捷', info: '出手擲骰、遠程傷害、閃避機率（穿中甲最多算 +2、穿重甲不算）、攻擊與走路的快慢' },
  { key: 'con', name: '體質', info: '生命上限、休息的回復量、挨到的物理傷害再減一些' },
  { key: 'int', name: '智力', info: '技能練得快（每點修正值經驗 ±10%）；法師拿法杖施法：命中、傷害、範圍' },
  { key: 'wis', name: '感知', info: '射程（射擊、投擲、施法）；+2 起擲出 19 也算暴擊；牧師的治療與神聖之光' },
  { key: 'cha', name: '魅力', info: '向工匠買東西更便宜、賣東西更貴，委託的金錢獎勵更多；聖騎士的治療' },
];
// 技能（第二十九版，照 Dwarf Fortress：用了就累積經驗，升到第 N 級要 400＋100N 點，等級沒有上限，15 級以上都是傳奇）。
// weapon 是武器技能（FE.GEAR 的 skill 欄指到它），近戰出手命中每 5 級 +1、傷害每 3 級 +1；遠程（射箭、射弩、投擲）命中看射擊，武器技能只加傷害。
// 格鬥：所有近戰出手都練（含徒手），命中每 10 級 +1，跟武器技能疊加；徒手只吃格鬥。射擊：所有遠程都練（含投擲），命中每 5 級 +1
FE.SKILLS = {
  sword: { name: '劍術', weapon: true },      // 長劍、短劍、巨劍、拿弓近戰
  spear: { name: '槍術', weapon: true },      // 短矛、長槍（第二十九版追加：矛術與長矛術合併）
  knife: { name: '刀術', weapon: true },      // 短刀
  staff: { name: '杖術', weapon: true },      // 法杖（含法師的範圍魔攻）
  axe: { name: '斧術', weapon: true },        // 戰斧、巨斧
  mace: { name: '錘術', weapon: true },       // 硬頭錘、戰錘、拿弩近戰（錘術與重錘術合併）
  whip: { name: '鞭術', weapon: true },       // 鞭子
  bow: { name: '弓術', weapon: true },        // 弓箭射擊，管傷害
  crossbow: { name: '弩術', weapon: true },   // 輕弩射擊，管傷害
  misc: { name: '雜物使用', weapon: true },   // 盾擊：命中每 5 級 +1、傷害每 3 級 +1
  fight: { name: '格鬥' },
  shoot: { name: '射擊' },
  dodge: { name: '閃避' },
  light: { name: '輕甲' },     // 穿輕甲被打中而且防具擋下傷害（第二十九版追加：穿甲拆成輕甲、中甲、重甲三項）
  medium: { name: '中甲' },
  heavy: { name: '重甲' },
  shield: { name: '盾牌使用' },
};
// 防具類別對應的穿甲技能（無甲＝衣袍沒有）
FE.ARMOR_SKILL = { light: 'light', medium: 'medium', heavy: 'heavy' };
// 技能等級的名稱（0～15；15 以上寫「傳奇 +N」）
FE.SKILL_LEVELS = ['涉獵', '新手', '尚可', '稱職', '熟練', '精通', '天才', '老練', '專家', '專精', '卓越', '傑出', '大師', '英雄', '宗師', '傳奇'];
FE.skillLevelName = (lv) => (lv >= FE.CONFIG.SKILL_LEGEND ? (lv > FE.CONFIG.SKILL_LEGEND ? `傳奇 +${lv - FE.CONFIG.SKILL_LEGEND}` : '傳奇') : FE.SKILL_LEVELS[Math.max(0, lv)]);

// 種族與體型（第二十九版）：建角順序是種族 → 人類自己加 2 點屬性 → 擲身高與體格 → 職業 → 起始裝備。
// 體型＝基本體型 ×（1＋0.05×（身高級−4））×（1＋0.05×（體格級−4）），身高、體格各擲 1～7；武器看體型決定拿不拿得起、能不能單手（FE.GEAR 的 grip）
FE.PLAYER_RACES = {
  human: { name: '人類', size: 70000, free: 2, desc: '體型 70,000。自己加 2 點屬性（兩點加同一項或分兩項，上限 18）。' },
  dwarf: { name: '矮人', size: 60000, bonus: { con: 2 }, desc: '體型 60,000。體質 +2。' },
  elf: { name: '精靈', size: 60000, bonus: { dex: 2 }, desc: '體型 60,000。敏捷 +2。' },
};
FE.HEIGHTS = ['非常矮', '矮', '略矮', '普通', '略高', '高', '非常高']; // 身高 1～7
FE.BUILDS = ['非常瘦弱', '瘦', '略瘦', '普通', '略壯', '壯碩', '非常魁梧']; // 體格 1～7
FE.BODY_STEP = 0.05;
FE.bodySize = (race, height, build) => Math.round(FE.PLAYER_RACES[race].size * (1 + FE.BODY_STEP * (height - 4)) * (1 + FE.BODY_STEP * (build - 4)));
// 開新世界時可挑的起始裝備與物品（id 跟 FE.GEAR 的種類同名；herb、gold 是藥草與金幣）。品質都是普通
// desc 是建角畫面右欄顯示的說明（只是文字，不影響規則）
FE.START_OPTS = {
  sword: { label: '長劍', gear: 'sword', desc: '1d8 揮砍，副手空著時 1d10。精通時削弱：打中後對方下一次出手有劣勢。' },
  spear: { label: '長槍', gear: 'spear', desc: '1d10 穿刺，很重（力量不到 13 出手有劣勢），打得到直線 2 格外；體型夠大才能單手拿。精通時推擊：打中後把對方推開 2 格。' },
  shortspear: { label: '短矛', gear: 'shortspear', desc: '1d6 穿刺，副手空著時 1d8，可以擲出去（4／12 格）。精通時削弱。' },
  dagger: { label: '短刀', gear: 'dagger', desc: '1d4 穿刺，靈巧、輕巧、出手快、容易暴擊，可以擲出去；副手也拿短刀可以雙持。精通時迅切。' },
  bow: { label: '弓箭', gear: 'bow', arrows: 20, desc: '1d6 穿刺，按 F 射擊（5／20 格），要用兩手，附一捆 20 支箭。精通時侵擾：射中後你下一次打牠有優勢。' },
  staff: { label: '法杖', gear: 'staff', desc: '1d6 鈍擊，副手空著時 1d8。法師拿著按 F 施放範圍魔法。精通時失衡。' },
  shield: { label: '盾牌', gear: 'shield', desc: '拿在副手，有機率擋下一部分傷害。' },
  waraxe: { label: '戰斧', gear: 'waraxe', desc: '1d8 揮砍，副手空著時 1d10。精通時失衡：打中後有機會讓對方倒地。' },
  greataxe: { label: '巨斧', gear: 'greataxe', desc: '1d12 揮砍，很重（力量不到 13 出手有劣勢），體型夠大才拿得起來。精通時順劈：打中後可以順手打旁邊另一隻。' },
  warhammer: { label: '戰錘', gear: 'warhammer', desc: '1d8 鈍擊，副手空著時 1d10。精通時推擊。' },
  shortsword: { label: '短劍', gear: 'shortsword', desc: '1d6 穿刺，靈巧、輕巧，副手也拿輕武器可以雙持。精通時侵擾。' },
  club: { label: '硬頭錘', gear: 'club', desc: '1d6 鈍擊。精通時削弱。' },
  medium: { label: '鱗甲', gear: 'medium', desc: '一片片金屬鱗疊成的甲，擋得住不少物理傷害，每個動作多花 1 刻。' },
  light: { label: '皮甲', gear: 'light', desc: '鞣過的皮革，擋不了刀劍，但輕便、不拖慢動作。' },
  heavy: { label: '鎖子甲', gear: 'heavy', desc: '鎖環編成的長甲，擋砍很好，每個動作多花 2 刻，力量要 13 才穿得順。' },
  robe: { label: '一般衣袍', gear: 'robe', desc: '幾乎擋不住傷害，輕得不占負重。' },
  herb: { label: '2 份藥草', herb: 2, desc: '放進背包，每份吃下去回復生命上限的四分之一。' },
  gold: { label: '20 銀', silver: 20, desc: '到聚落向工匠買裝備或修理。' },
};
// 第三十一版：武器與防具一律從全部列出（沒寫說明的照裝備資料補上名字），副手挑盾牌或空著；輕弩附 20 支弩矢
for (const k of Object.keys(FE.GEAR)) {
  const d = FE.GEAR[k];
  if (FE.START_OPTS[k] || !d.sold || (d.cat !== 'weapon' && d.cat !== 'armor')) continue;
  FE.START_OPTS[k] = { label: d.name, gear: k, desc: d.desc || '' };
}
FE.START_OPTS.crossbow.bolts = 20;
FE.START_OPTS.nooff = { label: '副手空著', desc: '副手不拿東西（雙手武器、可雙手的武器要副手空著）。' };
// 起始裝備的三組（allGear 的職業才有，排在職業自己的 groups 前面）：主手武器、身上防具、副手
FE.START_GEAR_GROUPS = [
  { pick: 1, of: Object.keys(FE.START_OPTS).filter((k) => FE.START_OPTS[k].gear && FE.GEAR[FE.START_OPTS[k].gear].cat === 'weapon'), name: '主手武器' },
  { pick: 1, of: Object.keys(FE.START_OPTS).filter((k) => FE.START_OPTS[k].gear && FE.GEAR[FE.START_OPTS[k].gear].cat === 'armor'), name: '身上防具' },
  { pick: 1, of: ['shield', 'nooff'], name: '副手' },
];
// 職業 cls 建角要挑的各組
FE.startGroups = (cls) => (FE.CLASSES[cls].allGear ? FE.START_GEAR_GROUPS.concat(FE.CLASSES[cls].groups) : FE.CLASSES[cls].groups);
// 職業（第二十九版追加改成六個）：base 職業基礎（生命用；負重看力量，不看職業）、attr 起始屬性、fixed 固定給的裝備（武器放主手，多的武器放背包）、
// groups 自己選的（每組從 of 裡挑 pick 樣）、primary 是測試機器人加點的主屬性（其次體質；不是玩家的限制）、
// pool 起始技能池（'melee' 代表各近戰武器技能：劍術、槍術、刀術、杖術、斧術、錘術、鞭術）。職業不綁武器和防具，裝備欄沒有職業限制，只有野蠻人不能穿中甲、重甲。
// 職業能力：bash 戰士盾擊（按 5）、spell 法師拿法杖按 F 範圍魔攻、light 牧師按 F 放神聖之光、
// holy 聖騎士每個動作第一下命中多 1d8 神聖傷害、heal 治療（按 4，healAttr 是加哪一項屬性的修正值）。精通不分職業，一律要該武器的技能 5 級
FE.CLASSES = {
  warrior: {
    name: '戰士', base: 10, attr: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
    desc: '生命多、背得多，什麼近戰武器都上手。拿盾牌時格擋值再加力量修正值，還能按 5 用盾牌撞。',
    allGear: true, fixed: [], groups: [{ pick: 1, of: ['herb', 'gold'] }], primary: 'str', bash: true,
    pool: ['fight', 'medium', 'heavy', 'shield', 'dodge', 'melee'],
  },
  ranger: {
    name: '遊俠', base: 8, attr: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
    desc: '腳步輕、閃得開，擅長弓箭。一開始就帶著弓和一捆箭。',
    allGear: true, fixed: [], groups: [{ pick: 1, of: ['herb', 'gold'] }], primary: 'dex',
    pool: ['shoot', 'dodge', 'fight', 'knife', 'sword', 'light'],
  },
  mage: {
    name: '法師', base: 4, attr: { str: 8, dex: 13, con: 12, int: 15, wis: 14, cha: 10 },
    desc: '生命少、背不動多少東西。拿法杖按 F，魔力會炸開一片，打中目標和周圍的怪物。',
    allGear: true, fixed: [], groups: [{ pick: 1, of: ['herb', 'gold'] }], primary: 'int', spell: true,
    pool: ['dodge', 'shoot', 'knife', 'fight'],
  },
  priest: {
    name: '牧師', base: 8, attr: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    desc: '靠感知吃飯。按 F 對一個目標放神聖之光（過渡的一招，施法系統還沒談），按 4 治療自己（加感知修正值）。',
    allGear: true, fixed: [], groups: [{ pick: 1, of: ['herb', 'gold'] }], primary: 'wis', light: true, heal: true, healAttr: 'wis',
    pool: ['shield', 'medium', 'fight', 'dodge'],
  },
  paladin: {
    name: '聖騎士', base: 10, attr: { str: 14, dex: 10, con: 13, int: 8, wis: 12, cha: 15 },
    desc: '披甲持盾的戰鬥者。每個動作第一下打中時，神聖之力多傷對方一些；按 4 治療自己（加魅力修正值）。',
    allGear: true, fixed: [], groups: [{ pick: 1, of: ['herb', 'gold'] }], primary: 'cha', holy: true, heal: true, healAttr: 'cha',
    pool: ['shield', 'medium', 'heavy', 'fight', 'melee'],
  },
  barbarian: {
    name: '野蠻人', base: 12, attr: { str: 14, dex: 13, con: 15, int: 8, wis: 12, cha: 10 },
    desc: '生命最多，揮著大斧硬衝。不能穿中甲、重甲（輕甲、衣袍、盾牌可以）。',
    allGear: true, fixed: [], groups: [{ pick: 1, of: ['herb', 'gold'] }], primary: 'str', noHeavyArmor: true,
    pool: ['fight', 'dodge', 'light', 'shoot', 'melee'],
  },
};
// 施法（第三十一版）：法師、牧師、聖騎士各有幾招，按 F 打開招式清單。都不耗資源，用完冷卻 cd 回合（之後每做一個動作少一回合）。
// 攻擊招：attr 加哪一項屬性的修正值（命中與傷害）、die 傷害骰、type 傷害種類；aim 要先瞄準（射程 SPELL_RANGE 加感知），area 'target' 打目標與周圍
// （半徑同範圍魔攻），'self' 打自己周圍 1 格；push 把打中的推開幾格（大型推不動）；noStaff 不吃法杖的加成，也不受穿甲的施法減值（聖騎士）。
// 防禦招（ward）：ac 讓怪物打你的 d20 減幾（遊戲沒有 AC，照《D&D》每點 AC 少 5% 被打中換算）、hp 生命上限與目前生命加幾（再加 hpAttr 修正值，照 Aid）、
// ticks 持續幾刻、hits 被打中幾次就結束（再加 hpAttr 修正值，只有守護）、unarmored 只在沒穿防具（衣袍算沒穿）時有效（照 Mage Armor）。效果結束才能再放
FE.SPELLS = {
  bolt: { name: '魔法攻擊', attr: 'int', die: [1, 8], type: 'magic', aim: true, cd: 1, desc: '對一個目標射出魔力' },
  blast: { name: '大魔法攻擊', attr: 'int', die: [1, 6], type: 'magic', aim: true, area: 'target', cd: 3, desc: '在遠方炸開一片，打目標與周圍的怪物' },
  ward: { name: '魔法防禦', ward: true, ac: 3, ticks: 800, unarmored: true, desc: '魔力護身 8 小時，怪物比較打不中你；穿上防具就失效（衣袍可以）' },
  holy: { name: '神聖攻擊', attr: 'wis', die: [1, 8], type: 'holy', aim: true, cd: 1, desc: '對一個目標放出神聖之光' },
  nova: { name: '大神聖攻擊', attr: 'wis', die: [1, 6], type: 'holy', area: 'self', push: 2, cd: 3, desc: '以自己為中心爆開，打周圍 1 格的怪物並推開' },
  bless: { name: '神聖加護', ward: true, ac: 2, hp: 5, hpAttr: 'wis', ticks: 800, desc: '加護 8 小時：比較打不中你，生命上限與生命增加' },
  smite: { name: '懲戒', attr: 'cha', die: [1, 4], type: 'holy', area: 'self', cd: 3, noStaff: true, desc: '神聖之力打周圍 1 格的怪物' },
  guard: { name: '守護', ward: true, ac: 1, hp: 5, hpAttr: 'cha', ticks: 400, hits: 2, desc: '守護 4 小時或被打中幾次：比較打不中你，生命上限與生命增加' },
};
FE.CLASS_SPELLS = { mage: ['bolt', 'blast', 'ward'], priest: ['holy', 'nova', 'bless'], paladin: ['smite', 'guard'] };
// 法師、牧師穿甲施法的減值（d20）：中甲 −2、重甲 −4，那一類甲的技能 5 級（精通）減半、10 級（卓越）歸零
FE.CAST_PENALTY = { medium: 2, heavy: 4 };
// 各近戰武器技能（職業技能池的 'melee'）
FE.MELEE_SKILLS = ['sword', 'spear', 'knife', 'staff', 'axe', 'mace', 'whip'];
// 起始技能（第三十一版）：從全部技能擲 5 項，每項新手～精通（1～5 級），可以鎖定喜歡的、重擲其他的；
// 保底至少 1 項武器技能、1 項防具技能（輕甲、中甲、重甲）；本職業原本的技能池加權 classWeight 倍（倍率測試後再定）。
// 等級照機率表：偏高、偏低兩組輪流（第一次隨機），每組 5 行（新手／尚可／稱職／熟練／精通的 %），每次重擲打亂發給沒鎖定的格子
FE.SKILL_ROLL = {
  slots: 5,
  classWeight: 2,
  high: [[0, 5, 20, 40, 35], [5, 10, 25, 35, 25], [5, 15, 30, 30, 20], [10, 20, 35, 25, 10], [15, 30, 30, 20, 5]],
  low: [[5, 20, 35, 30, 10], [10, 25, 35, 25, 5], [20, 30, 30, 15, 5], [30, 35, 25, 10, 0], [40, 35, 20, 5, 0]],
};
// 身高、體格（1～7）出現的機率（%，第二十九版追加；體型公式不變）
FE.BODY_ODDS = {
  human: { height: [8, 13, 19, 22, 18, 12, 8], build: [9, 14, 20, 21, 17, 12, 7] },
  dwarf: { height: [24, 27, 20, 13, 9, 5, 2], build: [3, 6, 11, 17, 23, 24, 16] },
  elf: { height: [2, 6, 12, 18, 25, 22, 15], build: [21, 28, 22, 14, 8, 5, 2] },
};
FE.rollOdds = (rng, odds) => {
  let r = rng() * odds.reduce((s, x) => s + x, 0);
  for (let i = 0; i < odds.length; i++) {
    r -= odds[i];
    if (r < 0) return i + 1;
  }
  return odds.length;
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
