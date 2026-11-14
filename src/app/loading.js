// 開遊戲時先在狀態列寫一行（世界 96×96 區，建世界要一兩秒，不要讓畫面空白），等瀏覽器畫出來再繼續
import { cssSize, layout } from '../view/screen.js';

export async function showLoading(canvas, ctx, panels, text) {
  window.__feStarting = true; // index.html 看到這個就不出「開發用頁面跑不起來」的提示
  const s = layout(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, 0);
  canvas.width = s.width;
  canvas.height = s.height;
  const css = cssSize(s, window.innerWidth, window.innerHeight);
  canvas.style.width = `${css.w}px`;
  canvas.style.height = `${css.h}px`;
  panels.status(ctx, s, text);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
