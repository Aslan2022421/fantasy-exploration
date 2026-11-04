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
      this.nodes = [];          // 採集點（礦脈、藥草）：{ id, kind, x, y, regrowAt }，採完到 regrowAt 刻才長回來
      this.items = [];          // 地上的東西（第二十八版：擲出去的武器）：{ x, y, gear }，冒險者走過去就撿回來
      this.nextId = 1;
      this.spawn = null;
      this.debt = 0;            // 全世界負的穩定值加總的絕對值（第三十三版之三：負的穩定值就是 BUG 值）；setStab 跟著增減，存檔讀回來時重算
      this.calm = [];           // 清掉怪物的地點：{ x, y, r, until }，到 until（刻）之前區內不生怪物（第三十二版）
      this.camps = [];          // 營地：{ id（帶頭那隻的群）, kind（FE.CAMPS）, x, y, origin（campaign 戰役、disorder 失序）}（第三十三版之二）
      this.campaigns = {};      // 還沒清光的戰役：段的索引 → { seg, place, day, content }（清光時寫進歷史紀錄）
      this.remnants = [];       // 遺留地點：失序的營地清掉後留下的 { kind, x, y, day }（第三十三版之二）
      this.nextTownAt = null;   // 下一座大城鎮蓋在第幾段（創世順序，從 0 算）；null 是還沒蓋過，看世界等級
      this.regions = 0;         // 第三十二版：創過幾段（開局那一大塊算第 0 段）
      this.ringsDone = 0;       // 長滿了幾圈（開局不算）；世界等級＝1＋ringsDone
      this.passes = [];         // 第三十四版：隘口 { x, y, normal, gap, ring, side, len, lake, fort }（fort 是守這裡的堡壘或要塞的 id）
      this.passPlan = {};       // 每圈的隘口排在哪幾邊：圈數 → [{ side, fort }]（用種子和圈數算，讀檔後算出一樣的）
    }

    // 創出第 index 段時要不要蓋大城鎮：世界等級到 TOWN_FIRST_LEVEL 才開始，第一座在世界等級剛好達到的那一段，之後每隔 4 或 5 段一座
    townDue(index) {
      if (1 + this.ringsDone < C.TOWN_FIRST_LEVEL) return false;
      return this.nextTownAt == null || index >= this.nextTownAt;
    }

    // ---- 第三十二版：一圈一圈往外長 ----
    // 第 r 圈（開局是第 0 圈）的小塊座標範圍 [lo, hi]
    ringRange(r) {
      const h = C.START_SPAN / 2;
      return [-h - r, h - 1 + r];
    }
    // 下一段：還沒長滿的最內圈裡，上下左右四邊中還有小塊沒長出來、離 (x, y) 最近的那一邊（只回傳還沒長出來的小塊）；長滿 RING_MAX 圈就是 null
    nextSegment(x, y) {
      const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
      for (let r = 1; r <= C.RING_MAX; r++) {
        const [lo, hi] = this.ringRange(r);
        const sides = [
          ['top', span(lo, hi).map((cx) => [cx, lo]), [0, -1]],
          ['bottom', span(lo, hi).map((cx) => [cx, hi]), [0, 1]],
          ['left', span(lo + 1, hi - 1).map((cy) => [lo, cy]), [-1, 0]],
          ['right', span(lo + 1, hi - 1).map((cy) => [hi, cy]), [1, 0]],
        ];
        let best = null;
        for (const [side, blocks, out] of sides) {
          const missing = blocks.filter(([cx, cy]) => !this.hasChunk(cx, cy));
          if (!missing.length) continue;
          let d = Infinity;
          for (const [cx, cy] of missing) {
            const nx = Math.max(cx * C.CHUNK_W, Math.min(x, (cx + 1) * C.CHUNK_W - 1));
            const ny = Math.max(cy * C.CHUNK_H, Math.min(y, (cy + 1) * C.CHUNK_H - 1));
            d = Math.min(d, Math.abs(nx - x) + Math.abs(ny - y));
          }
          if (!best || d < best.d) best = { side, ring: r, blocks: missing, out, d };
        }
        if (best) return best;
      }
      return null;
    }
    // 長滿了幾圈：從裡往外數，整圈的小塊都在才算
    countRings() {
      let n = 0;
      for (let r = 1; r <= C.RING_MAX; r++) {
        const [lo, hi] = this.ringRange(r);
        for (let c = lo; c <= hi; c++) {
          if (![[c, lo], [c, hi], [lo, c], [hi, c]].every(([cx, cy]) => this.hasChunk(cx, cy))) return n;
        }
        n = r;
      }
      return n;
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
    // ch.ver 是這塊區塊「走得過去的格子或高度」的版本：變了，checker.js 的連通性（reachable）就只重算這一塊
    setCell(x, y, t, biome) {
      const ch = this.chunkAt(x, y);
      const old = ch.cells[y - ch.y0][x - ch.x0];
      ch.cells[y - ch.y0][x - ch.x0] = { t, biome, h: old ? old.h : 0 };
      if (!old || FE.TERRAIN[old.t].pass !== FE.TERRAIN[t].pass) ch.ver++;
    }
    setHeight(x, y, h) {
      const c = this.cell(x, y);
      if (c.h === h) return;
      c.h = h;
      this.chunkAt(x, y).ver++;
    }
    // ---- 穩定值（第三十三版之三）----
    // 每格有一個穩定值，存在區塊的 ch.stab（Int16Array，一列接一列）。正的不生怪物，負的生怪物，負的量就是 BUG 值（跟 FE.blockValue 同一個單位）。
    // 起始值看世界種子和座標（FE.stabilityAt，純函數雜訊，不碰任何亂數）；之後每小時往下掉、怪物踩過會減、修補與清掉怪物會補。
    // ch.debt、world.debt 是負值的絕對值加總，setStab 順手維護，不用每次把全世界掃一遍
    stab(x, y) {
      const ch = this.chunkAt(x, y);
      return ch ? ch.stab[(y - ch.y0) * C.CHUNK_W + (x - ch.x0)] : 0;
    }
    setStab(x, y, v) {
      const ch = this.chunkAt(x, y);
      if (!ch) return;
      const i = (y - ch.y0) * C.CHUNK_W + (x - ch.x0);
      v = Math.max(-C.STAB_LIMIT, Math.min(C.STAB_LIMIT, Math.round(v)));
      const old = ch.stab[i];
      if (old === v) return;
      const d = Math.max(0, -v) - Math.max(0, -old);
      ch.stab[i] = v;
      ch.debt += d;
      this.debt += d;
    }
    addStab(x, y, d) {
      this.setStab(x, y, this.stab(x, y) + d);
    }
    // 欠 n 點：從 0 起算往下扣（原本的正值蓋掉），所以全世界負值的加總剛好多 n
    addDebt(x, y, n) {
      this.setStab(x, y, Math.min(0, this.stab(x, y)) - n);
    }
    // 這一格補回起始值
    resetStab(x, y) {
      this.setStab(x, y, FE.stabilityAt(this.seed, x, y));
    }
    // 重新數全世界欠多少（讀檔用）
    recountDebt() {
      this.debt = 0;
      for (const ch of this.chunks) {
        ch.debt = 0;
        for (let i = 0; i < ch.stab.length; i++) if (ch.stab[i] < 0) ch.debt -= ch.stab[i];
        this.debt += ch.debt;
      }
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
    // 下一段的外接矩形（小地圖畫紫色虛線框用）；長滿了是 null
    nextSegmentRect(x, y) {
      const seg = this.nextSegment(x, y);
      if (!seg) return null;
      return blocksRect(seg.blocks);
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
    // 這一格地上的東西（擲出去的武器）
    itemsAt(x, y) {
      return this.items.filter((it) => it.x === x && it.y === y);
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
    // 圈裡不生怪物、穩定值不往下掉，怪物也不能踏進來。先用外接矩形加寬度快速排除，再查 mask 膨脹出來的格子
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

    // 從起點們走到每一格要幾步（只走能走的格子）；給了 target（"x,y"）就走到那裡為止；給了 limit 就只走到 limit 步為止（再遠的格子不記）
    stepMap(starts, target, limit) {
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
        if (limit !== undefined && d >= limit) continue;
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

    // 跟 stepMap 一樣，從起點們往外走，只走到 limit 步為止，但用陣列記步數（快很多）。回傳 { at(x, y) }：走到的格子是步數，沒走到是 -1
    stepGrid(starts, limit) {
      const b = this.bounds();
      const W = b.x1 - b.x0;
      const H = b.y1 - b.y0;
      const dist = new Int16Array(W * H).fill(-1);
      const q = new Int32Array(W * H);
      let qt = 0;
      for (const [x, y] of starts) {
        if (!this.passable(x, y)) continue;
        dist[(y - b.y0) * W + (x - b.x0)] = 0;
        q[qt++] = (y - b.y0) * W + (x - b.x0);
      }
      for (let qh = 0; qh < qt; qh++) {
        const i = q[qh];
        const d = dist[i];
        if (d >= limit) continue;
        const x = b.x0 + (i % W);
        const y = b.y0 + Math.floor(i / W);
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < b.x0 || nx >= b.x1 || ny < b.y0 || ny >= b.y1) continue;
          const j = (ny - b.y0) * W + (nx - b.x0);
          if (dist[j] >= 0 || !this.canStep(x, y, nx, ny)) continue;
          dist[j] = d + 1;
          q[qt++] = j;
        }
      }
      return { at: (x, y) => (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1 ? -1 : dist[(y - b.y0) * W + (x - b.x0)]) };
    }

    // 兩點之間的實際路程；走不到時用直線距離乘 1.5 估。
    // 第二十五版起不再把世界一格一格全走一遍：先用 Checker.reachable 的連通塊看兩點走不走得到（走不到直接估），
    // 走得到再用 A*（直線距離當估價）找最短路，步數跟原本一格一格走的結果一樣
    pathDistance(a, b) {
      const est = () => Math.round((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * 1.5);
      if (!this.passable(a.x, a.y) || !this.passable(b.x, b.y)) return est();
      if (a.x === b.x && a.y === b.y) return 0;
      const reach = FE.Checker.reachable(this);
      const ra = reach.rootAt(a.x, a.y);
      if (ra < 0 || ra !== reach.rootAt(b.x, b.y)) return est();
      const d = this.shortestSteps(a, b);
      return d !== null ? d : est();
    }

    // A* 找 a 走到 b 最少幾步（b 一定走得到，呼叫前要確認連通）
    shortestSteps(a, b) {
      const OFF = 1048576;
      const MUL = 2097152;
      const key = (x, y) => (x + OFF) * MUL + (y + OFF);
      const h = (x, y) => Math.abs(x - b.x) + Math.abs(y - b.y);
      const best = new Map([[key(a.x, a.y), 0]]);
      const heap = [[h(a.x, a.y), 0, a.x, a.y]];
      const push = (it) => {
        let i = heap.push(it) - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[p], heap[i]] = [heap[i], heap[p]];
          i = p;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top;
      };
      while (heap.length) {
        const [, g, x, y] = pop();
        if (x === b.x && y === b.y) return g;
        if (g > best.get(key(x, y))) continue;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.canStep(x, y, nx, ny)) continue;
          const nk = key(nx, ny);
          const old = best.get(nk);
          if (old === undefined || g + 1 < old) {
            best.set(nk, g + 1);
            push([g + 1 + h(nx, ny), g + 1, nx, ny]);
          }
        }
      }
      return null;
    }

    // 創出一個 24×24 的小塊（只有地形：生態區、高度、湖），回傳小塊；這塊的溫度偏差記在 ch.rough
    addBlock(cx, cy) {
      const index = this.chunks.length;
      // 小塊的亂數只看世界種子和小塊座標，跟創世順序無關
      const rng = FE.makeRng(Math.floor(hash(this.seed, cx * 7919 + 13, cy * 104729 + 7) * 4294967296));
      const rect = { x0: cx * C.CHUNK_W, y0: cy * C.CHUNK_H, x1: (cx + 1) * C.CHUNK_W, y1: (cy + 1) * C.CHUNK_H };
      const cells = [];
      for (let y = rect.y0; y < rect.y1; y++) {
        const row = [];
        for (let x = rect.x0; x < rect.x1; x++) row.push({ t: '.', biome: 'plain', h: 0 });
        cells.push(row);
      }
      const chunk = Object.assign({ index, cx, cy, cells, ver: 0, stab: new Int16Array(C.CHUNK_W * C.CHUNK_H), debt: 0 }, rect);
      for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) chunk.stab[(y - rect.y0) * C.CHUNK_W + (x - rect.x0)] = FE.stabilityAt(this.seed, x, y);
      this.chunkMap.set(cx + ',' + cy, chunk);
      this.chunks.push(chunk);
      chunk.rough = paintBiomes(this, rng, rect, this.regions === 0 ? 0 : index);
      return chunk;
    }

    // 收回一個小塊（預留選址時暫時長出來、沒用到的）
    removeBlock(ch) {
      this.debt -= ch.debt; // 暫時長出來的小塊還沒人動過穩定值，ch.debt 是 0；保險起見照扣
      this.chunkMap.delete(ch.cx + ',' + ch.cy);
      this.chunks.splice(this.chunks.indexOf(ch), 1);
      this.chunks.forEach((c, i) => { c.index = i; });
      this._lastChunk = null;
      this._reach = null;
    }

    // 創出一段新世界：seg 是 nextSegment 的結果，沒給就是開局的 4×4 塊（96×96）。回傳 { index, rect, village, landmark }，rect 是這一段（含預留的小塊）的外接矩形。
    // 一段裡最多蓋一座聚落：開局的聚落在正中間，兩側各放一個興趣點（照《奇幻探索物語 Quest》的「地區」）；
    // 之後的聚落可以伸進下一圈還沒長出來的地方（預留）：那幾個小塊這一段就先長出來，之後長到那一圈時跳過
    addRegion(seg) {
      const index = this.regions;
      const first = !seg;
      const [lo, hi] = this.ringRange(0);
      const blocks = first ? [] : seg.blocks.slice();
      if (first) for (let cy = lo; cy <= hi; cy++) for (let cx = lo; cx <= hi; cx++) blocks.push([cx, cy]);
      const made = blocks.map(([cx, cy]) => this.addBlock(cx, cy));
      // 一段的亂數看世界種子和第一個小塊
      const rng = FE.makeRng(Math.floor(hash(this.seed, blocks[0][0] * 6151 + 101 + index, blocks[0][1] * 3571 + 17) * 4294967296));
      let rect = blocksRect(blocks);
      // 聚落選址的範圍：開局是整塊；之後是這一段，再往外多一圈（預留），最外圈就不往外
      let area = rect;
      if (!first && seg.ring < C.RING_MAX) {
        const [ox, oy] = seg.out;
        area = {
          x0: rect.x0 + Math.min(0, ox) * C.CHUNK_W,
          y0: rect.y0 + Math.min(0, oy) * C.CHUNK_H,
          x1: rect.x1 + Math.max(0, ox) * C.CHUNK_W,
          y1: rect.y1 + Math.max(0, oy) * C.CHUNK_H,
        };
      }
      const town = this.townDue(index);
      // 預留：選址前先把往外那一圈暫時長出來（選址要看得到那裡的水和巨石），選完只留聚落用到的小塊，其他的收回去；
      // 地形只看種子和小塊座標，之後長到那一圈時會長出一模一樣的
      const temp = [];
      if (area !== rect) {
        for (let cy = area.y0 / C.CHUNK_H; cy < area.y1 / C.CHUNK_H; cy++) {
          for (let cx = area.x0 / C.CHUNK_W; cx < area.x1 / C.CHUNK_W; cx++) if (!this.hasChunk(cx, cy) && inRing(this, cx, cy)) temp.push(this.addBlock(cx, cy));
        }
      }
      const village = placeVillage(this, rng, area, first, town, made, temp);
      for (const ch of temp) if (!made.includes(ch)) this.removeBlock(ch);
      let landmark = null;
      const landmarks = [];
      if (village) Object.assign(village, { region: index, wl: 1 + this.ringsDone }); // 第幾段蓋的、當時的世界等級
      if (village && village.kind === 'town') this.nextTownAt = index + (rng() < 0.5 ? C.TOWN_GAP[0] : C.TOWN_GAP[1]);
      if (village) {
        rect = blocksRect(made.map((c) => [c.cx, c.cy]));
        FE.Steading.roll(this, rng, village);
        FE.Steading.layout(this, rng, village);
        // 出生點放在離預定位置最近的路上（排版可能在原本那一格蓋了房子）
        if (first) {
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
          // 兩個興趣點，分在聚落的兩側（照《奇幻探索物語 Quest》的「地區」：起始地點在兩個興趣點之間）。
          // 一個看聚落是什麼（有法師是法師塔、神聖的是聖所、靠鐵礦或石材維生是礦坑，其餘從中性的地貌挑），另一個從中性的地貌挑
          const kTag = FE.Steading.landmarkKind(rng, village);
          const kFree = FE.pick(rng, FE.Steading.NEUTRAL_LANDMARKS.filter((k) => k !== kTag));
          const [kw, ke] = rng() < 0.5 ? [kTag, kFree] : [kFree, kTag];
          for (const [kind, side] of [[kw, 'west'], [ke, 'east']]) {
            const lm = FE.Steading.placeLandmark(this, rng, rect, village, { kind, side });
            if (lm) landmarks.push(lm);
          }
        } else {
          landmark = FE.Steading.placeLandmark(this, rng, rect, village);
          if (landmark) landmarks.push(landmark);
        }
        placeNpcs(this, rng, village);
      }
      // 第三十四版：這一圈輪到這一邊時留一處隘口；聚落的出口確認走得出去（被擋就鋪路打通）
      if (!first) placePass(this, rng, seg);
      if (village) openExits(this, village);
      // 先前的段放在預留小塊上的採集點，可能被這一段的聚落蓋到：落進聚落或已經不能走的收掉
      this.nodes = this.nodes.filter((n) => this.passable(n.x, n.y) && !this.inVillage(n.x, n.y));
      // 採集點先放，寶箱再避開礦脈放進地貌裡
      placeNodes(this, rng, rect, landmarks);
      for (const lm of landmarks) placeChests(this, rng, lm);
      this.regions++;
      this.ringsDone = this.countRings();
      return { index, rect, village, landmark: landmarks[0] || null, landmarks };
    }
  }

  // 一串小塊的外接矩形（右、下不含）
  function blocksRect(blocks) {
    const xs = blocks.map((b) => b[0]);
    const ys = blocks.map((b) => b[1]);
    return { x0: Math.min(...xs) * C.CHUNK_W, y0: Math.min(...ys) * C.CHUNK_H, x1: (Math.max(...xs) + 1) * C.CHUNK_W, y1: (Math.max(...ys) + 1) * C.CHUNK_H };
  }

  FE.inRect = (r, x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  // ---- 高度：參考矮人要塞的上下坡 ----
  // 第三十四版：高度（0～4）由三層疊起來，整個世界連續，跨區塊也接得上（只看種子和座標）：
  //   丘陵：大尺度的雜訊，低的地方是平地（0），高的地方隆起 1～2 層；
  //   山脈：脊狀雜訊（1 - |2n - 1|，雜訊剛好在中間值的那條線最高），細長成條，再用另一張雜訊切成一段一段；
  //   湖：濕又低的地方（見 lakeScore），湖裡壓成 0。
  // 疊完取整數，再把每一格壓到「不比任何鄰格高出 1 以上」（往下削，不往上墊），所以相鄰兩格最多差 1，全是坡、沒有斷崖。
  // 削的時候只看 MAX_HEIGHT 格以內（高度最多差 MAX_HEIGHT，更遠的格子影響不到），所以每一格的結果只看附近的種子雜訊
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

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // 還沒削之前的連續高度（0 起，可以超過 MAX_HEIGHT）
  function rawHeight(seed, x, y) {
    const hill = clamp01((valueNoise(seed, x, y, C.HILL_SCALE) - C.HILL_FLOOR) / (1 - C.HILL_FLOOR));
    const n = 0.7 * valueNoise(seed + 11, x, y, C.RANGE_SCALE) + 0.3 * valueNoise(seed + 12, x, y, C.RANGE_SCALE / 2);
    const ridge = 1 - Math.abs(2 * n - 1);
    const m = clamp01((ridge - C.RANGE_CUT) / (1 - C.RANGE_CUT));
    const cut = clamp01((valueNoise(seed + 13, x, y, C.RANGE_SCALE * 1.5) - C.RANGE_MASK[0]) / (C.RANGE_MASK[1] - C.RANGE_MASK[0]));
    return C.HILL_AMP * hill + C.RANGE_AMP * m * cut;
  }
  // 湖的分數：大尺度的濕度（跟雨量那張圖混一點，湖邊比較會是沼澤），越高的地方扣越多。分數超過 LAKE_CUT 就是湖
  function lakeScore(seed, x, y, raw) {
    const wet = 0.75 * valueNoise(seed + 505, x, y, C.LAKE_SCALE) + 0.25 * valueNoise(seed + 202, x, y, 22);
    return wet - C.LAKE_H_WEIGHT * raw;
  }

  // 一塊範圍（右、下不含）的高度與湖：回傳 { h(x, y), lake(x, y) }。往外多算 MAX_HEIGHT 格，削坡才算得準
  FE.heightGrid = function (seed, r) {
    const P = C.MAX_HEIGHT;
    const x0 = r.x0 - P;
    const y0 = r.y0 - P;
    const W = r.x1 - r.x0 + 2 * P;
    const H = r.y1 - r.y0 + 2 * P;
    const h = new Int8Array(W * H);
    const lake = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const raw = rawHeight(seed, x0 + i, y0 + j);
        const k = j * W + i;
        if (lakeScore(seed, x0 + i, y0 + j, raw) > C.LAKE_CUT) {
          lake[k] = 1;
          h[k] = 0;
        } else h[k] = Math.max(0, Math.min(C.MAX_HEIGHT, Math.floor(raw)));
      }
    }
    // 削坡：往右下掃一次、往左上掃一次，每格不比上下左右的鄰格高出 1 以上（兩次掃完就是最低的那個合格的高度）
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (i > 0) h[k] = Math.min(h[k], h[k - 1] + 1);
        if (j > 0) h[k] = Math.min(h[k], h[k - W] + 1);
      }
    }
    for (let j = H - 1; j >= 0; j--) {
      for (let i = W - 1; i >= 0; i--) {
        const k = j * W + i;
        if (i < W - 1) h[k] = Math.min(h[k], h[k + 1] + 1);
        if (j < H - 1) h[k] = Math.min(h[k], h[k + W] + 1);
      }
    }
    const at = (x, y) => (y - y0) * W + (x - x0);
    return { h: (x, y) => h[at(x, y)], lake: (x, y) => lake[at(x, y)] === 1 };
  };

  FE.heightAt = function (seed, x, y) {
    return FE.heightGrid(seed, { x0: x, y0: y, x1: x + 1, y1: y + 1 }).h(x, y);
  };

  // 起始穩定值（第三十三版之三）：平均 240，成片起伏在 120～360 之間。純函數雜訊（世界種子＋座標），
  // 不從 game.rng 或生成用的亂數取數字，所以基本生成的亂數序列不受影響；大尺度（16 格）為主、小尺度（7 格）為輔，
  // 兩層值雜訊疊起來的分佈集中在中間，乘 STAB_STRETCH 拉開後夾在範圍內，才有接近 120 與 360 的地方
  FE.stabilityAt = function (seed, x, y) {
    const n = 0.65 * valueNoise(seed + 303, x, y, 16) + 0.35 * valueNoise(seed + 404, x, y, 7);
    const t = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * C.STAB_STRETCH));
    return Math.round(C.STAB_RANGE[0] + (C.STAB_RANGE[1] - C.STAB_RANGE[0]) * t);
  };

  // ---- 氣候與生態區：參考矮人要塞，用海拔、溫度、雨量三張圖疊起來決定 ----
  // 溫度和雨量也是平滑的雜訊（尺度比高度大），越高的地方越冷。湖不在這裡決定（第三十四版：看 heightGrid 的 lake）
  function classify(h, temp, rain) {
    const t = temp - 0.04 * h;
    if (h >= 3) return t < C.GLACIER_TEMP ? 'glacier' : 'mountain';
    if (rain > C.MARSH_RAIN && h <= C.MARSH_MAXH) return t < 0.48 ? 'marsh' : 'swamp';
    if (t < 0.36) return rain < 0.45 ? 'tundra' : 'taiga';
    if (t < 0.56) return rain < 0.38 ? 'grassland' : rain < 0.5 ? 'shrubland' : 'forest';
    return rain < 0.36 ? 'desert' : rain < 0.5 ? 'savanna' : 'jungle';
  }

  const STAMP_BIOMES = ['tundra', 'taiga', 'desert', 'savanna', 'jungle', 'grassland', 'forest', 'shrubland'];
  FE.STAMP_BIOMES = STAMP_BIOMES;

  // 生成器刻意粗糙：每塊世界的溫度帶一點偏差，四邊的接縫處偶爾冷熱直接相鄰。
  // 第三十四版：拿掉隨手蓋的氣候印章與高度突變（斷崖的來源）；rough 只剩溫度偏差
  function paintBiomes(world, rng, r, index) {
    const rough = { tempOffset: index === 0 ? 0 : (rng() - 0.5) * 0.45 };
    const grid = FE.heightGrid(world.seed, r);
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const h = grid.h(x, y);
        const temp = valueNoise(world.seed + 101, x, y, 40) + rough.tempOffset;
        const rain = valueNoise(world.seed + 202, x, y, 22);
        const biome = grid.lake(x, y) ? 'lake' : classify(h, temp, rain);
        const B = FE.BIOMES[biome];
        const t = rng() < B.rocks * C.ROCKS_MUL ? '#' : B.paint(rng, h);
        world.setCell(x, y, t, biome);
        world.setHeight(x, y, h);
      }
    }
    return rough;
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
  function placeVillage(world, rng, r, first, town, made, temp) {
    const W = town ? C.TOWN_W : C.VILLAGE_W;
    const H = town ? C.TOWN_H : C.VILLAGE_H;
    const hw = Math.floor(W / 2);
    const hh = Math.floor(H / 2);
    // 村莊整個落在這塊世界裡，離邊界至少留一格
    const randomBox = () =>
      villageBox(FE.randInt(rng, r.x0 + hw + 1, r.x1 - hw - 2), FE.randInt(rng, r.y0 + hh + 1, r.y1 - hh - 2), W, H);
    let box = null;
    if (first || town) {
      let best = null;
      // 至少開得出 3 個出入口、中央沒有水的位置（分數比 -400 高）；找不到就多試幾次
      for (let tries = 0; tries < 12 || ((!best || best.score < -400) && tries < 80); tries++) {
        // 開局的聚落在正中間（照《奇幻探索物語 Quest》：起始地點在地區的中間），只在中央 ±8 格裡挑
        const cand = first ? villageBox(FE.randInt(rng, (r.x0 + r.x1) / 2 - 8, (r.x0 + r.x1) / 2 + 8), FE.randInt(rng, (r.y0 + r.y1) / 2 - 8, (r.y0 + r.y1) / 2 + 8), W, H) : randomBox();
        if (!first && !boxReady(world, cand, town)) continue;
        const score = FE.Steading.siteScore(world, cand, town);
        if (!best || score > best.score) best = { box: cand, score };
      }
      box = best ? best.box : null;
    } else {
      // 只需要知道「是不是不到 VILLAGE_MIN_STEPS 步」，所以從現有村莊只往外走到 VILLAGE_MIN_STEPS - 1 步（第二十五版，不再把整個世界走一遍）；
      // 範圍內一格都沒走到的位置，要分清是「很遠」還是「從現有村莊走不到」（中間被圍住）：後者才用直線距離估，
      // 由 Checker.reachable 的連通塊判斷（候選位置的格子跟某個村莊中央在同一個連通塊，就是走得到、而且夠遠）
      const steps = world.stepGrid(world.villages.map((v) => [v.cx, v.cy]), C.VILLAGE_MIN_STEPS - 1);
      const reach = FE.Checker.reachable(world);
      const villageRoots = new Set(world.villages.map((v) => reach.rootAt(v.cx, v.cy)).filter((r) => r >= 0));
      let bestScore = -Infinity;
      for (let tries = 0; tries < 8; tries++) {
        const cand = randomBox();
        if (!boxReady(world, cand, town)) continue;
        let d = Infinity;
        let linked = false;
        for (let y = cand.y0; y <= cand.y1; y++) {
          for (let x = cand.x0; x <= cand.x1; x++) {
            const s = steps.at(x, y);
            if (s >= 0 && s < d) d = s;
            if (!linked && villageRoots.has(reach.rootAt(x, y))) linked = true;
          }
        }
        if (d === Infinity && linked) d = C.VILLAGE_MIN_STEPS; // 走得到，但超過 VILLAGE_MIN_STEPS - 1 步，夠遠
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
    const B = C.SETTLE_BUFFER[town ? 'town' : 'village'];
    // 預留（第三十二版）：聚落連同周圍那一圈與外圍三圈坡伸進還沒長出來的小塊，那幾塊現在就長出來（算在這一段裡）
    const m = B + 3;
    for (let cy = Math.floor((box.y0 - m) / C.CHUNK_H); cy <= Math.floor((box.y1 + m) / C.CHUNK_H); cy++) {
      for (let cx = Math.floor((box.x0 - m) / C.CHUNK_W); cx <= Math.floor((box.x1 + m) / C.CHUNK_W); cx++) {
        const ch = world.chunkMap.get(cx + ',' + cy);
        if (ch && temp && temp.includes(ch) && !made.includes(ch)) made.push(ch); // 暫時長出來的小塊，聚落用到了就留下
        else if (!ch && inRing(world, cx, cy)) made.push(world.addBlock(cx, cy));
      }
    }
    // 第三十四版：村莊背後刻意擺一片湖或山壁（城鎮四通八達，不擺）
    const backdrop = !town && rng() < C.BACKDROP_RATE ? placeBackdrop(world, rng, box) : null;
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
      { flat: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }, backdrop } // 整平過的工作範圍；排版後 x0..y1 縮到外牆的外接矩形
    );
    world.villages.push(village);
    if (first) world.spawn = { x: box.cx - 3, y: box.cy };
    return village;
  }

  // ---- 第三十四版：刻意放的湖與山壁 ----
  // 先前的段放的採集點不能被蓋掉（不然會變成長在湖裡、山壁裡）
  const nodeAt = (world, x, y) => world.nodes.some((n) => n.x === x && n.y === y);
  // 村莊背後：南或北其中一側（拿掉那一側後還開得出 3 個出入口），離工作範圍 BACKDROP_GAP 格外，沿著那一側擺一長條湖或山壁。
  // 厚度隨位置起伏（湖 2～5 格、山壁 2～3 格），兩端收窄。擺了之後那一側開不出出入口，排版自然開東、西加另一側。回傳 'lake'、'wall' 或 null
  function placeBackdrop(world, rng, box) {
    const viable = FE.Steading.exitViable(world, box); // 順序同 DIRS：東、西、南、北
    const open = viable.filter(Boolean).length;
    const sides = [2, 3].filter((i) => viable[i] && open - 1 >= 3);
    if (!sides.length) return null;
    const dy = DIRS[FE.pick(rng, sides)][1];
    const lake = rng() < C.BACKDROP_LAKE;
    const edge = dy > 0 ? box.y1 : box.y0;
    const phase = rng() * 6;
    const xa = box.x0 + 2;
    const xb = box.x1 - 2;
    for (let x = xa; x <= xb; x++) {
      const end = Math.min(x - xa, xb - x); // 離兩端幾格
      let th = lake ? 3.5 + 1.5 * Math.sin((x - xa) / 4 + phase) : 2.5 + 0.6 * Math.sin((x - xa) / 3 + phase);
      th = Math.max(1, Math.round(Math.min(th, 1 + end)));
      for (let k = 0; k < th; k++) {
        const y = edge + dy * (C.BACKDROP_GAP + 1 + k);
        const c = world.cell(x, y);
        if (!c || world.inVillage(x, y) || world.landmarkAt(x, y) || nodeAt(world, x, y)) continue;
        world.setCell(x, y, lake ? '≈' : '█', lake ? 'lake' : c.biome);
      }
    }
    return lake ? 'lake' : 'wall';
  }

  // 隘口：每圈刻意留 PASS_PER_RING 處，那一圈第一次長的時候用種子和圈數決定落在哪幾邊（world.passPlan），長那一邊時放。
  // 一處隘口是沿著這一圈方向的一道山壁（另一側有 PASS_LAKE 的機率是湖），長 PASS_LEN、中間留 PASS_GAP 格的窄路，
  // 擺在這一段的帶子中間（離內外兩邊各 8 格以上），彎曲起伏 ±2 格；不碰聚落周圍的圈、地貌、路與出生點，窄路和兩頭各 4 格要能走。
  // 放不下（試 40 次）就記一次 passMiss
  function placePass(world, rng, seg) {
    if (!world.passPlan[seg.ring]) {
      const pr = FE.makeRng(Math.floor(hash(world.seed, seg.ring * 31 + 5, 77) * 4294967296));
      const k = FE.randInt(pr, C.PASS_PER_RING[0], C.PASS_PER_RING[1]);
      const sides = ['top', 'bottom', 'left', 'right'];
      for (let i = sides.length - 1; i > 0; i--) {
        const j = Math.floor(pr() * (i + 1));
        [sides[i], sides[j]] = [sides[j], sides[i]];
      }
      world.passPlan[seg.ring] = sides.slice(0, k);
    }
    if (!world.passPlan[seg.ring].includes(seg.side)) return null;
    const r = blocksRect(seg.blocks);
    const horiz = seg.side === 'top' || seg.side === 'bottom'; // 山壁沿 x 走（上下兩邊）或沿 y 走（左右兩邊）
    const [a0, a1] = horiz ? [r.x0, r.x1] : [r.y0, r.y1];
    const [b0, b1] = horiz ? [r.y0, r.y1] : [r.x0, r.x1];
    const at = (a, b) => (horiz ? [a, b] : [b, a]);
    const s = world.spawn;
    for (let tries = 0; tries < 40; tries++) {
      const L = FE.randInt(rng, C.PASS_LEN[0], C.PASS_LEN[1]);
      if (a1 - a0 < L + 6) break;
      const start = FE.randInt(rng, a0 + 3, a1 - L - 3);
      const base = FE.randInt(rng, b0 + 8, b1 - 9);
      const phase = rng() * 6;
      const lakeSide = rng() < C.PASS_LAKE ? (rng() < 0.5 ? 0 : 1) : -1; // 哪一側是湖（-1 是兩側都是山壁）
      const mid = start + Math.floor(L / 2);
      const g0 = mid - Math.floor(C.PASS_GAP / 2);
      const g1 = g0 + C.PASS_GAP - 1;
      const off = (a) => Math.round(2 * Math.sin((a - start) / 7 + phase));
      const walls = [];
      const lakes = [];
      const gap = [];
      const probe = [];
      for (let a = start; a < start + L; a++) {
        const b = base + off(a);
        if (a >= g0 && a <= g1) {
          for (let k = -4; k <= 5; k++) (k === 0 || k === 1 ? gap : probe).push(at(a, b + k));
          continue;
        }
        const lake = lakeSide === (a < g0 ? 0 : 1);
        const far = Math.min(Math.abs(a - g0), Math.abs(a - g1)); // 湖離窄路越遠越寬
        const th = lake ? Math.min(5, 2 + Math.floor(far / 6)) : 2;
        const lo = lake ? 1 - Math.floor((th - 2) / 2) : 0;
        for (let k = lo; k < lo + th; k++) (lake ? lakes : walls).push(at(a, b + k));
      }
      const all = walls.concat(lakes, gap, probe);
      const bad = (x, y) => {
        const c = world.cell(x, y);
        return !c || world.inBuffer(x, y) || world.landmarkAt(x, y) || nodeAt(world, x, y) || c.t === '·' || (s && Math.abs(s.x - x) + Math.abs(s.y - y) < 6);
      };
      if (all.some(([x, y]) => bad(x, y))) continue;
      if (gap.concat(probe).some(([x, y]) => world.cell(x, y).t === '≈')) continue; // 窄路和兩頭不開在原本的湖裡
      for (const [x, y] of walls) world.setCell(x, y, '█', world.cell(x, y).biome);
      for (const [x, y] of lakes) world.setCell(x, y, '≈', 'lake');
      // 窄路一定能走：原本是巨石的換成空地
      for (const [x, y] of gap) if (!world.passable(x, y)) world.setCell(x, y, '.', world.cell(x, y).biome);
      const gx = Math.floor((g0 + g1) / 2);
      const [px, py] = at(gx, base + off(gx));
      const p = { x: px, y: py, normal: horiz ? [0, 1] : [1, 0], gap: gap.slice(), ring: seg.ring, side: seg.side, len: L, lake: lakeSide >= 0 };
      world.passes.push(p);
      return p;
    }
    world.passMiss = (world.passMiss || 0) + 1;
    return null;
  }

  // 聚落出口一定走得出去：從每個出入口外面那條路的盡頭（工作範圍外三格），不穿過聚落，要走得到離聚落外框 SETTLE_BUFFER＋3 格以外
  // （或還沒長出來的地方）。走不出去就從盡頭沿著出口方向直直鋪路（· ，擋路的格子換掉），鋪到走得出去為止，最多 40 格。
  // 第三十四版（使用者定的）：出口不朝湖開（排版時 exitViable 已經避開），這裡也不把湖面鋪成路，碰到水就停。打通了幾個記在 v.exitFixed
  function openExits(world, v) {
    const D = world.bufferWidth(v) + 3;
    const f = v.flat;
    const outOk = (starts) => {
      const seen = new Set(starts.map(([x, y]) => x + ',' + y));
      const q = starts.filter(([x, y]) => world.passable(x, y));
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h];
        if (Math.max(v.x0 - x, x - v.x1, v.y0 - y, y - v.y1) >= D) return true;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const k = nx + ',' + ny;
          if (seen.has(k)) continue;
          if (!world.cell(nx, ny)) return true;
          if (world.villageAt(nx, ny) === v || !world.canStep(x, y, nx, ny)) continue;
          seen.add(k);
          q.push([nx, ny]);
        }
      }
      return false;
    };
    v.exitFixed = 0;
    for (const [dx, dy] of v.exitDirs || []) {
      const ex = dx > 0 ? f.x1 + 3 : dx < 0 ? f.x0 - 3 : v.cx;
      const ey = dy > 0 ? f.y1 + 3 : dy < 0 ? f.y0 - 3 : v.cy;
      const lane = (i, o) => [ex + dx * i + (dy ? o : 0), ey + dy * i + (dx ? o : 0)];
      const starts = [-1, 0, 1].map((o) => lane(0, o));
      if (outOk(starts)) continue;
      v.exitFixed++;
      for (let i = 1; i <= 40; i++) {
        let edge = false;
        for (let o = -1; o <= 1; o++) {
          const [x, y] = lane(i, o);
          const c = world.cell(x, y);
          if (!c) { edge = true; continue; }
          if (c.t === '≈') { edge = true; continue; }
          if (!world.passable(x, y)) world.setCell(x, y, '·', c.biome);
        }
        if (edge || (i >= D && outOk([lane(i, 0)]))) break;
      }
    }
  }

  // 第三十二版：候選的工作範圍（含周圍那一圈與外圍三圈坡）都落在世界最外圈以內，而且碰到的格子要嘛已經長出來、要嘛可以預留
  function boxReady(world, box, town) {
    const m = C.SETTLE_BUFFER[town ? 'town' : 'village'] + 3;
    for (let cy = Math.floor((box.y0 - m) / C.CHUNK_H); cy <= Math.floor((box.y1 + m) / C.CHUNK_H); cy++) {
      for (let cx = Math.floor((box.x0 - m) / C.CHUNK_W); cx <= Math.floor((box.x1 + m) / C.CHUNK_W); cx++) {
        if (!inRing(world, cx, cy)) return false;
      }
    }
    // 選址範圍可能含先前預留長出來的小塊：工作範圍連同整地的外圍不能碰到現有聚落和它的外圍
    for (const v of world.villages) {
      const vm = C.SETTLE_BUFFER[v.kind === 'town' ? 'town' : 'village'] + 3;
      if (box.x0 - m <= v.x1 + vm && box.x1 + m >= v.x0 - vm && box.y0 - m <= v.y1 + vm && box.y1 + m >= v.y0 - vm) return false;
    }
    // 工作範圍本身要在已經長出來或這一段的小塊上（中央要量得到高度）
    return true;
  }
  // 小塊在不在最外圈（RING_MAX）以內
  function inRing(world, cx, cy) {
    const [lo, hi] = world.ringRange(C.RING_MAX);
    return cx >= lo && cx <= hi && cy >= lo && cy <= hi;
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
      kind: 'deliver',
      targetId: target ? target.id : world.nextId++,
      targetName: target ? target.name : ghostName,
      targetVillage: tv ? tv.name : '附近',
      item: FE.pick(rng, FE.ITEMS),
      line: FE.pick(rng, FE.QUEST_LINES),
      steps: reward.steps,
      exp: reward.exp,
      copper: reward.gold * C.SILVER, // 單位是銅；領的時候再乘經濟標籤與魅力
      compute: reward.compute,
      accepted: false,
      done: false,
    };
  };

  function placeNpcs(world, rng, v) {
    // 鐵匠（城鎮裡叫武器匠）固定站在工坊裡、貼著門內那一格；萬一沒蓋成工坊，站在廣場中央。
    // 城鎮另有盔甲匠，站在盔甲匠工坊裡（沒蓋成就站在廣場中央旁邊一格，不跟武器匠重疊）
    const si = (v.buildings || []).findIndex((b) => b.kind === 'smithy');
    const [sx, sy] = si >= 0 ? v.buildings[si].spots[0] : [v.cx, v.cy];
    world.npcs.push({ id: world.nextId++, name: pickName(world, rng), role: 'smith', villageId: v.id, x: sx, y: sy, quest: null, home: si >= 0 ? { b: si } : null });
    if (v.kind === 'town') {
      const ai = (v.buildings || []).findIndex((b) => b.kind === 'armory');
      const [ax, ay] = ai >= 0 ? v.buildings[ai].spots[0] : [v.cx + 1, v.cy];
      world.npcs.push({ id: world.nextId++, name: pickName(world, rng), role: 'armorer', villageId: v.id, x: ax, y: ay, quest: null, home: ai >= 0 ? { b: ai } : null });
    }

    const candidates = [];
    // 村民不超過實際蓋出來的床位（民房沒蓋齊時人就少一點，不會有人沒有家）
    const beds = (v.buildings || []).reduce((s, b) => s + (b.kind === 'house' || b.kind === 'big' ? b.beds.length : 0), 0);
    const n = Math.min(FE.Steading.villagerCount(rng, v), beds);
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
    // 委託對象被刪掉的人就不給委託（第二十五版起送貨委託不留懸空指標）。
    const pool = candidates.concat(world.npcs.filter((o) => !FE.Gear.isShopkeeper(o)));
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
      if (alive) npc.quest = FE.makeQuest(world, rng, npc, alive);
    }
    for (const o of world.npcs) if (o.villageId === v.id) FE.npcRace(world, o);
  }

  // 世界裡的人（村民、工匠、士兵）的種族（第三十版）：人類 70%、矮人 15%、精靈 15%。
  // 用世界種子和這個人的 id 擲（不動生成用的亂數，世界的樣子不變），擲過就記在 n.race；暫時不影響行為
  FE.npcRace = function (world, n) {
    if (n.race) return n.race;
    let r = hash(world.seed ^ 0x5bd1e995, n.id, 7331);
    n.race = C.NPC_RACES[C.NPC_RACES.length - 1][0];
    for (const [race, p] of C.NPC_RACES) {
      if (r < p) {
        n.race = race;
        break;
      }
      r -= p;
    }
    return n.race;
  };

  // 粗糙的掉落公式：約四分之一會算出負數，少數會除以零變成 NaN。所有寶箱的金幣減半（CHEST_GOLD_MUL），算壞的公式套在減半後的數字上。
  // 算出來的是銀，換成銅（第三十版）；算壞的 NaN 乘完還是 NaN
  FE.roughGold = function (rng) {
    let gold = Math.floor((25 + (rng() - 0.62) * 70) * C.CHEST_GOLD_MUL);
    if (rng() < 0.08) gold = Math.floor((gold / 0) * 0);
    return gold * C.SILVER;
  };

  // 創世時固定放幾個寶箱，拿了就沒有，不會重生
  // 創世時的寶箱只放在聚落附近的地貌裡（第二十七版）：廢棄的堡壘、古老立石、墓地、法師塔、聖所、礦坑各 1～3 個，
  // 古老森林不放；沒有聚落（也就沒有地貌）的那塊世界沒有固定寶箱，只剩怪物掉的。
  // 只放在「裡面」：圖案上的室內地板 o，或上下左右都還是地貌圖案的碎石地 ░（牆、石圈、墓碑圍住的那一片），門外的路不算
  function placeChests(world, rng, landmark) {
    if (!landmark || !C.CHEST_LANDMARKS.includes(landmark.kind)) return;
    const art = FE.LANDMARKS[landmark.kind].art;
    const at = (dx, dy) => (dy >= 0 && dy < art.length && dx >= 0 && dx < art[dy].length ? art[dy][dx] : '.');
    const inside = (dx, dy) => at(dx, dy) === 'o' || (at(dx, dy) === '░' && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([ax, ay]) => at(dx + ax, dy + ay) !== '.'));
    const spots = [];
    for (let y = landmark.y0; y <= landmark.y1; y++) {
      for (let x = landmark.x0; x <= landmark.x1; x++) {
        if (!inside(x - landmark.x0, y - landmark.y0)) continue;
        if (!world.passable(x, y) || world.npcAt(x, y) || world.chestAt(x, y)) continue;
        if (world.nodes.some((o) => o.x === x && o.y === y)) continue;
        spots.push([x, y]);
      }
    }
    const n = Math.min(spots.length, FE.randInt(rng, C.CHESTS[0], C.CHESTS[1]));
    for (let i = 0; i < n; i++) {
      const [x, y] = spots.splice(Math.floor(rng() * spots.length), 1)[0];
      world.chests.push({ id: world.nextId++, x, y, copper: FE.roughGold(rng) });
    }
  }

  // 採集點：礦坑的空地上 3～5 處礦脈；溫帶森林、針葉林、熱帶雨林裡約 2% 的格子長藥草。
  // 藥草不放在聚落、路、地貌、寶箱與出生點上。第三十四版：只放在從出生點走得到的格子（原本藥草會長在斷崖上拿不到）
  function placeNodes(world, rng, r, landmarks) {
    const reach = FE.Checker.reachable(world);
    for (const landmark of landmarks) {
      if (landmark.kind !== 'mine') continue;
      const art = FE.LANDMARKS.mine.art;
      const floor = [];
      art.forEach((row, dy) => [...row].forEach((ch, dx) => ch === 'o' && reach.at(landmark.x0 + dx, landmark.y0 + dy) && floor.push([landmark.x0 + dx, landmark.y0 + dy])));
      const n = Math.min(floor.length, FE.randInt(rng, C.ORE_NODES[0], C.ORE_NODES[1]));
      for (let i = 0; i < n; i++) {
        const [x, y] = floor.splice(Math.floor(rng() * floor.length), 1)[0];
        world.nodes.push({ id: world.nextId++, kind: 'ore', x, y, regrowAt: 0 });
      }
    }
    const s = world.spawn;
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const c = world.cell(x, y);
        if (!c || !C.HERB_BIOMES.includes(c.biome) || rng() >= C.HERB_RATE) continue;
        if (!world.passable(x, y) || !reach.at(x, y) || c.t === '·' || world.inVillage(x, y) || world.landmarkAt(x, y) || world.chestAt(x, y) || world.npcAt(x, y)) continue;
        if (s && s.x === x && s.y === y) continue;
        world.nodes.push({ id: world.nextId++, kind: 'herb', x, y, regrowAt: 0 });
      }
    }
  }

  FE.World = World;
  FE.pickName = pickName;
})();
