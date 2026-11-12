import { expect, test } from 'vitest';
import { memoryStore } from './store.js';

test('沒有存檔時回傳預設值', () => {
  expect(memoryStore().load('x', 42)).toBe(42);
});

test('存進去再讀出來一樣，而且是複本', () => {
  const store = memoryStore();
  const value = { player: { x: 3, y: 4 } };
  store.save('k', value);
  value.player.x = 99;
  const back = store.load('k', null);
  expect(back).toEqual({ player: { x: 3, y: 4 } });
  back.player.y = 0;
  expect(store.load('k', null).player.y).toBe(4);
});

test('刪掉之後回到預設值', () => {
  const store = memoryStore();
  store.save('k', 1);
  store.remove('k');
  expect(store.load('k', 'none')).toBe('none');
});
