import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'pwa',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/pwa', emptyOutDir: true },
  server: {
    port: 5180,
    proxy: { '/api': 'http://localhost:3020', '/photos': 'http://localhost:3020' },
  },
});
