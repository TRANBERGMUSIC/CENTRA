// Huskelisten: add, tick off, the alert when it's time, the front page and the iPhone menu.
// Usage: node e2e-reminders.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-reminders'] = process.argv.slice(2);
const PW = 'Husk-test-password-1';
const URL = 'http://127.0.0.1:4185/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4185, '127.0.0.1');
async function setup(b, opts) {
  const p = await (await b.newContext(opts)).newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL);
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 30000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');
  return p;
}
const seed = () => {
  const e = window.__session.engine, h = (m) => new Date(Date.now() + m * 60000).toISOString();
  e.create('reminder', { text: 'Levere udstyr tilbage til Sigge', at: h(95), done: false, createdAt: h(0) });
  e.create('reminder', { text: 'Ringe til tandlægen', at: h(-40), done: false, createdAt: h(-60) });
  e.create('reminder', { text: 'Købe gave til mor', at: null, done: false, createdAt: h(-5) });
  e.create('reminder', { text: 'Afmelde Netflix', at: h(60 * 26), done: false, createdAt: h(-10), source: 'Siri' });
  e.create('reminder', { text: 'Pante flasker', at: null, done: true, doneAt: h(-30), createdAt: h(-200) });
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  const p = await setup(b, { viewport: { width: 1440, height: 900 } });
  await p.evaluate(seed);
  await p.evaluate(() => { location.hash = '#/reminders'; });
  await p.waitForSelector('.hl__add');
  await p.fill('.hl__add > input', 'Hente pakke i Netto');
  await p.click('.hl__chip >> text=Om en time');
  await p.click('.hl__add .btn[type=submit]');
  await p.waitForTimeout(500);
  res.rows = await p.locator('.hl > .hl__row').count();
  res.first = await p.locator('.hl__row .hl__text').first().textContent();
  res.late = await p.locator('.hl__row.is-late').count();
  await p.screenshot({ path: `${out}/mac-reminders.png` });
  await p.locator('.hl__row .hl__check').first().click();
  await p.waitForTimeout(400);
  res.doneAfterTick = await p.evaluate(() => window.__session.engine.list('reminder').filter((r) => r.done).length);
  // due in 1 second: the alert comes within the next round (15 s)
  await p.evaluate(() => window.__session.engine.create('reminder', { text: 'Tag vasketøjet ud', at: new Date(Date.now() + 1000).toISOString(), done: false, createdAt: new Date().toISOString() }));
  await p.locator('.notes-stack .note', { hasText: 'Tag vasketøjet ud' }).first().waitFor({ timeout: 20000 }).catch(() => {});
  res.alert = await p.locator('.notes-stack .note', { hasText: 'Tag vasketøjet ud' }).count();
  await p.screenshot({ path: `${out}/mac-alert.png` });
  await p.evaluate(() => { location.hash = '#/today'; });
  await p.waitForTimeout(900);
  res.todayModule = await p.locator('.hl--mini .hl__row').count();
  await p.locator('.hl--mini').first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${out}/mac-today.png` });
  res.macErrors = p.errors;

  const m = await setup(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.evaluate(seed);
  await m.click('.mbar__menu'); await m.waitForTimeout(700);
  await m.screenshot({ path: `${out}/phone-menu.png` });
  await m.click('.mrow2 >> text=Huskeliste'); await m.waitForTimeout(800);
  await m.screenshot({ path: `${out}/phone-reminders.png` });
  await m.locator('.hl__row .hl__body').first().tap(); await m.waitForTimeout(300);
  await m.screenshot({ path: `${out}/phone-edit.png` });
  res.phoneErrors = m.errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
