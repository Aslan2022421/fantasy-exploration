import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 這一版是哪一筆提交（狀態列與 Esc 選單顯示，試玩時分得出是哪一次打包的）；工作區有沒提交的改動時加 +
function buildId() {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim();
    const dirty = execSync('git status --porcelain').toString().trim() ? '+' : '';
    return `${hash}${dirty}`;
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  // 打包成單一 HTML（字型、字元表、程式全部內嵌），任何瀏覽器雙擊就能開，不需要伺服器
  plugins: [viteSingleFile({ removeViteModuleLoader: true, outputFileName: 'Fantasy Exploration.html' })],
  // 只聽本機的 127.0.0.1：預設的 localhost 在這台電腦只聽 IPv6（::1），Chrome 走 127.0.0.1 時會連不到。
  // npm run play 的參數也寫了一份，Vite 自動重啟時才一定會帶上
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  test: {
    include: ['src/**/*.test.js', 'test/**/*.test.js', 'tools/**/*.test.js'],
    environment: 'node',
    // 很多測試要生成世界（一區十幾到幾十毫秒、起點附近幾十區），平行跑時 5 秒不夠
    testTimeout: 15000,
  },
});
