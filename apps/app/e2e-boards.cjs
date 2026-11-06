// Boards: make one, add cards, drag a card to another list with the mouse, open a card, on the Mac and the iPhone.
// Usage: node e2e-boards.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-boards'] = process.argv.slice(2);
const PW = 'Mail-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); }); }).listen(4194, '127.0.0.1');
async function setup(b, viewport, mobile) {
  const m = await (await b.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })).newPage();
  const errors = []; m.on('pageerror', (e) => errors.push(e.message));
  await m.goto('http://127.0.0.1:4194/');
  await m.fill('input[name=password]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('input[name=password2]');
  await m.fill('input[name=password]', PW); await m.fill('input[name=password2]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('.recovery', { timeout: 30000 }); await m.check('.checkrow input'); await m.click('text=Fortsæt');
  await m.waitForSelector('.app');
  return { m, errors };
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  const { m, errors } = await setup(b, { width: 1320, height: 860 }, false);
  await m.evaluate(() => { location.hash = '#/boards'; });
  await m.waitForTimeout(700);
  await m.click('text=Nyt board');
  await m.fill('input[aria-label="Navn på board"]', 'Yami Sushi hjemmeside');
  await m.click('button:has-text("Opret")');
  await m.waitForTimeout(600);
  res.lists = await m.locator('.bl__name').evaluateAll((l) => l.map((x) => x.value));
  const first = m.locator('.bl').first();
  await first.locator('text=Tilføj kort').click();
  for (const t of ['Menukort med priser', 'Billeder af retter', 'Domæne og hosting']) { await m.keyboard.type(t); await m.keyboard.press('Enter'); }
  await m.keyboard.press('Escape');
  await m.waitForTimeout(300);
  res.cards = await first.locator('.bc__title').allInnerTexts();
  // Drag "Billeder af retter" to "I gang"
  const card = first.locator('.bc', { hasText: 'Billeder af retter' });
  const box = await card.boundingBox();
  const target = await m.locator('.bl').nth(1).locator('.bl__cards').boundingBox();
  await m.mouse.move(box.x + 40, box.y + 15); await m.mouse.down();
  await m.mouse.move(box.x + 60, box.y + 25, { steps: 4 });
  await m.mouse.move(target.x + 80, target.y + 20, { steps: 12 });
  await m.waitForTimeout(200);
  await m.screenshot({ path: `${out}/mac-drag.png` });
  await m.mouse.up();
  await m.waitForTimeout(400);
  res.afterDrag = await m.locator('.bl[data-list]').evaluateAll((ls) => ls.map((l) => [l.querySelector('.bl__name').value, Array.from(l.querySelectorAll('.bc__title')).map((x) => x.textContent)]));
  // Open a card, add a deadline, a label and a checklist
  await m.locator('.bc', { hasText: 'Menukort med priser' }).click();
  await m.waitForTimeout(400);
  await m.fill('.csheet input[type=datetime-local]', '2026-11-20T12:00');
  await m.locator('.csheet__labels button').nth(1).click();
  await m.fill('.csheet__addcheck input', 'Hent priser fra Yami'); await m.keyboard.press('Enter');
  await m.fill('.csheet__addcheck input', 'Oversæt til engelsk'); await m.keyboard.press('Enter');
  await m.locator('.csheet__checks .bc__check').first().click();
  await m.fill('.csheet__notes', 'Både frokost og aften.');
  await m.waitForTimeout(200);
  await m.screenshot({ path: `${out}/mac-card.png` });
  await m.click('.csheet >> text=Færdig');
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${out}/mac-board.png` });
  res.card = await m.evaluate(() => { const c = window.__session.engine.list('bcard').find((x) => x.title === 'Menukort med priser'); return { due: c.due, labels: c.labels, check: c.checklist.map((x) => [x.text, x.done]), notes: c.notes }; });
  await m.evaluate(() => { location.hash = '#/boards'; });
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${out}/mac-overview.png` });
  res.macErrors = errors;
  // iPhone
  const p = await setup(b, { width: 390, height: 844 }, true);
  const id = await p.m.evaluate(() => {
    const e = window.__session.engine;
    const id = e.create('board', { name: 'Køter lager', color: 'teal', order: 1000, labels: [], createdAt: new Date().toISOString() });
    ['Skal laves', 'I gang', 'Færdig'].forEach((n, i) => e.create('blist', { board: id, name: n, order: (i + 1) * 1000 }));
    const lists = e.list('blist').filter((l) => l.board === id).sort((a, b) => a.order - b.order);
    ['Tæl Funktion-One højttalere', 'Kabler til lørdag', 'Ny hylde'].forEach((t, i) => e.create('bcard', { board: id, list: lists[0].id, title: t, order: (i + 1) * 1000, labels: i === 0 ? ['red'] : [], checklist: [], due: i === 1 ? new Date(Date.now() - 3600_000).toISOString() : null }));
    return id;
  });
  await p.m.evaluate((id) => { location.hash = `#/boards/${id}`; }, id);
  await p.m.waitForTimeout(800);
  await p.m.screenshot({ path: `${out}/phone-board.png` });
  await p.m.locator('.bc').first().tap();
  await p.m.waitForTimeout(500);
  await p.m.screenshot({ path: `${out}/phone-card.png` });
  res.phoneErrors = p.errors;
  console.log(JSON.stringify(res, null, 1));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
