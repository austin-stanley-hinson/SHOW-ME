import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// api/ holds Vercel serverless functions (lane B). Vite doesn't serve them locally:
// test /api/ask on a Vercel preview, or use the fixture mode in src/client/askApi.js.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The app, plus lane B's Live Lab test page (/lab/live.html) for trying live mode on a phone.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        liveLab: resolve(import.meta.dirname, 'lab/live.html'),
      },
    },
  },
});
