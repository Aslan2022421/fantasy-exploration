import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 8765, strictPort: true },
  test: {
    include: ['src/**/*.test.js', 'test/**/*.test.js', 'tools/**/*.test.js'],
    environment: 'node',
  },
});
