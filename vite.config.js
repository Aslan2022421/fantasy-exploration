import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // 打包成單一 HTML（字型、字元表、程式全部內嵌），任何瀏覽器雙擊就能開，不需要伺服器
  plugins: [viteSingleFile({ removeViteModuleLoader: true, outputFileName: 'Fantasy Exploration.html' })],
  // 只聽本機的 127.0.0.1：預設的 localhost 在這台電腦只聽 IPv6（::1），Chrome 走 127.0.0.1 時會連不到。
  // npm run play 的參數也寫了一份，Vite 自動重啟時才一定會帶上
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  test: {
    include: ['src/**/*.test.js', 'test/**/*.test.js', 'tools/**/*.test.js'],
    environment: 'node',
  },
});
