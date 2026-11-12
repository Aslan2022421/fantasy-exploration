// 中文斷行：逐字量寬度，超過就換行；標點不放行首（放不下時讓它留在上一行行尾）

const NO_LINE_START = new Set('，。、；：！？）」』》〉…—,.;:!?)]');

// measure(ch) 回傳一個字的寬度；回傳每一行的字串
export function wrap(text, maxWidth, measure) {
  const lines = [];
  let line = '';
  let width = 0;
  for (const ch of text) {
    const w = measure(ch);
    if (ch === '\n') {
      lines.push(line);
      line = '';
      width = 0;
      continue;
    }
    if (width + w > maxWidth && line && !NO_LINE_START.has(ch)) {
      lines.push(line);
      line = '';
      width = 0;
    }
    line += ch;
    width += w;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

// 一行太長時截斷加「…」
export function ellipsis(text, maxWidth, measure) {
  let width = 0;
  let out = '';
  const dots = measure('…');
  for (const ch of text) {
    const w = measure(ch);
    if (width + w > maxWidth) {
      while (out && width + dots > maxWidth) {
        const last = [...out].at(-1);
        out = [...out].slice(0, -1).join('');
        width -= measure(last);
      }
      return `${out}…`;
    }
    out += ch;
    width += w;
  }
  return out;
}
