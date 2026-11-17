// 建角畫面的操作：開新遊戲時先跑這個，選完回傳 choices（hero.js 的 buildSheet 用）。
// 鍵盤：↑↓ 移動、Enter／空白鍵 確定、數字鍵直接選、R 隨機、Esc 上一步、← → 在加點那一步減加點；
// 滑鼠：移到哪行游標跟到哪行、點一下就選，點 + - 加減點，點路徑列跳回走過的步驟

import { RNG } from 'rot-js';
import { drawCreation, hitButton, hitPath, hitRow } from '../view/creation-view.js';
import { cssSize, layout } from '../view/screen.js';
import { createCreation, STEPS } from './creation-model.js';

// 照視窗大小重排畫布、回傳版面（地圖縮放不影響建角畫面）
function fitCanvas(canvas) {
  const s = layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, 0);
  canvas.width = s.width;
  canvas.height = s.height;
  const css = cssSize(s, window.innerWidth, window.innerHeight);
  canvas.style.width = `${css.w}px`;
  canvas.style.height = `${css.h}px`;
  return s;
}

export function runCreation({ canvas, ctx, panels, data }) {
  const relayout = () => fitCanvas(canvas);
  const m = createCreation(data, RNG.clone().setSeed(Date.now() % 2147483647));
  let screen = relayout();
  let hits = { rows: [], path: [] };

  const render = () => {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hits = drawCreation(ctx, screen, panels, data, m, STEPS);
  };
  const point = (e) => {
    const rect = canvas.getBoundingClientRect();
    const k = canvas.width / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
  };

  return new Promise((resolve) => {
    const finish = () => {
      if (!m.done) return render();
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      resolve(m.done);
    };
    function onKey(e) {
      const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) m.act(Number(digit[2]) - 1);
      else if (e.code === 'ArrowUp') m.move(-1);
      else if (e.code === 'ArrowDown') m.move(1);
      else if (e.code === 'ArrowLeft') m.minus();
      else if (e.code === 'ArrowRight') m.plus();
      else if (e.code === 'Enter' || e.code === 'Space') m.act();
      else if (e.code === 'KeyR' && !e.repeat) m.random();
      else if (e.code === 'Escape') m.back();
      else return;
      e.preventDefault();
      finish();
    }
    function onMove(e) {
      const { x, y } = point(e);
      const row = hitRow(hits, x, y);
      if (row && row.i !== m.cursor) {
        m.point(row.i);
        render();
      }
    }
    function onClick(e) {
      const { x, y } = point(e);
      const p = hitPath(hits, x, y);
      if (p) m.goto(p.i);
      const row = hitRow(hits, x, y);
      const button = hitButton(row, x, y);
      if (button === 'plus') m.plus(row.i);
      else if (button === 'minus') m.minus(row.i);
      else if (row) m.act(row.i);
      finish();
    }
    function onResize() {
      screen = relayout();
      render();
    }
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    render();
  });
}
