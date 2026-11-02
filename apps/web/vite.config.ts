import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Consume shared TypeScript source directly in dev/test/build (no prebuild needed for the web app).
      '@gps/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // MapLibre's worker is bundled by Vite (see LiveMap.tsx) as an ES module worker, because MapLibre starts it with type "module".
  worker: { format: 'es' },
  server: {
    port: 5273,
    strictPort: true,
    // ws: true — the live feed (Socket.IO, path /api/v1/socket) is a WebSocket.
    proxy: { '/api': { target: 'http://localhost:3100', changeOrigin: false, ws: true } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
