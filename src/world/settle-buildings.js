// 聚落的建築清單（settle-layouts.js 照這個蓋）

// 建築：牆的物件（walls 是幾種材質照雜湊挑一種）、室內寬高、門數、家具；spot 是住戶站的格子（貼著門內那一格）；home 是有人住。
// 民房最小室內 4×3（比人大得多），另有 5×4、6×3、6×4 幾種，村莊多木屋，城鎮多灰泥與石屋
export const HOMES = ['house', 'house-timber', 'house-plaster', 'house-stone'];
export const BUILDINGS = {
  house: { walls: HOMES, w: 4, h: 3, doors: 1, spot: true, home: true, items: ['bed', 'cabinet', 'chair', 'table'] },
  house2: {
    walls: HOMES,
    w: 5,
    h: 4,
    doors: 1,
    spot: true,
    home: true,
    items: ['bed', 'cabinet', 'table', 'chair', 'chair', 'barrel'],
  },
  house3: {
    walls: HOMES,
    w: 6,
    h: 3,
    doors: 1,
    spot: true,
    home: true,
    items: ['bed', 'cabinet', 'table', 'chair', 'barrel'],
  },
  big: {
    walls: HOMES,
    w: 6,
    h: 4,
    doors: 1,
    home: true,
    items: ['table', 'cabinet', 'cabinet', 'chair', 'chair', 'barrel'],
  },
  barn: { wall: 'barn', w: 6, h: 4, doors: 1, items: ['crate', 'crate', 'crate', 'barrel', 'barrel'] }, // 穀倉（村莊）
  hall: { wall: 'hall', w: 7, h: 4, doors: 1, items: ['table', 'table', 'chair', 'chair', 'chair', 'cabinet'] },
  temple: { wall: 'temple', w: 5, h: 4, doors: 1, items: ['altar', 'chair', 'chair', 'chair', 'chair'] },
  barracks: { wall: 'barracks', w: 7, h: 3, doors: 1, items: ['bed', 'bed', 'bed', 'bed', 'bed', 'cabinet'] },
  inn: { wall: 'inn', w: 6, h: 4, doors: 1, items: ['bed', 'bed', 'bed', 'table', 'chair', 'chair', 'barrel'] },
  smithy: { wall: 'smithy', w: 5, h: 4, doors: 1, items: ['anvil', 'barrel', 'crate', 'table'] }, // 鐵匠舖：金屬的製造、修理、熔煉要貼著鐵砧
  castle: {
    wall: 'castle',
    w: 11,
    h: 6,
    doors: 1,
    items: ['chair', 'altar', 'table', 'table', 'chair', 'chair', 'chair', 'chair', 'cabinet', 'cabinet'],
  },
  tavern: {
    wall: 'tavern',
    w: 6,
    h: 4,
    doors: 1,
    items: ['table', 'table', 'chair', 'chair', 'chair', 'chair', 'barrel'],
  },
};
// 公共建築：城鎮全有；村莊人口標籤到「穩定」以上才有旅店
// 城市：北邊的城堡、兩座神殿與兵營、旅店酒館各兩間（交辦 4：兩座城鎮併起來的份量）；城鎮、城市各一間鐵匠舖（階段 9）
export const PUBLIC = {
  city: ['castle', 'hall', 'temple', 'temple', 'barracks', 'barracks', 'smithy', 'inn', 'inn', 'tavern', 'tavern'],
  town: ['hall', 'temple', 'barracks', 'smithy', 'inn', 'tavern'],
  village: ['smithy', 'barn'], // 村莊都有鐵匠舖與穀倉；人口到「穩定」以上再加旅店
};
