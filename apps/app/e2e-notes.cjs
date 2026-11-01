// The formatted note editor, the iPhone menu and the calendar's day change.
// Usage: node e2e-notes.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-notes'] = process.argv.slice(2);
const PW = 'Noter-test-password-1';
const URL = 'http://127.0.0.1:4182/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4182, '127.0.0.1');

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

  // Mac: write with lists, a checklist, bold and underline.
  const p = await setup(b, { viewport: { width: 1440, height: 900 } });
  await p.evaluate(() => { location.hash = '#/notes'; });
  await p.keyboard.press('Control+n');
  await p.waitForSelector('.cm-content');
  await p.fill('.doc__title', 'Indkøb');
  await p.click('.cm-content');
  await p.keyboard.type('Til weekenden\n');
  await p.keyboard.type('[] mælk\næg\nbrød\n\n');           // checklist, continued by Enter, ended by an empty item
  await p.keyboard.type('- pant\nmad\n\n');                  // bullets
  await p.keyboard.type('1. først\nså\n\n');                 // numbered
  await p.keyboard.press('Control+b'); await p.keyboard.type('vigtigt'); await p.keyboard.press('Control+b');
  await p.keyboard.type(' og ');
  await p.keyboard.press('Control+u'); await p.keyboard.type('husk'); await p.keyboard.press('Control+u');
  await p.waitForTimeout(400);
  res.markdown = await body(p);
  res.checkboxes = await p.locator('.cm-check').count();
  await p.locator('.cm-check').nth(1).dispatchEvent('mousedown');
  await p.waitForTimeout(300);
  res.afterTick = (await body(p)).split('\n').filter((l) => l.includes('[')).join(' | ');
  res.boldShown = await p.locator('.cm-b').count();
  res.underlineShown = await p.locator('.cm-u').count();
  await p.click('.doc__title');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/mac-note.png` });
  // the toolbar: select a line and make it a heading
  await p.click('.cm-line >> nth=0');
  await p.click('.ntool[aria-label="Overskrift"]');
  await p.waitForTimeout(200);
  res.heading = (await body(p)).split('\n')[0];
  res.preview = await p.locator('.nrow__x').first().textContent();
  res.macErrors = p.errors;

  // iPhone: the menu, the calendar and the note.
  const m = await setup(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.evaluate(() => {
    const e = window.__session.engine; const d = new Date(); d.setHours(9, 0, 0, 0);
    for (let i = -2; i < 3; i++) { const s = new Date(d.getTime() + i * 86400000); e.create('event', { title: i ? `Vagt i Netto (${i})` : 'Vagt i Netto', start: s.toISOString(), end: new Date(s.getTime() + 7 * 3600000).toISOString(), place: 'Netto', cat: 'calcat-work' }); e.create('event', { title: 'Frokost med Jonas', start: new Date(s.getTime() + 3.5 * 3600000).toISOString(), end: new Date(s.getTime() + 4.5 * 3600000).toISOString() }); }
    const n = e.create('note', { title: 'Indkøb', folder: 'Indbakke', tags: [], editedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    e.doc(n).getText('body').insert(0, '# Weekend\n- [ ] mælk\n- [x] æg\n- [ ] **økologisk** brød\n\n- pant 440\n- mad 315\n\n++Husk++ at betale Jonas');
  });
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${out}/phone-today.png` });
  await m.click('.mbar__menu');
  await m.waitForTimeout(700);
  await m.screenshot({ path: `${out}/phone-menu.png` });
  res.menuRows = await m.locator('.mrow2, .mcard').count();
  await m.click('.mcard--cal');
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${out}/phone-calendar.png` });
  await m.click('.calm__ev >> nth=0');
  await m.waitForTimeout(500);
  await m.click('.typechip--add');
  await m.fill('.typenew__name', 'Træning');
  await m.click('.typenew .btn');
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${out}/phone-event-types.png` });
  res.typesAfterAdd = await m.locator('.typechip:not(.typechip--add)').count();
  await m.click('.sheet button[type=submit]');
  await m.waitForTimeout(500);
  res.eventCat = await m.evaluate(() => { const e = window.__session.engine; const t = e.list('calcat').find((x) => x.name === 'Træning'); return !!t && e.list('event').some((x) => x.cat === t.id); });
  await m.screenshot({ path: `${out}/phone-calendar-typed.png` });
  await m.click('.calm__more button >> nth=1');
  await m.waitForTimeout(120);
  await m.screenshot({ path: `${out}/phone-calendar-sliding.png` });
  await m.waitForTimeout(600);
  await m.screenshot({ path: `${out}/phone-calendar-next.png` });
  await m.evaluate(() => { location.hash = '#/notes'; });
  await m.waitForTimeout(600);
  await m.click('.nrow >> nth=0');
  await m.waitForSelector('.cm-content');
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${out}/phone-note.png` });
  res.phoneErrors = m.errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
