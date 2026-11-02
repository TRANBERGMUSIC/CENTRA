// Notes on a calendar event: written in the event, shown in the calendar, none in Noter.
// Usage: node e2e-event-notes.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-evnotes'] = process.argv.slice(2);
const PW = 'Evnote-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4190, '127.0.0.1');
async function setup(b, opts) {
  const p = await (await b.newContext(opts)).newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto('http://127.0.0.1:4190/');
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 30000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');
  await p.evaluate(() => { const e = window.__session.engine; const d = new Date(); d.setHours(10, 0, 0, 0); e.create('event', { title: 'Fly til Barcelona', start: d.toISOString(), end: new Date(d.getTime() + 3 * 3600000).toISOString(), place: 'CPH' }); location.hash = '#/calendar'; });
  await p.waitForTimeout(900);
  return p;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  for (const [dev, opts, evSel] of [['mac', { viewport: { width: 1440, height: 900 } }, '.week__ev'], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '.calm__ev']]) {
    const p = await setup(b, opts);
    await p.locator(evSel).first().click();
    await p.waitForSelector('.evnotes .cm-content');
    await p.click('.evnotes .cm-content');
    await p.keyboard.type('Booking ABC123\nTerminal 3, gate B22\n[] pas\noplader\n');
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${dev}-editor.png` });
    await p.click('.sheet button[type=submit]');
    await p.waitForTimeout(600);
    res[dev] = await p.evaluate(() => { const e = window.__session.engine; const ev = e.list('event')[0]; return { notes: e.doc(ev.id).getText('notes').toString(), preview: ev.notesPreview, notesInNoter: e.list('note').length }; });
    res[dev].shown = await p.locator(`${evSel} .ev__notes`).count();
    await p.screenshot({ path: `${out}/${dev}-calendar.png` });
    // a new event with notes
    if (dev === 'mac') {
      await p.click('text=Ny aftale');
      await p.fill('.gtitle', 'Hotel');
      await p.click('.evnotes .cm-content');
      await p.keyboard.type('Check-in fra 15');
      await p.click('.sheet button[type=submit]');
      await p.waitForTimeout(500);
      res.newEvent = await p.evaluate(() => { const e = window.__session.engine; const ev = e.list('event').find((x) => x.title === 'Hotel'); return ev && { notes: e.doc(ev.id).getText('notes').toString(), preview: ev.notesPreview }; });
    }
    res[dev].errors = p.errors;
  }
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
