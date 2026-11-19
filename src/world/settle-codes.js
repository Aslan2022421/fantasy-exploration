// 聚落圖樣的格子代碼（settle-layouts.js 排、settlements.js 蓋進地圖）

export const GROUND = 'ground';
export const ROAD = 'road';
export const INDOOR = 'indoor';
export const FIELD = 'field'; // 田裡的泥土（作物那一排是物件 crops）
export const KEEP = 'keep';
export const WELL = 'town-well';
export const BED = 'bed';
export const OUTROAD = 'outroad'; // 出入口外面的路（牆外，村民不走出去）

// 室內的物件（底下鋪室內地板）；擋路的家具
export const INDOOR_OBJECTS = new Set(['door', 'stone-door', 'bed', 'table', 'cabinet', 'chair', 'altar', 'barrel']);
export const BLOCKING = new Set(['table', 'cabinet', 'altar', 'stall', 'barrel']);
// 走得過去的代碼
const WALKABLE = new Set([GROUND, ROAD, INDOOR, FIELD, 'crops', 'door', 'stone-door', 'bed', 'chair']);
export const walkable = (code) => WALKABLE.has(code);
