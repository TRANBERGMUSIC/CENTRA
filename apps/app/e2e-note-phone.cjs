// A long note on the iPhone scrolls inside the screen (so the keyboard can't push the top away).
// Usage: node e2e-note-phone.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-note'] = process.argv.slice(2);
const PW = 'Mail-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); }); }).listen(4193, '127.0.0.1');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errors = []; m.on('pageerror', (e) => errors.push(e.message));
  await m.goto('http://127.0.0.1:4193/');
  await m.fill('input[name=password]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('input[name=password2]');
  await m.fill('input[name=password]', PW); await m.fill('input[name=password2]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('.recovery', { timeout: 30000 }); await m.check('.checkrow input'); await m.click('text=Fortsæt');
  await m.waitForSelector('.app');
  const id = await m.evaluate(() => { const e = window.__session.engine; const id = e.create('note', { title: 'Lang note', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString() }); e.doc(id).getText('body').insert(0, Array.from({ length: 80 }, (_, i) => `Linje ${i + 1} med lidt tekst om planen.`).join('\n')); return id; });
  await m.evaluate((id) => { location.hash = `#/notes/${id}`; }, id);
  await m.waitForTimeout(1200);
  const r = await m.evaluate(() => { const ed = document.querySelector('.editor.selfscroll'); return { winScrollable: document.documentElement.scrollHeight > innerHeight + 2, edScroll: ed.scrollHeight > ed.clientHeight, edH: ed.clientHeight, pull: getComputedStyle(document.querySelector('.pull')).display }; });
  await m.touchscreen.tap(200, 420);
  await m.keyboard.type(' hej');
  await m.waitForTimeout(300);
  r.titleVisible = await m.evaluate(() => { const t = document.querySelector('.doc__title').getBoundingClientRect(); return t.top >= 0 && t.bottom <= innerHeight; });
  await m.screenshot({ path: `${out}/phone-note.png` });
  r.errors = errors;
  console.log(JSON.stringify(r));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
