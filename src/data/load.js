// 載入 data/ 的 JSON：一類型一資料夾，資料夾裡可以有很多檔，載入時合併（檢查在 build.js）

import { buildData } from './build.js';

const terrainFiles = import.meta.glob('../../data/terrain/*.json', { eager: true, import: 'default' });
const objectFiles = import.meta.glob('../../data/object/*.json', { eager: true, import: 'default' });
const biomeFiles = import.meta.glob('../../data/biome/*.json', { eager: true, import: 'default' });
const materialFiles = import.meta.glob('../../data/material/*.json', { eager: true, import: 'default' });
const worldshapeFiles = import.meta.glob('../../data/worldshape/*.json', { eager: true, import: 'default' });
const speciesFiles = import.meta.glob('../../data/species/*.json', { eager: true, import: 'default' });
const skillFiles = import.meta.glob('../../data/skill/*.json', { eager: true, import: 'default' });
const weaponFiles = import.meta.glob('../../data/weapon/*.json', { eager: true, import: 'default' });
const armorFiles = import.meta.glob('../../data/armor/*.json', { eager: true, import: 'default' });
const raceFiles = import.meta.glob('../../data/race/*.json', { eager: true, import: 'default' });
const classFiles = import.meta.glob('../../data/class/*.json', { eager: true, import: 'default' });
const backgroundFiles = import.meta.glob('../../data/background/*.json', { eager: true, import: 'default' });
const nestFiles = import.meta.glob('../../data/nest/*.json', { eager: true, import: 'default' });
const settlementFiles = import.meta.glob('../../data/settlement/*.json', { eager: true, import: 'default' });

export const DATA = buildData({
  skill: skillFiles,
  weapon: weaponFiles,
  armor: armorFiles,
  race: raceFiles,
  class: classFiles,
  background: backgroundFiles,
  terrain: terrainFiles,
  object: objectFiles,
  biome: biomeFiles,
  material: materialFiles,
  worldshape: worldshapeFiles,
  species: speciesFiles,
  nest: nestFiles,
  settlement: settlementFiles,
});
