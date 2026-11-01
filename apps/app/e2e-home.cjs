// The front page you arrange yourself: drag (Mac and iPhone), hide, add, sizes, kept after reload.
// Usage: node e2e-home.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-notes'] = process.argv.slice(2);
const PW = 'Noter-test-password-1';
const URL = 'http://127.0.0.1:4183/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4183, '127.0.0.1');

async function setup(b, opts) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
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
const body = (p) => p.evaluate(() => { const e = window.__session.engine; const n = e.list('note')[0]; return e.doc(n.id).getText('body').toString(); });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  const order = (p) => p.$$eval('.hw', (xs) => xs.map((x) => x.dataset.id));
  for (const [dev, opts] of [['mac', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const p = await setup(b, opts);
    await p.evaluate(() => {
      const e = window.__session.engine;
      const n = e.create('note', { title: 'Indkøb', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
      e.doc(n).getText('body').insert(0, '- [ ] mælk\n- [ ] æg\n- [x] brød');
    });
    await p.waitForTimeout(400);
    const before = await order(p);
    await p.click('button:has-text("Tilpas")');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/${dev}-arrange.png` });
    // drag the third module above the first by its grip
    const grip = p.locator('.hw__grip').nth(2);
    const g = await grip.boundingBox();
    const first = await p.locator('.hw').first().boundingBox();
    await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 12; i++) { await p.mouse.move(g.x + g.width / 2, g.y + (first.y + 20 - g.y) * i / 12); await p.waitForTimeout(60); if (process.env.DBG) console.log(dev, i, Math.round(g.y + (first.y + 20 - g.y) * i / 12), (await order(p)).slice(0,4).join(','), await p.evaluate(() => { const d = document.querySelector('.hw.is-dragging'); return d ? Math.round(d.getBoundingClientRect().top) : null; })); }
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${dev}-dragging.png` });
    await p.mouse.up();
    await p.waitForTimeout(400);
    const dragged = await order(p);
    // hide the second, add Seneste billeder
    await p.locator('.hw__hide').nth(1).click();
    await p.waitForTimeout(300);
    await p.click('.hw__addrow:has-text("Seneste billeder")');
    await p.waitForTimeout(300);
    if (dev === 'mac') { await p.locator('.hw').first().locator('.hw__sizes button:has-text("Smal")').click(); await p.waitForTimeout(300); }
    await p.screenshot({ path: `${out}/${dev}-arranged.png`, fullPage: true });
    await p.click('button:has-text("Færdig")');
    await p.waitForTimeout(400);
    const after = await order(p);
    // tick off on the checklist module
    await p.locator('.hcheck__row').first().click();
    await p.waitForTimeout(300);
    const ticked = await p.evaluate(() => { const e = window.__session.engine; const n = e.list('note')[0]; return e.doc(n.id).getText('body').toString().split('\n')[0]; });
    await p.screenshot({ path: `${out}/${dev}-home.png`, fullPage: true });
    res[dev] = { before, dragged, after, movedToTop: dragged[0] === before[2], photosAdded: after.includes('photos'), ticked, errors: p.errors };
  }
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
