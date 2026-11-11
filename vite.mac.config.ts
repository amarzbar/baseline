import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'mac/ui',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/mac', emptyOutDir: true },
  server: { port: 5181, proxy: { '/api': 'http://127.0.0.1:8770' } },
});
