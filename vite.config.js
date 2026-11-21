import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// api/ holds Vercel serverless functions (lane B). Vite doesn't serve them locally:
// test /api/ask on a Vercel preview, or use the fixture mode in src/client/askApi.js.
export default defineConfig({
  plugins: [react()],
});
