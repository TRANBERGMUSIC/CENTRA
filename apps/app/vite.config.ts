import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Strict Content-Security-Policy for production builds (dev needs Vite's inline HMR scripts).
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; frame-src 'self' about: data: blob:; font-src 'self'; connect-src 'self' ws://localhost:8787 ws://127.0.0.1:8787 wss: https://github.com https://objects.githubusercontent.com https://api.anthropic.com http://localhost:11434 http://127.0.0.1:11434 ipc: http://ipc.localhost; media-src 'self' blob: mediastream:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const csp = { name: 'centra-csp', apply: 'build' as const, transformIndexHtml: (html: string) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`) };

// Fast interface updates: every build says which version it is (seconds since the commit) and the
// native API level it needs (apps/desktop/src-tauri/native-api). The Mac app reads this file.
const WEB_VERSION = Number(process.env.WEB_VERSION) || Math.floor(Date.now() / 1000);
const NATIVE_API = Number(readFileSync(new URL('../desktop/src-tauri/native-api', import.meta.url), 'utf8').trim()) || 1;
const webVersion = { name: 'centra-web-version', apply: 'build' as const, generateBundle(this: any) {
  this.emitFile({ type: 'asset', fileName: 'web-version.json', source: JSON.stringify({ version: WEB_VERSION, needsNative: NATIVE_API }) + '\n' });
} };

// pdf.js's fonts for PDFs that don't carry their own (Helvetica, Times …) and its image decoders.
const pdfDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfAssets = { name: 'centra-pdfjs-assets', apply: 'build' as const, generateBundle(this: any) {
  for (const sub of ['standard_fonts', 'wasm']) {
    for (const f of readdirSync(join(pdfDir, sub)).filter((x) => !/quickjs/i.test(x))) this.emitFile({ type: 'asset', fileName: `pdfjs/${sub}/${f}`, source: readFileSync(join(pdfDir, sub, f)) });
  }
} };

export default defineConfig({
  plugins: [react(), csp, webVersion, pdfAssets],
  // GitHub Pages serves the web build under /<repo>/; Tauri and Capacitor load it from the root.
  base: process.env.CENTRA_BASE ?? './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __WEB_VERSION__: JSON.stringify(WEB_VERSION),
    __GITHUB_REPOSITORY__: JSON.stringify(process.env.GITHUB_REPOSITORY ?? 'TRANBERGGROUP/CENTRA'),
  },
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  // Two pages: CENTRA itself, and the browser window's toolbar.
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { main: new URL('./index.html', import.meta.url).pathname, browser: new URL('./browser.html', import.meta.url).pathname } } },
  optimizeDeps: { include: ['libsodium-wrappers-sumo'] },
});
