// 工具腳本用的資料載入：照遊戲的資料夾讀 JSON，交給 build.js 檢查與組合（遊戲本身用 Vite 的 import.meta.glob）

import { readdirSync, readFileSync } from 'node:fs';
import { buildData } from '../src/data/build.js';

const root = new URL('../', import.meta.url);

function readKind(kind) {
  const dir = new URL(`data/${kind}/`, root);
  const files = {};
  for (const f of readdirSync(dir))
    if (f.endsWith('.json')) files[f] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  return files;
}

export function loadData() {
  return buildData({
    terrain: readKind('terrain'),
    object: readKind('object'),
    biome: readKind('biome'),
    material: readKind('material'),
    worldshape: readKind('worldshape'),
    species: readKind('species'),
    nest: readKind('nest'),
    settlement: readKind('settlement'),
    skill: readKind('skill'),
    weapon: readKind('weapon'),
    armor: readKind('armor'),
    race: readKind('race'),
    class: readKind('class'),
    background: readKind('background'),
  });
}
