import { defineConfig } from 'vite';

export default defineConfig({
  // 只聽本機的 127.0.0.1：預設的 localhost 在這台電腦只聽 IPv6（::1），Chrome 走 127.0.0.1 時會連不到
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  test: {
    include: ['src/**/*.test.js', 'test/**/*.test.js', 'tools/**/*.test.js'],
    environment: 'node',
  },
});
