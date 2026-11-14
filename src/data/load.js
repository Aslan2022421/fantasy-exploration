// 載入 data/ 的 JSON：一類型一資料夾，資料夾裡可以有很多檔，載入時合併（檢查在 build.js）

import { buildData } from './build.js';

const terrainFiles = import.meta.glob('../../data/terrain/*.json', { eager: true, import: 'default' });
const objectFiles = import.meta.glob('../../data/object/*.json', { eager: true, import: 'default' });
const biomeFiles = import.meta.glob('../../data/biome/*.json', { eager: true, import: 'default' });
const materialFiles = import.meta.glob('../../data/material/*.json', { eager: true, import: 'default' });
const worldshapeFiles = import.meta.glob('../../data/worldshape/*.json', { eager: true, import: 'default' });

export const DATA = buildData({
  terrain: terrainFiles,
  object: objectFiles,
  biome: biomeFiles,
  material: materialFiles,
  worldshape: worldshapeFiles,
});
