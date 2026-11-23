import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Vite dev server proxies API calls to the Express server so `npm run dev:client`
    // gives HMR without a second origin / CORS.
    proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' },
  },
});
