import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the web build under /<repo>/; Tauri and Capacitor load it from the root.
  base: process.env.CENTRA_BASE ?? './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GITHUB_REPOSITORY__: JSON.stringify(process.env.GITHUB_REPOSITORY ?? 'TRANBERGMUSIC/CENTRA'),
  },
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  optimizeDeps: { include: ['libsodium-wrappers-sumo'] },
});
