import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Strict Content-Security-Policy for production builds (dev needs Vite's inline HMR scripts).
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:8787 ws://127.0.0.1:8787 wss: https://github.com https://objects.githubusercontent.com https://api.anthropic.com http://localhost:11434 http://127.0.0.1:11434 ipc: http://ipc.localhost; media-src 'self' blob: mediastream:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const csp = { name: 'centra-csp', apply: 'build' as const, transformIndexHtml: (html: string) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`) };

export default defineConfig({
  plugins: [react(), csp],
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
