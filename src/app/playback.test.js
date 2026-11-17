import { expect, test } from 'vitest';
import { framesFrom } from './playback.js';

test('生物移動照走過的每一格各出一格畫面，出手時停一下；訊息播到哪一筆才顯示到哪一筆', () => {
  const records = [
    { id: 10, verb: 'engage', data: { foes: [{ id: 'a', x: 0, y: 0, hp: 15 }] } },
    {
      id: 11,
      verb: 'cmove',
      actor: 'a',
      data: {
        from: { x: 0, y: 0 },
        to: { x: 2, y: 0 },
        path: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    },
    { id: 12, verb: 'attack', actor: 'a', target: 'player', data: { hp: 12 } },
  ];
  const frames = framesFrom(records, {});
  const at = frames.map((f) => (f.creatures.a ? `${f.creatures.a.x},${f.creatures.a.y}` : '-'));
  expect(at).toEqual(['0,0', '1,0', '2,0', '2,0']);
  expect(frames.map((f) => f.upTo)).toEqual([11, 11, 11, 13]);
  expect(frames[3].ms).toBeGreaterThan(frames[1].ms);
});

test('冒險者打倒的生物在那一格畫面消失', () => {
  const records = [{ id: 5, verb: 'attack', actor: 'player', target: 'a', data: { hp: 0 } }];
  const frames = framesFrom(records, { a: { x: 3, y: 3, hp: 4 } });
  expect(frames.at(-1).creatures.a).toMatchObject({ dead: true, hp: 0 });
});
