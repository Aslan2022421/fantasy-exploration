// 把紀錄寫成給玩家看的一行字。連續、同方向、同起因的移動併成一行

const DIR_NAMES = { n: '北', ne: '東北', e: '東', se: '東南', s: '南', sw: '西南', w: '西', nw: '西北' };

export function describeRecord(rec) {
  const d = rec.data ?? {};
  switch (rec.verb) {
    case 'start':
      return '來到這片土地。';
    case 'move':
      return `往${DIR_NAMES[d.dir] ?? '?'}走`;
    case 'plan':
      return `決定走到 (${rec.target.x}, ${rec.target.y})，共 ${d.steps} 步`;
    case 'examine':
      return `查看 (${rec.target.x}, ${rec.target.y})：${d.what}`;
    case 'blocked':
      return '有東西擋住了路，停了下來。';
    default:
      return rec.verb;
  }
}

// 紀錄 → 顯示用的行：{ time, text }；連續同方向、同起因的移動併成「往東走 3 步」
export function logLines(records) {
  const lines = [];
  let run = null;
  for (const rec of records) {
    const sameRun =
      run &&
      rec.verb === 'move' &&
      run.rec.verb === 'move' &&
      rec.data.dir === run.rec.data.dir &&
      rec.cause === run.rec.cause;
    if (sameRun) {
      run.count++;
      run.line.text = `${describeRecord(run.rec)} ${run.count} 步`;
      continue;
    }
    const line = { time: rec.time, text: describeRecord(rec), verb: rec.verb };
    lines.push(line);
    run = rec.verb === 'move' ? { rec, count: 1, line } : null;
  }
  return lines;
}
