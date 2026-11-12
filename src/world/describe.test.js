import { expect, test } from 'vitest';
import { describeRecord, logLines } from './describe.js';

const move = (id, dir, cause = null, time = id) => ({ id, time, verb: 'move', data: { dir }, cause });

test('每種紀錄都寫得出一行', () => {
  expect(describeRecord({ verb: 'start', data: {} })).toBe('來到這片土地。');
  expect(describeRecord(move(1, 'ne'))).toBe('往東北走');
  expect(describeRecord({ verb: 'examine', target: { x: 3, y: 4 }, data: { what: '空地' } })).toBe('查看 (3, 4)：空地');
  expect(describeRecord({ verb: 'plan', target: { x: 3, y: 4 }, data: { steps: 7 } })).toBe('決定走到 (3, 4)，共 7 步');
});

test('連續同方向、同起因的移動併成一行', () => {
  const lines = logLines([move(1, 'e', 0), move(2, 'e', 0), move(3, 'e', 0), move(4, 's', 0), move(5, 'e', 0)]);
  expect(lines.map((l) => l.text)).toEqual(['往東走 3 步', '往南走', '往東走']);
  expect(lines[0].time).toBe(1);
});

test('起因不同就不併', () => {
  const lines = logLines([move(1, 'e', null), move(2, 'e', 9)]);
  expect(lines).toHaveLength(2);
});
