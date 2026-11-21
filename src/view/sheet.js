// C 角色頁（照舊版第三十七版的卡片）：最上面一張身分卡（種族、職業、等級、背景，還有沒加的屬性點時提示）；
// 接著身體、生命、裝備三張卡；六張屬性卡（數值、修正值、用在哪些技能，有點數時卡上有「加 1」）；
// 戰鬥數字的小格；技能卡（全部技能，沒學的變淡）；種族與職業能力。回傳點擊範圍 { plus: [{ rect, attr }] }

import { HEIGHTS, heroStats, MAX_ATTR, PHYSIQUES } from '../world/hero.js';
import { attrMod } from '../world/rules.js';
import { wearText } from '../world/wear.js';
import { COLORS } from './colors.js';
import { ATTR_NAMES, ATTR_ORDER, itemText, RANKS, signed } from './names.js';
import { drawHelp, drawTile } from './ui-kit.js';

const GAP = 3; // 卡片間距（pad 的倍數）

// 一張卡：細框、左上角小標題；回傳內容的起點
function card(ctx, s, panels, rect, title) {
  panels.box(ctx, rect, COLORS.bg, COLORS.line2);
  panels.text(ctx, s, title, rect.x + s.pad * 2, rect.y + s.pad, COLORS.dim);
  return { x: rect.x + s.pad * 2, y: rect.y + s.pad + s.lineHeight * 1.2, w: rect.w - s.pad * 4 };
}

// 進度條（生命）
function bar(ctx, s, x, y, w, ratio, color) {
  const h = Math.max(4, Math.round(s.lineHeight * 0.4));
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  return h;
}

