// 讀 TrueType 字型的 cmap 表，回傳字型有字形的碼位集合（給字的檢查用）
// 支援 Unicode 的 format 12（全平面）與 format 4（基本平面），夠讀 Fusion Pixel

export function fontCodepoints(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = view.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...buf.subarray(rec, rec + 4));
    if (tag === 'cmap') cmap = view.getUint32(rec + 8);
  }
  if (cmap < 0) throw new Error('字型沒有 cmap 表');
  const subtables = [];
  const count = view.getUint16(cmap + 2);
  for (let i = 0; i < count; i++) {
    const p = cmap + 4 + i * 8;
    subtables.push({
      platform: view.getUint16(p),
      encoding: view.getUint16(p + 2),
      offset: cmap + view.getUint32(p + 4),
    });
  }
  const pick = (pl, enc) => subtables.find((s) => s.platform === pl && s.encoding === enc);
  const full = pick(3, 10) ?? pick(0, 4) ?? pick(0, 6);
  const bmp = pick(3, 1) ?? pick(0, 3);
  const codes = new Set();
  if (full && view.getUint16(full.offset) === 12) {
    const groups = view.getUint32(full.offset + 12);
    for (let g = 0; g < groups; g++) {
      const p = full.offset + 16 + g * 12;
      const start = view.getUint32(p);
      const end = view.getUint32(p + 4);
      for (let c = start; c <= end; c++) codes.add(c);
    }
    return codes;
  }
  if (bmp && view.getUint16(bmp.offset) === 4) {
    const o = bmp.offset;
    const segs = view.getUint16(o + 6) / 2;
    const ends = o + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = view.getUint16(ends + s * 2);
      const start = view.getUint16(starts + s * 2);
      const delta = view.getInt16(deltas + s * 2);
      const range = view.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph;
        if (range === 0) glyph = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + range + (c - start) * 2;
          glyph = view.getUint16(at);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) codes.add(c);
      }
    }
    return codes;
  }
  throw new Error('找不到看得懂的 Unicode cmap 子表');
}
