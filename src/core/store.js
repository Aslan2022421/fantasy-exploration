// 存檔介面：遊戲只透過 load／save／remove 存取，不直接碰 localStorage；桌面版之後換成寫檔案

// 記憶體版：測試與 ?nosave 用，關掉頁面就沒了
export function memoryStore() {
  const mem = new Map();
  return {
    load: (key, fallback) => (mem.has(key) ? structuredClone(mem.get(key)) : fallback),
    save: (key, value) => {
      mem.set(key, structuredClone(value));
    },
    remove: (key) => {
      mem.delete(key);
    },
  };
}

// 瀏覽器版：存在 localStorage，讀寫失敗（私密視窗、被封鎖）時當作沒有存檔
export function browserStore(prefix = 'fe.') {
  return {
    load(key, fallback) {
      try {
        const raw = localStorage.getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    save(key, value) {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch {
        // 存不進去就算了，下次開遊戲從頭開始
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        // 同上
      }
    },
  };
}