// 一排 n 張等寬的卡：回傳每張的 rect
const row = (s, x, y, w, n, h) => {
  const gap = s.pad * GAP;
  const cw = Math.floor((w - gap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({ x: x + i * (cw + gap), y, w: cw, h }));
};

export function drawSheet(ctx, s, panels, data, state, body) {
  const hero = state.hero;
  const h = heroStats(data, hero);
  const race = data.races[data.raceIndex.get(hero.race)];
  const cls = data.classes[data.classIndex.get(hero.cls)];
  const bg = hero.background ? data.backgrounds[data.backgroundIndex.get(hero.background)] : null;
  const b = drawHelp(ctx, s, panels, body, '有屬性點時點屬性卡上的「加 1」　C 或 Esc 關閉');
  const plus = [];
  const L = s.lineHeight;
  const gap = s.pad * GAP;
  let y = b.y;

  // 身分
  const idRect = { x: b.x, y, w: b.w, h: L * 2.4 };
  const id = card(ctx, s, panels, idRect, '冒險者');
  panels.text(
    ctx,
    s,
    `${race.icon} ${race.name}　${cls.icon} ${cls.name}　${hero.level} 級${bg ? `　背景：${bg.name}（${bg.feature}）` : ''}`,
    id.x,
    id.y,
    COLORS.head,
  );
  if (hero.points > 0) {
    const t = `還有 ${hero.points} 點屬性可以加`;
    panels.text(ctx, s, t, idRect.x + idRect.w - panels.measure(t, s) - s.pad * 3, id.y, COLORS.good);
  }
  y += idRect.h + gap;

  // 身體、生命、裝備
  const [bodyR, lifeR, gearR] = row(s, b.x, y, b.w, 3, L * 4.6);
  let c = card(ctx, s, panels, bodyR, '身體');
  panels.text(ctx, s, `身高 ${HEIGHTS[hero.height]}（擲 ${hero.rolls.height}）`, c.x, c.y);
  panels.text(ctx, s, `每個動作花 ${h.ticks} 刻`, c.x, c.y + L, COLORS.dim);
  panels.text(ctx, s, `體格 ${PHYSIQUES[hero.physique]}（擲 ${hero.rolls.physique}）`, c.x, c.y + L * 2);
  c = card(ctx, s, panels, lifeR, '生命');
  panels.text(ctx, s, `${state.hp}／${h.hpMax}`, c.x, c.y, COLORS.head);
  const ratio = state.hp / h.hpMax;
  bar(ctx, s, c.x, c.y + L * 1.3, c.w, ratio, ratio > 0.5 ? COLORS.good : COLORS.bad);
  c = card(ctx, s, panels, gearR, '裝備（B 換）');
  ['weapon', 'shield', 'armor'].forEach((slot, i) => {
    const gid = hero.gear[slot];
    const name = gid && gid !== 'no-armor' ? itemText(data, gid).name : slot === 'weapon' ? '徒手' : '（空）';
    const wt = gid ? (wearText(slot, gid, hero.wear?.[slot] ?? 0) ?? '') : '';
    panels.text(ctx, s, `${['主手', '副手', '身上'][i]}　${name}`, c.x, c.y + L * i, gid ? COLORS.text : COLORS.line2);
    if (wt) panels.text(ctx, s, wt, c.x + c.w - panels.measure(wt, s), c.y + L * i, COLORS.dim);
  });
  y += bodyR.h + gap;

  // 屬性卡
  const attrRects = row(s, b.x, y, b.w, 6, L * 4.4);
  ATTR_ORDER.forEach((k, i) => {
    const r = attrRects[i];
    const v = hero.attrs[k];
    const cc = card(ctx, s, panels, r, ATTR_NAMES[k]);
    panels.text(ctx, s, `${v}`, cc.x, cc.y, COLORS.head);
    panels.text(ctx, s, `修正 ${signed(attrMod(v))}`, cc.x + panels.measure('00　', s), cc.y, COLORS.text);
    // 用在哪些技能：放得下幾個寫幾個
    let uses = '';
    for (const sk of data.skills.filter((x) => x.attrs.includes(k))) {
      const next = uses ? `${uses}、${sk.name}` : sk.name;
      if (panels.measure(next, s) > cc.w) break;
      uses = next;
    }
    panels.text(ctx, s, uses, cc.x, cc.y + L, COLORS.dim);
    if (hero.points > 0 && v < MAX_ATTR) {
      const t = '[ 加 1 ]';
      const rect = { x: cc.x, y: cc.y + L * 2, w: panels.measure(t, s), h: L };
      panels.text(ctx, s, t, rect.x, rect.y, COLORS.good);
      plus.push({ rect, attr: k });
    }
  });
  y += attrRects[0].h + gap;

  // 戰鬥數字
  const fights = [
    ['攻擊', `1d12${signed(h.attack)}`],
    ['傷害', `1d12${signed(h.damage)}`],
    ['閃避', h.dodge],
    ['格擋', h.parry],
    ['減免', h.reduction],
    ['射程', `${h.range} 格`],
    ['每個動作', `${h.ticks} 刻`],
  ];
  const tiles = row(s, b.x, y, b.w, fights.length, L * 2 + s.pad * 2);
  fights.forEach(([label, v], i) => {
    drawTile(ctx, s, panels, tiles[i], label, v);
  });
  y += tiles[0].h + s.pad;
  panels.text(ctx, s, '被近戰打時自動用閃避、格擋裡高的那個，被遠程打只能閃避。', b.x, y, COLORS.dim);
  y += L + gap;

  // 技能卡：全部技能，學過的亮
  const per = 6;
  const skH = L * 2 + s.pad * 2;
  data.skills.forEach((sk, i) => {
    const r = row(s, b.x, y + Math.floor(i / per) * (skH + s.pad * 2), b.w, per, skH)[i % per];
    const rank = hero.skills[sk.id] ?? 0;
    panels.box(ctx, r, rank ? COLORS.panel2 : COLORS.bg, rank ? COLORS.line2 : COLORS.line);
    panels.text(ctx, s, sk.name, r.x + s.pad * 2, r.y + s.pad, rank ? COLORS.head : COLORS.line2);
    panels.text(
      ctx,
      s,
      `${RANKS[rank]}　${signed(rank)}`,
      r.x + s.pad * 2,
      r.y + s.pad + L,
      rank ? COLORS.text : COLORS.line2,
    );
  });
  y += Math.ceil(data.skills.length / per) * (skH + s.pad * 2) + s.pad;

  // 能力：種族、職業、背景三張卡；資料寫成「名稱：說明」，名稱一行、說明換行排在下面
  const split2 = (a) => {
    const k = a.indexOf('：');
    return k < 0 ? [a, ''] : [a.slice(0, k), a.slice(k + 1)];
  };
  const groups = [
    ['種族能力', race.abilities.map(split2)],
    ['職業能力', cls.abilities.map(split2)],
    [
      '背景',
      bg
        ? [
            [bg.name, bg.feature],
            ['背景裝備', bg.gear.join('、')],
          ]
        : [],
    ],
  ];
  const abRects = row(s, b.x, y, b.w, 3, b.y + b.h - y);
  groups.forEach(([title, items], i) => {
    const cc = card(ctx, s, panels, abRects[i], title);
    let ay = cc.y;
    for (const [name, desc] of items) {
      if (ay + L > abRects[i].y + abRects[i].h - s.pad) break;
      panels.text(ctx, s, name, cc.x, ay, COLORS.head);
      ay += L;
      if (desc) ay += panels.para(ctx, s, desc, cc.x, ay, cc.w, COLORS.text);
      ay += s.pad * 2;
    }
  });
  return { plus };
}
