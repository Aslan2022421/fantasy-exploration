import { describe, expect, test } from 'vitest';
import { DATA } from '../data/load.js';
import { bagEntries } from '../view/bag.js';
import { createWindows } from './windows.js';

const fakePanels = () => ({ window: () => 0 });

describe('大視窗', () => {
  test('B 開背包、再按 B 或 Esc 關；開著時別的鍵都被視窗吃掉，H 換成紀錄', () => {
    const w = createWindows(fakePanels(), { history: () => [], bag: () => [] });
    expect(w.key('KeyQ')).toBe(false);
    expect(w.key('KeyB')).toBe(true);
    expect(w.open).toBe('bag');
    expect(w.key('KeyQ')).toBe(true);
    expect(w.open).toBe('bag');
    expect(w.key('KeyH')).toBe(true);
    expect(w.open).toBe('history');
    expect(w.key('Escape')).toBe(true);
    expect(w.open).toBe(null);
    w.key('KeyB');
    w.key('KeyB');
    expect(w.open).toBe(null);
  });
});

describe('選單與地圖', () => {
  test('沒開視窗時 Esc 打開選單，按 1 匯出、選單留著；再按 Esc 關掉', () => {
    let exports = 0;
    const w = createWindows(fakePanels(), { menu: () => [], export: () => exports++ });
    expect(w.key('Escape')).toBe(true);
    expect(w.open).toBe('menu');
    w.key('Digit1');
    expect(exports).toBe(1);
    expect(w.open).toBe('menu');
    w.key('Escape');
    expect(w.open).toBe(null);
  });

  test('M 的地圖自己畫：拿到外框裡的內容區', () => {
    let body = null;
    const panels = { windowBox: () => ({ x: 1, y: 2, w: 300, h: 200 }) };
    const w = createWindows(panels, {
      map: (_c, _s, b) => {
        body = b;
      },
    });
    w.key('KeyM');
    w.draw(null, {});
    expect(body).toEqual({ x: 1, y: 2, w: 300, h: 200 });
  });
});

describe('背包的內容', () => {
  test('依分類分組、寫數量與單位；空的寫背包是空的', () => {
    expect(bagEntries({}, DATA).map((e) => e.text)).toEqual(['背包是空的。']);
    const text = bagEntries({ 'iron-ore': 3, 'broadleaf-wood': 2, flax: 1, quartz: 0 }, DATA).map((e) => e.text);
    expect(text).toEqual(['礦物', '　鐵礦　3 塊', ' ', '木材', '　闊葉木　2 段', ' ', '植物', '　亞麻　1 株']);
  });
});
