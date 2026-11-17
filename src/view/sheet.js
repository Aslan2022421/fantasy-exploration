// C 角色頁：種族、職業、背景、身高體格、屬性（有還沒加的屬性點時，屬性後面浮出 + 可以點）、技能、裝備、
// 算出來的攻擊防禦，以及種族與職業能力。段落之間用分隔線。回傳點擊範圍 { plus: [{ rect, attr }] }

import { HEIGHTS, heroStats, MAX_ATTR, PHYSIQUES } from '../world/hero.js';
import { attrMod } from '../world/rules.js';
import { COLORS } from './colors.js';
import { ATTR_NAMES, ATTR_ORDER, itemText, RANKS, signed, skillName } from './names.js';
import { wrap } from './wrap.js';

export function drawSheet(ctx, s, panels, data, state, body) {
  const hero = state.hero;
  const h = heroStats(data, hero);
  const race = data.races[data.raceIndex.get(hero.race)];
  const cls = data.classes[data.classIndex.get(hero.cls)];
  const bg = hero.background ? data.backgrounds[data.backgroundIndex.get(hero.background)] : null;
  const measure = (ch) => panels.measure(ch, s);
  const plus = [];
  let y = body.y;
  const write = (text, color = COLORS.text, x = body.x, w = body.w) => {
    for (const part of wrap(text, w, measure)) {
      panels.text(ctx, s, part, x, y, color);
      y += s.lineHeight;
    }
  };
  const rule = () => {
    y += s.pad;
    panels.rule(ctx, s, body.x, y, body.w);
    y += s.lineHeight + s.pad;
  };

  write(
    `${race.icon} ${race.name}　${cls.icon} ${cls.name}　${hero.level} 級${bg ? `　背景：${bg.name}（${bg.feature}）` : ''}`,
    COLORS.head,
  );
  write(
    `身高 ${HEIGHTS[hero.height]}（擲 ${hero.rolls.height}）：每個動作花 ${h.ticks} 刻　　體格 ${PHYSIQUES[hero.physique]}（擲 ${hero.rolls.physique}）：生命 ${state.hp}/${h.hpMax}`,
  );
  rule();

  // 屬性：兩排各三項；有點數時每項後面一個 [ + ]
  const colW = Math.floor(body.w / 3);
  if (hero.points > 0) write(`還有 ${hero.points} 點屬性可以加，點屬性後面的 +。`, COLORS.good);
  ATTR_ORDER.forEach((k, i) => {
    const x = body.x + (i % 3) * colW;
    const row = y + Math.floor(i / 3) * s.lineHeight * 1.3;
    const v = hero.attrs[k];
    const text = `${ATTR_NAMES[k]} ${v}（${signed(attrMod(v))}）`;
    panels.text(ctx, s, text, x, row, COLORS.text);
    if (hero.points > 0 && v < MAX_ATTR) {
      const bx = x + panels.measure(text, s) + s.pad * 3;
      const bw = panels.measure('[ + ]', s);
      panels.text(ctx, s, '[ + ]', bx, row, COLORS.good);
      plus.push({ rect: { x: bx, y: row, w: bw, h: s.lineHeight }, attr: k });
    }
  });
  y += s.lineHeight * 2.6;
  rule();

  const skills = Object.entries(hero.skills).map(([id, r]) => `${skillName(data, id)} ${RANKS[r]}（${signed(r)}）`);
  write(`技能：${skills.join('、') || '沒有'}`);
  rule();

  const slot = (label, id, note) => {
    if (!id) return write(`${label}　（空）`, COLORS.line2);
    const it = itemText(data, id);
    write(`${label}　${it.name}　${note ?? it.text}`, note ? COLORS.bad : COLORS.text);
  };
  slot('主手', hero.gear.weapon);
  slot('副手', hero.gear.shield, h.weapon.twoHanded && hero.gear.shield ? '雙手武器，盾牌不能用' : null);
  slot('身上', hero.gear.armor);
  const bagged = hero.items.map((id) => itemText(data, id).name);
  if (bagged.length) write(`背包：${bagged.join('、')}（B 換裝備）`, COLORS.dim);
  write(
    `攻擊 1d12${signed(h.attack)}　傷害 1d12${signed(h.damage)}　防禦 閃避 ${h.dodge}／格擋 ${h.parry}（被近戰打時自動取高，被遠程打只能閃避）　減免 ${h.reduction}`,
    COLORS.head,
  );
  rule();

  for (const a of race.abilities) write(`種族能力｜${a}`, COLORS.dim);
  for (const a of cls.abilities) write(`職業能力｜${a}`, COLORS.dim);
  if (bg) write(`背景裝備｜${bg.gear.join('、')}`, COLORS.dim);
  return { plus };
}
