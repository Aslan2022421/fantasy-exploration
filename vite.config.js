import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // 打包成單一 HTML（字型、字元表、程式全部內嵌），任何瀏覽器雙擊就能開，不需要伺服器
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  // 只聽本機的 127.0.0.1：預設的 localhost 在這台電腦只聽 IPv6（::1），Chrome 走 127.0.0.1 時會連不到。
  // 同樣的設定也寫在 npm run play 的參數裡：設定檔被改動時 Vite 會自動重啟，曾有一次重啟後沒讀到這裡、
  // 跑到預設的 5173 埠；寫在參數裡則重啟一定會帶上
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  test: {
    include: ['src/**/*.test.js', 'test/**/*.test.js', 'tools/**/*.test.js'],
    environment: 'node',
  },
});
