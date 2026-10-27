// 世界與生成器。生成器刻意做得粗糙：氣候接縫與印章對不上、村民先寫任務再刪人、
// 寶箱金幣公式會算出負數或 NaN。這些錯交給檢查器去抓，抓到的就變成 BUG 怪。
(function () {
  const C = FE.CONFIG;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // 世界是二維的區塊格：每塊 CHUNK_W × CHUNK_H 格，用區塊座標（可以是負的）找。
  // 新的一塊接在已有區塊的上下左右，所以世界不一定是方的，區塊之間可能有還沒創出來的空缺。
  class World {
    constructor(seed) {
      this.seed = seed;
      this.chunkMap = new Map(); // "cx,cy" → 區塊（含格子）
      this.chunks = [];          // 依創世順序排的區塊
      this.npcs = [];
      this.chests = [];
      this.villages = [];
      this.landmarks = [];      // 聚落附近的獨特地貌
      this.nextId = 1;
      this.spawn = null;
      this.dormant = new Set(); // 創世時放不下怪物的地形錯位
      this.nextTownAt = null;   // 下一座大城鎮蓋在第幾塊區塊（創世順序，從 0 算）；null 是還沒蓋過，看世界等級
    }

    // 創出第 index 塊區塊（從 0 算）時要不要蓋大城鎮：世界等級到 TOWN_FIRST_LEVEL 才開始，
    // 第一座在世界等級剛好達到的那一塊，之後每隔 4 或 5 塊一座
    townDue(index) {
      if (FE.worldLevelFor(index + 1) < C.TOWN_FIRST_LEVEL) return false;
      return this.nextTownAt == null || index >= this.nextTownAt;
    }

    // 查格子是最常做的事：先看是不是跟上一次同一塊，省掉組字串查表
    chunkAt(x, y) {
      const l = this._lastChunk;
      if (l && x >= l.x0 && x < l.x1 && y >= l.y0 && y < l.y1) return l;
      const ch = this.chunkMap.get(Math.floor(x / C.CHUNK_W) + ',' + Math.floor(y / C.CHUNK_H)) || null;
      if (ch) this._lastChunk = ch;
      return ch;
    }
    hasChunk(cx, cy) {
      return this.chunkMap.has(cx + ',' + cy);
    }
    inBounds(x, y) {
      return !!this.chunkAt(x, y);
    }
    cell(x, y) {
      const ch = this.chunkAt(x, y);
      return ch ? ch.cells[y - ch.y0][x - ch.x0] : null;
    }
    // 換地形時保留高度
    setCell(x, y, t, biome) {
      const ch = this.chunkAt(x, y);
      const old = ch.cells[y - ch.y0][x - ch.x0];
      ch.cells[y - ch.y0][x - ch.x0] = { t, biome, h: old ? old.h : 0 };
    }
    setHeight(x, y, h) {
      this.cell(x, y).h = h;
    }
    // 所有區塊合起來的外框（右、下不含）
    bounds() {
      const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const ch of this.chunks) {
        b.x0 = Math.min(b.x0, ch.x0);
        b.y0 = Math.min(b.y0, ch.y0);
        b.x1 = Math.max(b.x1, ch.x1);
        b.y1 = Math.max(b.y1, ch.y1);
      }
      return b;
    }
    forEachCell(fn) {
      for (const ch of this.chunks) {
        for (let y = ch.y0; y < ch.y1; y++) for (let x = ch.x0; x < ch.x1; x++) fn(x, y, ch.cells[y - ch.y0][x - ch.x0]);
      }
    }
    // 還沒創出來、但貼著已有區塊上下左右的位置
    frontier() {
      const out = new Map();
      for (const ch of this.chunks) {
        for (const [dx, dy] of DIRS) {
          const cx = ch.cx + dx;
          const cy = ch.cy + dy;
          if (!this.hasChunk(cx, cy)) out.set(cx + ',' + cy, [cx, cy]);
        }
      }
      return [...out.values()];
    }
    // 離 (x, y) 最近的邊界位置：量到那塊區域的最近一格
    nearestFrontier(x, y) {
      let best = null;
      for (const [cx, cy] of this.frontier()) {
        const x0 = cx * C.CHUNK_W;
        const y0 = cy * C.CHUNK_H;
        const nx = Math.max(x0, Math.min(x, x0 + C.CHUNK_W - 1));
        const ny = Math.max(y0, Math.min(y, y0 + C.CHUNK_H - 1));
        const d = Math.abs(nx - x) + Math.abs(ny - y);
        if (!best || d < best.d) best = { cx, cy, d };
      }
      return best;
    }
    passable(x, y) {
      const c = this.cell(x, y);
      return !!c && FE.TERRAIN[c.t].pass;
    }
    // 兩格的高度差在 1 以內（平地或坡）；差 2 以上是斷崖
    heightOk(x0, y0, x1, y1) {
      const a = this.cell(x0, y0);
      const b = this.cell(x1, y1);
      return !!a && !!b && Math.abs(a.h - b.h) <= 1;
    }
    // 能不能從 (x0, y0) 走一步到 (x1, y1)：目的地能站，而且不是斷崖
    canStep(x0, y0, x1, y1) {
      return this.passable(x1, y1) && this.heightOk(x0, y0, x1, y1);
    }
    npcAt(x, y) {
      return this.npcs.find((n) => n.x === x && n.y === y) || null;
    }
    npcById(id) {
      return this.npcs.find((n) => n.id === id) || null;
    }
    chestAt(x, y) {
      return this.chests.find((c) => c.x === x && c.y === y) || null;
    }
    // 第幾塊世界（創世順序，從 1 算）
    chunkNumber(x, y) {
      const ch = this.chunkAt(x, y);
      return ch ? ch.index + 1 : 0;
    }
    // 聚落是外框裡不規則的一塊：mask 每列一個字串，'#' 是聚落、空白是外面（還沒排版前整個外框都算）
    villageAt(x, y) {
      return (
        this.villages.find(
          (v) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1 && (!v.mask || v.mask[y - v.y0][x - v.x0] === '#')
        ) || null
      );
    }
    inVillage(x, y) {
      return !!this.villageAt(x, y);
    }
    villageById(id) {
      return this.villages.find((v) => v.id === id) || null;
    }
    // 聚落周圍的圈：從聚落的 mask 格子（外牆）量起，切比雪夫距離在寬度以內（含聚落本身；寬度看聚落種類）。
    // 圈裡不生怪物、不侵蝕、不重算地形，怪物也不能踏進來。先用外接矩形加寬度快速排除，再查 mask 膨脹出來的格子
    bufferWidth(v) {
      return C.SETTLE_BUFFER[v.kind] || C.SETTLE_BUFFER.village;
    }
    bufferGrid(v) {
      if (!this.bufCache) this.bufCache = new Map();
      let g = this.bufCache.get(v.id);
      if (g && g.mask === v.mask && g.x0 === v.x0 && g.y0 === v.y0) return g;
      const B = this.bufferWidth(v);
      const mw = v.x1 - v.x0 + 1;
      const mh = v.y1 - v.y0 + 1;
      const w = mw + 2 * B;
      const h = mh + 2 * B;
      const tmp = new Uint8Array(w * h);
      const data = new Uint8Array(w * h);
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          if (v.mask[y][x] !== '#') continue;
          for (let dx = -B; dx <= B; dx++) tmp[(y + B) * w + x + B + dx] = 1;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!tmp[y * w + x]) continue;
          for (let dy = -B; dy <= B; dy++) if (y + dy >= 0 && y + dy < h) data[(y + dy) * w + x] = 1;
        }
      }
      g = { mask: v.mask, x0: v.x0, y0: v.y0, B, w, data };
      this.bufCache.set(v.id, g);
      return g;
    }
    inBuffer(x, y) {
      for (const v of this.villages) {
        const B = this.bufferWidth(v);
        if (x < v.x0 - B || x > v.x1 + B || y < v.y0 - B || y > v.y1 + B) continue;
        if (!v.mask) return true; // 還沒排版：先當整個工作範圍
        const g = this.bufferGrid(v);
        if (g.data[(y - v.y0 + B) * g.w + (x - v.x0 + B)]) return true;
      }
      return false;
    }
    landmarkAt(x, y) {
      return this.landmarks.find((l) => x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1) || null;
    }

    // 從起點們走到每一格要幾步（只走能走的格子）；給了 target（"x,y"）就走到那裡為止
    stepMap(starts, target) {
      const dist = new Map();
      const q = [];
      for (const [x, y] of starts) {
        if (!this.passable(x, y)) continue;
        dist.set(x + ',' + y, 0);
        q.push([x, y]);
      }
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        const d = dist.get(x + ',' + y);
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const k = nx + ',' + ny;
          if (dist.has(k) || !this.canStep(x, y, nx, ny)) continue;
          dist.set(k, d + 1);
          if (k === target) return dist;
          q.push([nx, ny]);
        }
      }
      return dist;
    }

    // 兩點之間的實際路程；走不到時用直線距離乘 1.5 估
    pathDistance(a, b) {
      const d = this.stepMap([[a.x, a.y]], b.x + ',' + b.y).get(b.x + ',' + b.y);
      return d !== undefined ? d : Math.round((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * 1.5);
    }

    // 在區塊座標 (cx, cy) 創出一塊新世界，回傳它的範圍（右、下不含）
    addChunk(cx, cy) {
      const index = this.chunks.length;
      // 區塊的亂數只看世界種子和區塊座標，跟創世順序無關
      const rng = FE.makeRng(Math.floor(hash(this.seed, cx * 7919 + 13, cy * 104729 + 7) * 4294967296));
      const rect = { x0: cx * C.CHUNK_W, y0: cy * C.CHUNK_H, x1: (cx + 1) * C.CHUNK_W, y1: (cy + 1) * C.CHUNK_H };
      const cells = [];
      for (let y = rect.y0; y < rect.y1; y++) {
        const row = [];
        for (let x = rect.x0; x < rect.x1; x++) row.push({ t: '.', biome: 'plain', h: 0 });
        cells.push(row);
      }
      const chunk = Object.assign({ index, cx, cy, cells }, rect);
      this.chunkMap.set(cx + ',' + cy, chunk);
      this.chunks.push(chunk);
      const rough = paintBiomes(this, rng, rect, index);
      const village = placeVillage(this, rng, rect, index, rough, this.townDue(index));
      let landmark = null;
      // 蓋了城鎮，用這一塊的亂數決定下一座隔 4 還是 5 塊
      if (village && village.kind === 'town') this.nextTownAt = index + (rng() < 0.5 ? C.TOWN_GAP[0] : C.TOWN_GAP[1]);
      if (village) {
        // 先定聚落標籤（人口決定住多少人），再在附近放地貌
        FE.Steading.roll(this, rng, village);
        FE.Steading.layout(this, rng, village);
        // 出生點放在離預定位置最近的路上（排版可能在原本那一格蓋了房子）
        if (index === 0) {
          const s = this.spawn;
          let best = null;
          for (let y = village.y0; y <= village.y1; y++) {
            for (let x = village.x0; x <= village.x1; x++) {
              if (this.villageAt(x, y) !== village || this.cell(x, y).t !== '·') continue;
              const d = Math.abs(x - s.x) + Math.abs(y - s.y);
              if (!best || d < best.d) best = { x, y, d };
            }
          }
          if (best) this.spawn = { x: best.x, y: best.y };
        }
        landmark = FE.Steading.placeLandmark(this, rng, rect, village);
        placeNpcs(this, rng, village);
      }
      placeChests(this, rng, rect);
      return { index, rect, village, landmark };
    }
  }

  FE.inRect = (r, x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  // ---- 高度：參考矮人要塞的上下坡 ----
  // 用平滑的雜訊算高度（0～4），整個世界連續，跨區塊也接得上。
  // 每走一格高度最多變化不到一階，所以自然生成的地形只有坡、沒有斷崖；斷崖只出現在出錯的地方。
  function hash(seed, x, y) {
    let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function valueNoise(seed, x, y, scale) {
    const fx = x / scale;
    const fy = y / scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const s = (t) => t * t * (3 - 2 * t);
    const u = s(fx - ix);
    const v = s(fy - iy);
    const a = hash(seed, ix, iy);
    const b = hash(seed, ix + 1, iy);
    const c = hash(seed, ix, iy + 1);
    const d = hash(seed, ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  FE.heightAt = function (seed, x, y) {
    const n = 0.7 * valueNoise(seed, x, y, 12) + 0.3 * valueNoise(seed + 7, x, y, 6);
    return Math.max(0, Math.min(C.MAX_HEIGHT, Math.floor(n * (C.MAX_HEIGHT + 1))));
  };

  // ---- 氣候與生態區：參考矮人要塞，用海拔、溫度、雨量三張圖疊起來決定 ----
  // 溫度和雨量也是平滑的雜訊（尺度比高度大），越高的地方越冷。
  function classify(h, temp, rain) {
    const t = temp - 0.04 * h;
    if (h >= 3) return t < 0.3 ? 'glacier' : 'mountain';
    if ((rain > 0.66 && h === 0) || (rain > 0.74 && h === 1)) return 'lake';
    if (rain > 0.6 && h <= 1) return t < 0.48 ? 'marsh' : 'swamp';
    if (t < 0.36) return rain < 0.45 ? 'tundra' : 'taiga';
    if (t < 0.56) return rain < 0.38 ? 'grassland' : rain < 0.5 ? 'shrubland' : 'forest';
    return rain < 0.36 ? 'desert' : rain < 0.5 ? 'savanna' : 'jungle';
  }

  const STAMP_BIOMES = ['tundra', 'taiga', 'desert', 'savanna', 'jungle', 'grassland', 'forest', 'shrubland'];
  FE.STAMP_BIOMES = STAMP_BIOMES;

  // 生成器刻意粗糙：每塊世界的溫度帶一點偏差，四邊的接縫處偶爾冷熱直接相鄰；
  // 再隨手蓋上幾塊「印章」，印章跟周圍的氣候對不上就成了地形錯位；幾小塊地突然高或低 2 階，周圍就成了斷崖。
  // 已有聚落周圍的圈（含外圍的坡）不蓋印章、不突變，那裡不會長出怪物
  function paintBiomes(world, rng, r, index) {
    const W = r.x1 - r.x0;
    const H = r.y1 - r.y0;
    const rough = {
      tempOffset: index === 0 ? 0 : (rng() - 0.5) * 0.45,
      stamps: [],
      spikes: [],
    };
    const nStamps = FE.randInt(rng, C.STAMPS[0], C.STAMPS[1]);
    for (let i = 0; i < nStamps; i++) {
      rough.stamps.push({ x: r.x0 + rng() * W, y: r.y0 + rng() * H, r: 1.5 + rng() * 2, biome: FE.pick(rng, STAMP_BIOMES) });
    }
    const nSpikes = FE.randInt(rng, C.SPIKES[0], C.SPIKES[1]);
    for (let i = 0; i < nSpikes; i++) {
      rough.spikes.push({ x: r.x0 + rng() * W, y: r.y0 + rng() * H, r: 0.8 + rng() * 1.2, dh: rng() < 0.5 ? 2 : -2 });
    }
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) paintCell(world, rng, x, y, rough, world.inBuffer(x, y));
    }
    return rough;
  }

  // 這一格有沒有被印章或突變蓋到
  function roughAt(rough, x, y) {
    return rough.spikes.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r) || rough.stamps.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r);
  }

  function paintCell(world, rng, x, y, rough, clean) {
    let h = FE.heightAt(world.seed, x, y);
    const spike = !clean && rough.spikes.find((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r);
    if (spike) h = Math.max(0, Math.min(C.MAX_HEIGHT, h + spike.dh));
    const temp = valueNoise(world.seed + 101, x, y, 40) + rough.tempOffset;
    const rain = valueNoise(world.seed + 202, x, y, 22);
    let biome = classify(h, temp, rain);
    const stamp = !clean && rough.stamps.find((s) => (s.x - x) ** 2 + (s.y - y) ** 2 <= s.r * s.r);
    if (stamp && biome !== 'lake' && h < 3) biome = stamp.biome;
    const B = FE.BIOMES[biome];
    const t = rng() < B.rocks ? '#' : B.paint(rng, h);
    world.setCell(x, y, t, biome);
    world.setHeight(x, y, h);
  }

  function villageBox(cx, cy, w, h) {
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh, cx, cy };
  }

  function pickVillageName(world, rng, names) {
    const used = new Set(world.villages.map((v) => v.name));
    const free = names.filter((n) => !used.has(n));
    return free.length ? FE.pick(rng, free) : FE.pick(rng, names) + (world.villages.length + 1);
  }

  // 第 1 塊世界的村莊在出生點；之後的村莊要離最近的村莊夠遠（照實際路程算），不夠遠這塊就不蓋
  // 世界等級 3 起，每隔 4 或 5 塊世界蓋一座大城鎮（World.townDue）：比村莊大、住的人多；城鎮不受村莊間距的限制。
  // 這裡只選工作範圍（外框）的位置：靠水或靠巨石的位置加分（steading.js 的 siteScore），整平，清掉印章與突變；
  // 外牆怎麼貼著建築蓋、聚落最後多大，由 Steading.layout 決定
  function placeVillage(world, rng, r, index, rough, town) {
    const W = town ? C.TOWN_W : C.VILLAGE_W;
    const H = town ? C.TOWN_H : C.VILLAGE_H;
    const hw = Math.floor(W / 2);
    const hh = Math.floor(H / 2);
    // 村莊整個落在這塊世界裡，離邊界至少留一格
    const randomBox = () =>
      villageBox(FE.randInt(rng, r.x0 + hw + 1, r.x1 - hw - 2), FE.randInt(rng, r.y0 + hh + 1, r.y1 - hh - 2), W, H);
    let box = null;
    if (index === 0 || town) {
      let best = null;
      // 至少開得出 3 個出入口、中央沒有水的位置（分數比 -400 高）；找不到就多試幾次
      for (let tries = 0; tries < 12 || (best.score < -400 && tries < 80); tries++) {
        const cand = randomBox();
        const score = FE.Steading.siteScore(world, cand, town);
        if (!best || score > best.score) best = { box: cand, score };
      }
      box = best.box;
    } else {
      const steps = world.stepMap(world.villages.map((v) => [v.cx, v.cy]));
      let bestScore = -Infinity;
      for (let tries = 0; tries < 8; tries++) {
        const cand = randomBox();
        let d = Infinity;
        for (let y = cand.y0; y <= cand.y1; y++) {
          for (let x = cand.x0; x <= cand.x1; x++) {
            const s = steps.get(x + ',' + y);
            if (s !== undefined && s < d) d = s;
          }
        }
        if (d === Infinity) {
          // 從現有村莊走不到（中間被圍住），就用直線距離估；實際路程只會更長
          for (const v of world.villages) d = Math.min(d, Math.abs(v.cx - cand.cx) + Math.abs(v.cy - cand.cy));
        }
        if (d < C.VILLAGE_MIN_STEPS) continue;
        const score = FE.Steading.siteScore(world, cand, town);
        if (score < -400) continue; // 開不出 3 個出入口或中央有水：這個位置不蓋，寧可這塊世界沒有村莊
        if (!box || score > bestScore) {
          box = cand;
          bestScore = score;
        }
      }
    }
    if (!box) return null;
    // 工作範圍加上周圍那一圈，重畫成沒有印章、沒有突變的樣子（這塊世界裡的部分）；沒被蓋到的格子不動，水和巨石照舊
    const B = C.SETTLE_BUFFER[town ? 'town' : 'village'];
    for (let y = Math.max(r.y0, box.y0 - B); y <= Math.min(r.y1 - 1, box.y1 + B); y++) {
      for (let x = Math.max(r.x0, box.x0 - B); x <= Math.min(r.x1 - 1, box.x1 + B); x++) {
        if (roughAt(rough, x, y)) paintCell(world, rng, x, y, rough, true);
      }
    }
    // 工作範圍整平成中心的高度，外圍三圈修成坡，進出村莊不會碰到斷崖（只改高度，水和巨石與生態區照舊）。
    // 範圍裡的地形之後由聚落排版決定：聚落本身（路、建築、走道、外牆）換成聚落的地形，其餘保留原本的地形
    const vh = world.cell(box.cx, box.cy).h;
    for (let y = box.y0 - 3; y <= box.y1 + 3; y++) {
      for (let x = box.x0 - 3; x <= box.x1 + 3; x++) {
        if (!world.inBounds(x, y)) continue;
        const d = Math.max(box.x0 - x, x - box.x1, box.y0 - y, y - box.y1, 0);
        if (d === 0) {
          world.setHeight(x, y, vh);
        } else {
          const c = world.cell(x, y);
          world.setHeight(x, y, Math.max(vh - d, Math.min(vh + d, c.h)));
        }
      }
    }
    const village = Object.assign(
      { id: world.villages.length + 1, kind: town ? 'town' : 'village', name: pickVillageName(world, rng, town ? FE.TOWN_NAMES : FE.VILLAGE_NAMES) },
      box,
      { flat: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } } // 整平過的工作範圍；排版後 x0..y1 縮到外牆的外接矩形
    );
    world.villages.push(village);
    if (index === 0) world.spawn = { x: box.cx - 3, y: box.cy };
    return village;
  }

  function pickName(world, rng) {
    const used = new Set(world.npcs.map((n) => n.name));
    const free = FE.NAMES.filter((n) => !used.has(n));
    return FE.pick(rng, free.length ? free : FE.NAMES);
  }

  // 任務的路程與獎勵：送得越遠，經驗值和金幣越多
  // 給委託的聚落缺冒險者時，獎勵多五成
  FE.questReward = function (world, giver, target) {
    const steps = target ? world.pathDistance(giver, target) : 0;
    const f = FE.Steading.rewardFactor(world.villageById(giver.villageId));
    return {
      steps,
      exp: Math.round((C.QUEST_EXP + Math.floor(steps / C.QUEST_STEPS_PER_EXP)) * f),
      gold: Math.round((C.QUEST_GOLD + Math.floor(steps / C.QUEST_STEPS_PER_GOLD)) * f),
      compute: Math.round((C.COMPUTE_DELIVER + steps / C.COMPUTE_DELIVER_STEPS) * 10) / 10, // 完成時給的算力（單人份量）
    };
  };

  FE.makeQuest = function (world, rng, giver, target, ghostName) {
    const reward = FE.questReward(world, giver, target);
    const tv = target ? world.villageById(target.villageId) : world.villageById(giver.villageId);
    return {
      targetId: target ? target.id : world.nextId++,
      targetName: target ? target.name : ghostName,
      targetVillage: tv ? tv.name : '附近',
      item: FE.pick(rng, FE.ITEMS),
      line: FE.pick(rng, FE.QUEST_LINES),
      steps: reward.steps,
      exp: reward.exp,
      gold: reward.gold,
      compute: reward.compute,
      accepted: false,
      done: false,
    };
  };

  function placeNpcs(world, rng, v) {
    // 鐵匠固定站在工坊裡、貼著門內那一格；萬一沒蓋成工坊，站在廣場中央
    const si = (v.buildings || []).findIndex((b) => b.kind === 'smithy');
    const [sx, sy] = si >= 0 ? v.buildings[si].spots[0] : [v.cx, v.cy];
    world.npcs.push({ id: world.nextId++, name: pickName(world, rng), role: 'smith', villageId: v.id, x: sx, y: sy, quest: null, home: si >= 0 ? { b: si } : null });

    const candidates = [];
    const n = FE.Steading.villagerCount(rng, v);
    // 村民一開始站在聚落裡室外能走的地方（不在建築裡）
    const spots = [];
    for (let y = v.y0; y <= v.y1; y++) {
      for (let x = v.x0; x <= v.x1; x++) {
        if (world.villageAt(x, y) === v && world.passable(x, y) && FE.Steading.roomAt(v, x, y) < 0) spots.push([x, y]);
      }
    }
    for (let i = 0; i < n; i++) {
      // 粗糙：少數村民會被放到村莊外圍一圈，之後被當成放錯位置刪掉
      const edge = rng() < 0.15;
      const [sx, sy] = FE.pick(rng, spots);
      const x = edge ? FE.randInt(rng, v.x0 - 1, v.x1 + 1) : sx;
      const y = edge ? FE.pick(rng, [v.y0 - 1, v.y1 + 1]) : sy;
      const npc = { id: world.nextId++, name: pickName(world, rng), role: 'villager', villageId: v.id, x, y, quest: null };
      candidates.push(npc);
      world.npcs.push(npc); // 先暫時放進去，讓下一個候選人不會撞名
    }
    world.npcs = world.npcs.filter((o) => !candidates.includes(o));

    // 先決定每個候選人的委託對象，再刪掉站錯地方的人。
    // 順序是刻意的：被刪掉的人可能已經被別人的任務指到，留下懸空指標。
    const pool = candidates.concat(world.npcs.filter((o) => o.role !== 'smith'));
    const targets = new Map();
    for (const npc of candidates) {
      if (rng() >= 0.75) continue;
      const others = pool.filter((o) => o.id !== npc.id);
      if (others.length) targets.set(npc, FE.pick(rng, others));
    }
    const kept = [];
    for (const npc of candidates) {
      const onSpawn = world.spawn && npc.x === world.spawn.x && npc.y === world.spawn.y;
      if (world.villageAt(npc.x, npc.y) === v && world.passable(npc.x, npc.y) && !world.npcAt(npc.x, npc.y) && !onSpawn) {
        // 每個村民有自己的家（記住哪一棟、哪張床、在家時站哪一格）
        const h = FE.Steading.freeHome(world, rng, v);
        npc.home = h ? { b: h.b, bed: h.bed, spot: h.spot } : null;
        npc.mode = 'out';
        world.npcs.push(npc);
        kept.push(npc);
      }
    }
    for (const npc of kept) {
      const t = targets.get(npc);
      if (!t) continue;
      const alive = world.npcById(t.id);
      npc.quest = FE.makeQuest(world, rng, npc, alive, t.name);
      if (!alive) npc.quest.targetId = t.id; // 指向被刪掉的人
    }
  }

  // 粗糙的掉落公式：約四分之一會算出負數，少數會除以零變成 NaN
  FE.roughGold = function (rng) {
    let gold = Math.floor(25 + (rng() - 0.62) * 70);
    if (rng() < 0.08) gold = Math.floor((gold / 0) * 0);
    return gold;
  };

  // 創世時固定放幾個寶箱，拿了就沒有，不會重生
  function placeChests(world, rng, r) {
    const n = FE.randInt(rng, C.CHESTS[0], C.CHESTS[1]);
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const x = FE.randInt(rng, r.x0, r.x1 - 1);
        const y = FE.randInt(rng, r.y0, r.y1 - 1);
        if (!world.passable(x, y) || world.npcAt(x, y) || world.chestAt(x, y) || world.inVillage(x, y)) continue;
        world.chests.push({ id: world.nextId++, x, y, gold: FE.roughGold(rng) });
        break;
      }
    }
  }

  FE.World = World;
  FE.pickName = pickName;
})();
