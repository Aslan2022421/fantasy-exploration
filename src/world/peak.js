// 山峰：比周圍 r 格內（方形範圍）每一格都高的格子。只拿上下左右比的話，平頂上的小起伏也會被算進去。
// h 是一整塊高度格（一列 stride 格），c 是要看的那格；呼叫的人要保證四周至少留了 r 圈
export function isPeak(h, c, stride, r) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if ((dx || dy) && h[c + dy * stride + dx] >= h[c]) return false;
    }
  }
  return true;
}
