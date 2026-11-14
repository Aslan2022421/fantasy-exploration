// 匯出試玩紀錄：把存檔（種子＋紀錄＋檢查點）加上匯出時間與版本，下載成 JSON。
// 使用者把檔案交給 Claude，用 tools/read-playlog.mjs 讀出走了哪裡、採到什麼

// 檔名用匯出時的本地時間：fantasy-exploration-20261114-2130.json
export function playlogName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `fantasy-exploration-${stamp}.json`;
}

export function downloadPlaylog(game, version) {
  const data = { exported: new Date().toISOString(), version, ...game.serialize() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const name = playlogName();
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
