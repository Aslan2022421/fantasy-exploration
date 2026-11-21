import { describe, expect, test } from 'vitest';
import { buildBlock, ENV_VARIANTS, envExtras } from './blocks.js';
import { DATA } from './load.js';
import { BlockSchema } from './species-schema.js';

const base = {
  organization: 'group',
  size: 'human',
  armor: 'flesh',
  known: [],
  attack: { form: '咬', marks: [] },
  describe: [],
  adaptations: [],
};
const make = (over = {}) => ({ ...base, ...over, attack: { ...base.attack, ...(over.attack ?? {}) } });

describe('問答換算成數值塊', () => {
  test('組織決定傷害骰與生命的起點', () => {
    expect(buildBlock(make({ organization: 'horde' }))).toMatchObject({ die: 6, hp: 3 });
    expect(buildBlock(make({ organization: 'group' }))).toMatchObject({ die: 8, hp: 6 });
    expect(buildBlock(make({ organization: 'solitary' }))).toMatchObject({ die: 10, hp: 12 });
  });

  test('體型：傷害、生命、距離、標籤', () => {
    expect(buildBlock(make({ size: 'tiny' }))).toMatchObject({ bonus: -2, range: ['hand'], tags: ['group', 'tiny'] });
    expect(buildBlock(make({ size: 'large' }))).toMatchObject({ bonus: 1, hp: 10, range: ['close', 'reach'] });
    expect(buildBlock(make({ size: 'huge' }))).toMatchObject({ bonus: 3, hp: 14, range: ['reach'] });
  });

  test('防禦、著稱、攻擊、描述各自加減', () => {
    const b = buildBlock(
      make({
        armor: 'scale',
        known: ['strength', 'defense', 'piercing', 'endurance', 'trickery'],
        attack: { form: '螫', marks: ['vicious', 'pierce-metal'] },
        describe: ['cautious', 'vital'],
      }),
    );
    expect(b).toMatchObject({ armor: 4, bonus: 4, hp: 14, piercing: 2 });
    expect(b.tags).toEqual(expect.arrayContaining(['forceful', 'stealthy', 'messy', 'cautious']));
  });

  test('傷害骰升降一級、不會超出 d4～d12；擲兩次取好的或壞的', () => {
    expect(buildBlock(make({ attack: { form: 'x', marks: ['weak'] } })).die).toBe(6);
    expect(
      buildBlock(make({ organization: 'horde', attack: { form: 'x', marks: ['weak'] }, describe: ['devious'] })).die,
    ).toBe(4);
    expect(buildBlock(make({ organization: 'solitary', describe: ['ancient'] })).die).toBe(12);
    expect(buildBlock(make({ known: ['offense'] })).roll).toBe('best');
    expect(buildBlock(make({ describe: ['pacifist'] })).roll).toBe('worst');
    expect(buildBlock(make({ known: ['offense'], describe: ['pacifist'] })).roll).toBe('normal');
  });

  test('生命至少 1', () => {
    expect(buildBlock(make({ organization: 'horde', size: 'tiny' })).hp).toBeGreaterThanOrEqual(1);
  });

  test('環境加答案：寒帶多耐力、山地多善攀、潮濕靠水多兩棲；已經有的不重複加', () => {
    const cold = buildBlock(make(), { cold: true });
    expect(cold.hp).toBe(buildBlock(make()).hp + 4);
    expect(buildBlock(make({ known: ['endurance'] }), { cold: true }).hp).toBe(
      buildBlock(make({ known: ['endurance'] })).hp,
    );
    expect(buildBlock(make({ adaptations: ['climb'] }), { mountain: true, water: true }).adaptations).toEqual([
      'climb',
      'amphibious',
    ]);
    expect(envExtras({})).toEqual({ known: [], adaptations: [] });
    expect(ENV_VARIANTS).toHaveLength(8);
  });
});

