// Mail on the iPhone: the list, tap a mail and it fills the screen, back to the list.
// Usage: node e2e-mail-phone.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-mail'] = process.argv.slice(2);
const PW = 'Mail-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4187, '127.0.0.1');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errors = []; m.on('pageerror', (e) => errors.push(e.message));
  await m.goto('http://127.0.0.1:4187/');
  await m.fill('input[name=password]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('input[name=password2]');
  await m.fill('input[name=password]', PW); await m.fill('input[name=password2]', PW);
  await m.click('button[type=submit]');
  await m.waitForSelector('.recovery', { timeout: 30000 });
  await m.check('.checkrow input'); await m.click('text=Fortsæt');
  await m.waitForSelector('.app');
  await m.evaluate(() => {
    const e = window.__session.engine;
    for (let i = 0; i < 12; i++) e.create('mail', { fromName: `Afsender ${i}`, fromEmail: `a${i}@example.com`, subject: `Mail nummer ${i}`, preview: 'Hej Willads, her er det du bad om …', body: 'Hej Willads,\n\nHer er det du bad om.\n\nVenlig hilsen', html: `<p>Hej Willads,</p><p>Her er <b>det du bad om</b> (mail ${i}).</p><p>Venlig hilsen</p>`, full: true, at: new Date(Date.now() - i * 3600000).toISOString(), unread: i < 3, to: ['wajtranberg@gmail.com'] });
  });
  await m.evaluate(() => { location.hash = '#/inbox'; });
  await m.waitForTimeout(800);
  const res = {};
  res.listVisible = await m.locator('.mlist').isVisible();
  res.readerHiddenAtFirst = !(await m.locator('.reader').first().isVisible());
  await m.screenshot({ path: `${out}/phone-list.png` });
  await m.locator('.mrow').nth(4).tap();
  await m.waitForTimeout(900);
  res.listHiddenWhenOpen = !(await m.locator('.mlist').isVisible());
  res.subject = await m.locator('.reader').first().innerText().then((t) => t.includes('Mail nummer 4'));
  res.frameText = await m.frameLocator('.mailframe').locator('body').innerText().catch(() => '');
  res.readerTop = await m.evaluate(() => Math.round(document.querySelector('.reader').getBoundingClientRect().top + scrollY));
  await m.screenshot({ path: `${out}/phone-mail.png` });
  await m.locator('.phone-back').tap();
  await m.waitForTimeout(600);
  res.backToList = await m.locator('.mlist').isVisible();
  res.errors = errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
