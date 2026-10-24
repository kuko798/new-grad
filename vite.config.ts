import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API (geocoding proxy, health) runs from `npm start` on port 8787.
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
