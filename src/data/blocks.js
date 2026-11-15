// 物種的數值塊：把建怪問答的答案換算成傷害、生命、護甲這幾個數字。
// 數字取自 Dungeon World 的「Making Monsters」（CC BY 3.0），戰鬥怎麼用這些數字等階段 5 再定。
// 純函式，Node 裡可測

const DICE = [4, 6, 8, 10, 12];

// 組織：傷害骰與生命的起點
const ORGANIZATION = {
  horde: { die: 6, hp: 3 },
  group: { die: 8, hp: 6 },
  solitary: { die: 10, hp: 12 },
};
// 體型：傷害與生命的修正、攻擊距離、體型標籤
const SIZE = {
  tiny: { dmg: -2, hp: 0, range: ['hand'], tag: 'tiny' },
  small: { dmg: 0, hp: 0, range: ['close'], tag: 'small' },
  human: { dmg: 0, hp: 0, range: ['close'], tag: null },
  large: { dmg: 1, hp: 4, range: ['close', 'reach'], tag: 'large' },
  huge: { dmg: 3, hp: 8, range: ['reach'], tag: 'huge' },
};
const ARMOR = { flesh: 0, hide: 1, scale: 2, bone: 3, magic: 4 };

// 環境能加的答案：寒帶多一項耐力；山地多一項善攀；潮濕又靠水多一項兩棲
export function envExtras(env = {}) {
  return {
    known: env.cold ? ['endurance'] : [],
    adaptations: [...(env.mountain ? ['climb'] : []), ...(env.water ? ['amphibious'] : [])],
  };
}

// 環境的所有組合（資料檢查時每種都換算一次）
export const ENV_VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
  cold: Boolean(n & 1),
  mountain: Boolean(n & 2),
  water: Boolean(n & 4),
}));

// answers：物種資料的 answers；env：當地的環境（cold、mountain、water 三個布林）
export function buildBlock(answers, env = {}) {
  const extra = envExtras(env);
  const known = new Set([...answers.known, ...extra.known]);
  const marks = new Set(answers.attack.marks);
  const describe = new Set(answers.describe);
  const org = ORGANIZATION[answers.organization];
  const size = SIZE[answers.size];
  const tags = [answers.organization];
  const range = new Set(size.range);
  let dieStep = DICE.indexOf(org.die);
  let bonus = size.dmg;
  let hp = org.hp + size.hp;
  let armor = ARMOR[answers.armor];
  let piercing = 0;
  let roll = 'normal';
  const tag = (t) => {
    if (t && !tags.includes(t)) tags.push(t);
  };
  tag(size.tag);
  if (answers.armor === 'magic') tag('magical');

  if (known.has('strength')) {
    bonus += 2;
    tag('forceful');
  }
  if (known.has('offense')) roll = 'best';
  if (known.has('defense')) armor += 1;
  if (known.has('piercing')) piercing += 1;
  if (known.has('endurance')) hp += 4;
  if (known.has('trickery')) tag('stealthy');
  if (known.has('divine')) {
    tag('divine');
    bonus += 2;
  }
  if (known.has('magic')) tag('magical');

  if (marks.has('vicious')) bonus += 2;
  if (marks.has('reach')) range.add('reach');
  if (marks.has('weak')) dieStep -= 1;
  if (marks.has('pierce-metal')) {
    tag('messy');
    piercing += 1;
  }
  if (marks.has('tear-metal')) {
    tag('messy');
    piercing += 3;
  }
  if (marks.has('ignore-armor')) tag('ignores-armor');
  if (marks.has('near')) range.add('near');
  if (marks.has('far')) range.add('far');

  if (describe.has('devious')) {
    tag('devious');
    dieStep -= 1;
  }
  if (describe.has('organized')) tag('organized');
  if (describe.has('intelligent')) tag('intelligent');
  if (describe.has('cautious')) {
    tag('cautious');
    armor += 1;
  }
  if (describe.has('hoarder')) tag('hoarder');
  if (describe.has('planar')) tag('planar');
  if (describe.has('vital')) hp += 4;
  if (describe.has('construct')) tag('construct');
  if (describe.has('terrifying')) tag('terrifying');
  if (describe.has('amorphous')) {
    tag('amorphous');
    armor += 1;
    hp += 3;
  }
  if (describe.has('ancient')) dieStep += 1;
  if (describe.has('pacifist')) roll = roll === 'best' ? 'normal' : 'worst';

  return {
    organization: answers.organization,
    die: DICE[Math.max(0, Math.min(DICE.length - 1, dieStep))],
    bonus,
    roll,
    hp: Math.max(1, hp),
    armor,
    piercing,
    range: [...range],
    tags,
    adaptations: [...new Set([...answers.adaptations, ...extra.adaptations])],
    form: answers.attack.form,
  };
}

// 查看與量測用的一行文字，例如「d8+3，生命 10，護甲 1」
export function blockText(b) {
  const bonus = b.bonus > 0 ? `+${b.bonus}` : b.bonus < 0 ? `${b.bonus}` : '';
  return `d${b.die}${bonus}，生命 ${b.hp}，護甲 ${b.armor}`;
}
