// 建角畫面右欄的內容：游標那一行的說明，以及「選完的樣子」（屬性、生命、攻擊、防禦）。
// 回傳 [{ text, color }]，由 creation-view.js 排版

import { ACTION_TICKS, bodyIndex, HEIGHTS, PHYSIQUES, START_HP } from '../world/hero.js';
import { attrMod } from '../world/rules.js';
import { COLORS } from './colors.js';
import { ATTR_NAMES, ATTR_ORDER, itemText, signed, skillName } from './names.js';

const head = (text) => ({ text, color: COLORS.head });
const line = (text, color = COLORS.text) => ({ text, color });
const gap = () => ({ text: ' ' });
const span = (r) => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}～${r[1]}`) : '—');

function raceDetail(r) {
  return [
    head(`${r.icon} ${r.name}`),
    line(r.description),
    gap(),
    line(ATTR_ORDER.map((k) => `${ATTR_NAMES[k]} ${r.attrs[k]}（${signed(attrMod(r.attrs[k]))}）`).join('　')),
    gap(),
    line(`身高（1d12）：${HEIGHTS.map((h, i) => `${h} ${span(r.height[i])}`).join('、')}`, COLORS.dim),
    line(`體格（1d12）：${PHYSIQUES.map((p, i) => `${p} ${span(r.physique[i])}`).join('、')}`, COLORS.dim),
    gap(),
    ...r.abilities.map((a) => line(`種族能力｜${a}`)),
  ];
}

function bodyDetail(r, rolls) {
  const h = bodyIndex(r.height, rolls.height);
  const p = bodyIndex(r.physique, rolls.physique);
  return [
    head('身高與體格'),
    line(`身高：擲 ${rolls.height} → ${HEIGHTS[h]}，每個動作（走一格、攻擊一次）花 ${ACTION_TICKS[h]} 刻`),
    line(`體格：擲 ${rolls.physique} → ${PHYSIQUES[p]}，初始生命 ${START_HP[p]}`),
    gap(),
    line('身高越高動作越快；體格越壯生命越多。', COLORS.dim),
  ];
}

function classDetail(data, k) {
  const weapons = k.kit.weapons.map((w) => itemText(data, w).name).join(k.kit.pick === 'all' ? '及' : '、');
  const armors = k.kit.armors.map((a) => itemText(data, a).name).join('或');
  return [
    head(`${k.icon} ${k.name}`),
    line(
      `每級生命 +${k.hpPerLevel}　主要屬性：${k.mainAttrs.map((a) => ATTR_NAMES[a]).join('、')}（職業的 2 點加在這兩項）`,
    ),
    line(`可選技能：${k.skillChoices.map((s) => skillName(data, s)).join('、')}`),
    line(`裝備：${weapons}；${armors}${k.kit.shield ? '；可帶盾牌' : ''}`),
    gap(),
    ...k.abilities.map((a) => line(`職業能力｜${a}`)),
  ];
}

function backgroundDetail(data, b) {
  return [
    head(b.name),
    line(`技能：${b.skills.map((s) => skillName(data, s)).join('、')}（初學）`),
    line(`背景特性：${b.feature}`),
    line(`背景裝備：${b.gear.join('、')}（這一版只是描述）`, COLORS.dim),
  ];
}

function skillDetail(data, id) {
  const s = data.skills[data.skillIndex.get(id)];
  return [head(s.name), line(`相關屬性：${s.attrs.map((a) => ATTR_NAMES[a]).join('、')}`)];
}

function itemDetail(data, id) {
  const it = itemText(data, id);
  return [head(it.name), line(it.text)];
}

// 「選完的樣子」：選了種族才有屬性，選了職業才有戰鬥數字
// showSkills：選了背景之後才列技能（之前是預設補的，會誤導）
function previewLines(data, p, showSkills) {
  if (!p) return [];
  const out = [head('選完的樣子')];
  out.push(line(ATTR_ORDER.map((k) => `${ATTR_NAMES[k]} ${p.attrs[k]}（${signed(attrMod(p.attrs[k]))}）`).join('　')));
  if (!p.stats) return out;
  const h = p.stats;
  out.push(
    line(`生命 ${h.hpMax}　每個動作 ${h.ticks} 刻　攻擊 1d12${signed(h.attack)}　傷害 1d12${signed(h.damage)}`),
    line(
      `防禦 閃避 ${h.dodge}／格擋 ${h.parry}　減免 ${h.reduction}　${h.weapon.name}、${h.armor.name}${h.shield ? '、盾牌' : ''}`,
    ),
  );
  const skills = showSkills ? Object.keys(p.sheet.skills).map((s) => skillName(data, s)) : [];
  if (skills.length) out.push(line(`技能：${skills.join('、')}`, COLORS.dim));
  return out;
}

// m：createCreation 的流程；stepId：現在這一步
export function detailLines(data, m, stepId) {
  const row = m.rows()[m.cursor];
  const c = m.state;
  let main = [];
  if (stepId === 'race' && row) main = raceDetail(data.races[data.raceIndex.get(row.key)]);
  else if (stepId === 'body') main = bodyDetail(m.race(), c.rolls);
  else if (stepId === 'class' && row) main = classDetail(data, data.classes[data.classIndex.get(row.key)]);
  else if (stepId === 'points')
    main = [
      head('職業的 2 點'),
      line('只能加在職業的兩項主要屬性；點右邊的 + 加、- 退回。'),
      line('屬性每 2 點跳一級修正值（10～11 是 +0、12～13 是 +1）。', COLORS.dim),
    ];
  else if (stepId === 'background' && row)
    main = backgroundDetail(data, data.backgrounds[data.backgroundIndex.get(row.key)]);
  else if (stepId === 'skills' && row?.skill) main = skillDetail(data, row.skill);
  else if (stepId === 'gear' && row?.item) main = itemDetail(data, row.item);
  else if (stepId === 'summary') main = [head('確認之後就開始冒險'), line('想改哪一步，點最上面的路徑跳回去。')];
  const tail = previewLines(data, m.preview(), !!c.background);
  return tail.length ? [...main, gap(), ...tail] : main;
}
