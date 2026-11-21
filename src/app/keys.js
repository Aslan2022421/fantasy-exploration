// 鍵盤（從 main.js 拆出來）：方向鍵走路、大視窗的鍵、縮放、Q 動手、空白鍵出發或停下、R 休息。
// 生物的回合播放中只接受空白鍵、Esc（停下自動走）；Esc 在自動走路中先停下，沒開視窗時打開選單

import { createKeyboard } from './input.js';

// env：{ windows, actions, zoom, resize(), render() }
export function bindKeys({ windows, actions, zoom, resize, render }) {
  const keyboard = createKeyboard((dx, dy) => {
    if (windows.open) return;
    actions.step(dx, dy);
    render();
  });

  window.addEventListener('keydown', (e) => {
    if (actions.busy) {
      e.preventDefault();
      if ((e.code === 'Space' || e.code === 'Escape') && actions.walking.length) actions.stop();
      return;
    }
    if (e.code === 'Escape' && !windows.open && actions.walking.length) {
      e.preventDefault();
      actions.stop();
      render();
      return;
    }
    if (e.code === 'Escape' && !windows.open) windows.resetMenu();
    if (windows.key(e.code)) {
      e.preventDefault();
      actions.stop();
      render();
      return;
    }
    if (zoom.isKey(e)) {
      e.preventDefault();
      if (zoom.press(e)) resize();
      return;
    }
    if (e.code === 'KeyQ' || e.code === 'Space' || e.code === 'KeyR') {
      e.preventDefault();
      // 空白鍵：走路中停下；選定了目標、畫出路線時出發
      if (e.code === 'KeyQ') actions.actOnTarget();
      else if (e.code === 'KeyR') {
        if (!e.repeat && !windows.open) actions.rest();
      } else if (actions.walking.length) actions.stop();
      else if (!windows.open && !e.repeat) actions.startRoute();
      render();
      return;
    }
    if (keyboard.keydown(e.code, e.repeat)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keyboard.keyup(e.code));
  window.addEventListener('blur', () => keyboard.clear());
}
