// 存檔：每個動作後存一次，標上 SAVE_VERSION。讀到別的版本就整個清掉，
// 測試期間規則常改，舊存檔跟舊紀錄留著只會混淆。
(function () {
  const C = FE.CONFIG;
  const KEY = 'fe.save';
  const BIOME_CODE = {
    plain: 'p', grassland: 'g', shrubland: 'h', forest: 'f', taiga: 't', tundra: 'u', glacier: 'i',
    jungle: 'j', savanna: 'v', desert: 'd', marsh: 'a', swamp: 'w', mountain: 'm', lake: 'l',
  };
  const CODE_BIOME = Object.fromEntries(Object.entries(BIOME_CODE).map(([k, v]) => [v, k]));

  function serialize(game) {
    const w = game.world;
    return {
      seed: game.seed,
      rngState: game.rng.getState(),
      turn: game.turn,
      ticks: game.ticks || 0,
      exp: game.exp,
      level: game.level,
      creation: game.creation,
      nextChunkAt: game.nextChunkAt,
      compute: game.compute,
      nextMonsterId: game.nextMonsterId,
      battle: game.battle,
      worldState: game.worldState,
      soldiers: game.soldiers,
      fixed: game.fixed,
      log: game.log.slice(0, 20),
      player: game.player,
      lastSafe: game.lastSafe,
      monsters: game.monsters,
      flashes: game.flashes || [],
      world: {
        // 每塊區塊各自存成幾列字串：地形字元、生態區代碼、高度
        chunks: w.chunks.map((ch) => ({
          index: ch.index,
          cx: ch.cx,
          cy: ch.cy,
          terrain: ch.cells.map((row) => row.map((c) => c.t).join('')),
          biome: ch.cells.map((row) => row.map((c) => BIOME_CODE[c.biome] || 'p').join('')),
          height: ch.cells.map((row) => row.map((c) => c.h).join('')),
        })),
        npcs: w.npcs,
        chests: w.chests,
        villages: w.villages,
        landmarks: w.landmarks,
        nextId: w.nextId,
        spawn: w.spawn,
        nextTownAt: w.nextTownAt,
        dormant: [...w.dormant],
      },
    };
  }

  function restore(data) {
    const game = new FE.Game(data.seed);
    game.rng.setState(data.rngState);
    for (const k of ['turn', 'ticks', 'exp', 'level', 'creation', 'nextChunkAt', 'compute', 'nextMonsterId', 'battle', 'worldState', 'soldiers', 'fixed', 'log', 'player', 'lastSafe', 'monsters', 'flashes']) {
      game[k] = data[k];
    }
    const w = game.world;
    const d = data.world;
    for (const s of d.chunks) {
      const cells = s.terrain.map((row, y) => [...row].map((t, x) => ({ t, biome: CODE_BIOME[s.biome[y][x]], h: Number(s.height[y][x]) })));
      const ch = {
        index: s.index,
        cx: s.cx,
        cy: s.cy,
        cells,
        x0: s.cx * C.CHUNK_W,
        y0: s.cy * C.CHUNK_H,
        x1: (s.cx + 1) * C.CHUNK_W,
        y1: (s.cy + 1) * C.CHUNK_H,
      };
      w.chunks.push(ch);
      w.chunkMap.set(s.cx + ',' + s.cy, ch);
    }
    for (const k of ['npcs', 'chests', 'villages', 'landmarks', 'nextId', 'spawn', 'nextTownAt']) w[k] = d[k];
    w.dormant = new Set(d.dormant);
    return game;
  }

  FE.Save = {
    save(game) {
      FE.store.save(KEY, { version: C.SAVE_VERSION, data: serialize(game) });
    },
    // 回傳 { game } 讀檔成功；{ stale: true } 讀到舊版本（已清掉）；null 沒有存檔
    load() {
      const s = FE.store.load(KEY, null);
      if (!s) return null;
      if (s.version !== C.SAVE_VERSION) {
        FE.Save.clearAll();
        return { stale: true };
      }
      try {
        return { game: restore(s.data) };
      } catch (e) {
        FE.Save.clearAll();
        return { stale: true };
      }
    },
    // 一律經過 FE.store，測試模式（?nosave）換掉 FE.store 時，這裡也碰不到真的存檔
    clearAll() {
      for (const k of [KEY, 'fe.history', 'fe.reports']) FE.store.remove(k);
    },
  };
})();
