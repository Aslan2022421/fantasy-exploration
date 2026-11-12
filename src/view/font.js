// 介面文字：Fusion Pixel 12px 是像素字，瀏覽器直接描字會有灰邊，
// 所以每個字先用 8 倍大字描，再每 8×8 取中心點烘焙成點陣，快取起來再蓋到畫面

const BASE = 12; // 字型的設計格
const SAMPLE = 8; // 描字放大倍數

export async function loadPixelFont(url, family) {
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  return createPixelFont(family);
}

function createPixelFont(family) {
  const big = document.createElement('canvas');
  big.width = BASE * SAMPLE * 2;
  big.height = BASE * SAMPLE * 2;
  const g = big.getContext('2d', { willReadFrequently: true });
  g.font = `${BASE * SAMPLE}px "${family}"`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  const metrics = g.measureText('國');
  const ascent = Math.round(metrics.fontBoundingBoxAscent / SAMPLE);
  const rows = Math.round((metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / SAMPLE);

  const glyphs = new Map(); // 字 → 白色點陣
  const tinted = new Map(); // 顏色 → (字 → 染色後的點陣)

  function bake(ch) {
    const cols = Math.max(1, Math.round(g.measureText(ch).width / SAMPLE));
    g.clearRect(0, 0, big.width, big.height);
    g.fillText(ch, 0, ascent * SAMPLE);
    const data = g.getImageData(0, 0, cols * SAMPLE, rows * SAMPLE).data;
    const glyph = document.createElement('canvas');
    glyph.width = cols;
    glyph.height = rows;
    const gg = glyph.getContext('2d');
    const img = gg.createImageData(cols, rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const alpha = data[((y * SAMPLE + SAMPLE / 2) * cols * SAMPLE + (x * SAMPLE + SAMPLE / 2)) * 4 + 3];
        const p = (y * cols + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
        img.data[p + 3] = alpha >= 128 ? 255 : 0;
      }
    }
    gg.putImageData(img, 0, 0);
    return glyph;
  }

  function glyph(ch, color) {
    let byChar = tinted.get(color);
    if (!byChar) {
      byChar = new Map();
      tinted.set(color, byChar);
    }
    let out = byChar.get(ch);
    if (!out) {
      let white = glyphs.get(ch);
      if (!white) {
        white = bake(ch);
        glyphs.set(ch, white);
      }
      out = document.createElement('canvas');
      out.width = white.width;
      out.height = white.height;
      const og = out.getContext('2d');
      og.drawImage(white, 0, 0);
      og.globalCompositeOperation = 'source-in';
      og.fillStyle = color;
      og.fillRect(0, 0, out.width, out.height);
      byChar.set(ch, out);
    }
    return out;
  }

  // 在 (x, y) 從左上角開始畫一行字，scale 是整數倍；回傳畫完的寬度
  function drawText(ctx, text, x, y, scale, color) {
    let cx = x;
    for (const ch of text) {
      const gl = glyph(ch, color);
      ctx.drawImage(gl, cx, y, gl.width * scale, gl.height * scale);
      cx += gl.width * scale;
    }
    return cx - x;
  }

  return { drawText, rows };
}
