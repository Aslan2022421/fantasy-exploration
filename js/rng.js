// 可重現的亂數與小工具。同一個種子會生成同一個世界。

FE.makeRng = function (seed) {
  let a = seed >>> 0;
  const rng = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 存檔要記住亂數走到哪裡，讀檔後接著同一串亂數
  rng.getState = () => a;
  rng.setState = (s) => {
    a = s;
  };
  return rng;
};

// 擲 d20，回傳點數與五段結果。mod 是加減值（例如地形）。
// adv：1 是優勢（擲兩次取高）、-1 是劣勢（擲兩次取低）、0 只擲一次；優勢、劣勢同時有的時候由呼叫的一方先抵消成 0。
// critMin：擲出幾點以上算暴擊（平常 20；感知修正值 +2 以上 19，短刀再擴大 1）。
// ac：對方的 AC（第三十三版）。擲出的點數到 critMin 一定暴擊、擲出 1 一定失手，其他看 d20＋mod 比 AC 高多少分段（FE.ROLL_BANDS）；
// 沒給 AC 照第三十二版的分段（FE.ROLL_OLD_AC）。
// 回傳 { n 採用的那一顆, dice 擲出的每一顆, adv, mod, total d20＋mod, ac, key, name }
FE.rollD20 = function (rng, mod, adv, critMin, ac) {
  const a = FE.randInt(rng, 1, 20);
  const dice = adv ? [a, FE.randInt(rng, 1, 20)] : [a];
  const n = adv > 0 ? Math.max(...dice) : adv < 0 ? Math.min(...dice) : a;
  const m = mod || 0;
  const target = ac == null ? FE.ROLL_OLD_AC : ac;
  const total = n + m;
  const key = n >= (critMin || 20) ? 'crit' : n === 1 ? 'fumble' : null;
  const band = key ? FE.ROLL_BANDS.find((b) => b.key === key) : FE.ROLL_BANDS.find((b) => !b.nat && total - target >= b.min);
  return { n, dice, adv: adv || 0, mod: m, total, ac: target, key: band.key, name: band.name };
};

// 擲傷害骰：die 是 [顆數, 面數]，times 是擲幾次（暴擊、重擊擲兩次）
FE.rollDice = function (rng, die, times) {
  let sum = 0;
  for (let t = 0; t < (times || 1); t++) for (let i = 0; i < die[0]; i++) sum += FE.randInt(rng, 1, die[1]);
  return sum;
};

FE.randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

FE.pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

FE.fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));

FE.nowTaipei = () => new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

// localStorage 在私密視窗或被封鎖時會丟例外，讀寫都包起來
FE.store = {
  load(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  save(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* 存不了就算了，遊戲照玩 */
    }
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {
      /* 刪不了就算了 */
    }
  },
};