// 27 種各自的結果：傷害骰＋修正、生命、護甲、穿透（Claude 擬的答案表，使用者看過）
const EXPECTED = {
  mammoth: [8, 7, 14, 1, 0],
  'polar-bear': [10, 3, 16, 1, 0],
  'winter-wolf': [8, 1, 10, 1, 0],
  elk: [6, 1, 7, 0, 0],
  wolf: [8, 0, 6, 1, 0],
  'brown-bear': [10, 3, 16, 1, 0],
  'giant-elk': [8, 5, 14, 1, 0],
  'dire-wolf': [8, 3, 10, 1, 0],
  'black-bear': [10, 0, 12, 1, 0],
  deer: [4, 0, 3, 0, 0],
  boar: [8, 2, 6, 1, 0],
  'giant-spider': [8, 1, 16, 2, 0],
  panther: [10, 0, 12, 0, 1],
  camel: [6, 1, 14, 0, 0],
  jackal: [6, 0, 6, 0, 0],
  'giant-scorpion': [8, 3, 16, 3, 0],
  elephant: [8, 5, 18, 1, 0],
  hyena: [6, 0, 3, 0, 0],
  lion: [8, 3, 10, 0, 0],
  ape: [8, 0, 6, 0, 0],
  tiger: [10, 3, 16, 0, 0],
  'giant-constrictor-snake': [10, 5, 20, 1, 0],
  crocodile: [8, 1, 10, 2, 0],
  'giant-frog': [8, 0, 6, 0, 0],
  goat: [6, 0, 6, 0, 0],
  'giant-eagle': [10, 1, 16, 0, 1],
  'saber-toothed-tiger': [10, 5, 16, 1, 0],
  // 怪物（階段 6）：答案照 Dungeon World 原書的數值塊反推（使用者同意當雛形）
  goblin: [6, 0, 3, 1, 0],
  skeleton: [6, 0, 7, 1, 0],
  troll: [10, 3, 20, 1, 0],
};

describe('實際的物種資料', () => {
  test('27 種動物加 3 種怪物，每種的換算結果照答案表', () => {
    expect(DATA.species).toHaveLength(30);
    for (const s of DATA.species) {
      const b = buildBlock(s.answers);
      expect(BlockSchema.safeParse(b).success, s.id).toBe(true);
      expect([b.die, b.bonus, b.hp, b.armor, b.piercing], s.id).toEqual(EXPECTED[s.id]);
    }
  });

  test('疊層與佔地：象類 3×2 疊 3 層、巨蟒 3×2 疊 2 層、狼 1×1、獅子 2×1、駱駝 2×2；貨車大小以上的字元大寫，其餘小寫', () => {
    const by = (id) => DATA.species[DATA.speciesIndex.get(id)];
    expect([by('mammoth').footprint, by('mammoth').height]).toEqual(['3x2', 3]);
    expect([by('elephant').footprint, by('elephant').height]).toEqual(['3x2', 3]);
    expect([by('giant-constrictor-snake').footprint, by('giant-constrictor-snake').height]).toEqual(['3x2', 2]);
    expect(['wolf', 'lion', 'camel'].map((id) => by(id).footprint)).toEqual(['1x1', '2x1', '2x2']);
    for (const s of DATA.species) {
      const big = ['large', 'huge'].includes(s.answers.size);
      expect(s.glyph === s.glyph.toUpperCase(), s.id).toBe(big);
    }
  });

  test('每個生態至少有一種草食與一種掠食；山地也有', () => {
    const lowland = (b) => (s) => s.habitat.some((r) => r.biomes?.includes(b) && r.mountain === false);
    for (const b of DATA.biomes) {
      for (const diet of ['herbivore', 'predator'])
        expect(
          DATA.species.some((s) => s.diet === diet && lowland(b.id)(s)),
          `${b.id} ${diet}`,
        ).toBe(true);
    }
    for (const diet of ['herbivore', 'predator'])
      expect(DATA.species.some((s) => s.diet === diet && s.habitat.some((r) => r.mountain === true))).toBe(true);
  });
});
