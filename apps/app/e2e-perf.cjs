// Speed and layout on a phone: a realistic amount of data (mail with bodies, notes, events, photos),
// a slow CPU, and every screen photographed at iPhone size.
// Usage: node e2e-perf.cjs <dist built with VITE_E2E=1> <outdir> [mobile|desktop]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-perf', MODE = 'mobile'] = process.argv.slice(2);
const PW = 'Perf-test-password-1';
const URL = 'http://127.0.0.1:4181/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4181, '127.0.0.1');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const mobile = MODE === 'mobile';
  const ctx = await b.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
    : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const res = {};
  const login = async () => { await p.fill('input[name=password]', PW); await p.click('button[type=submit]'); };

  await p.goto(URL); await login();
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 30000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');

  // A year of use: 900 mails (text + html), 120 notes, 300 events, 20 photos, contacts, usage log.
  res.seedMs = await p.evaluate(() => {
    const t0 = performance.now();
    const e = window.__session.engine;
    const words = 'hej tak for sidst vi ses i morgen husk mødet om vagtplanen og kassen pant mad snus koncert lys laser musik'.split(' ');
    const txt = (n) => Array.from({ length: n }, (_, i) => words[(i * 7 + n) % words.length]).join(' ');
    const now = Date.now();
    for (let i = 0; i < 900; i++) e.set('mail', 'm-a-' + i, { acct: 'a', acctName: 'Gmail', uid: i, fromName: 'Afsender ' + (i % 40), fromEmail: `a${i % 40}@x.dk`, to: ['mig@x.dk'], subject: 'Emne ' + txt(6), at: new Date(now - i * 3600e3).toISOString(), preview: txt(30), body: txt(500), html: '<p>' + txt(4000) + '</p>', unread: i % 5 === 0, cat: ['Personer', 'Nyhedsbreve', 'Notifikationer'][i % 3], archived: false, attachments: [], parts: [], full: true });
    for (let i = 0; i < 120; i++) { const id = e.create('note', { title: 'Note ' + i + ' ' + txt(3), folder: ['Indbakke', 'Arbejde', 'Arbejde/Netto', 'Musik'][i % 4], tags: i % 3 ? [] : ['vigtig'], editedAt: new Date(now - i * 86400e3).toISOString(), createdAt: new Date(now - i * 86400e3).toISOString() }); e.doc(id).getText('body').insert(0, txt(300)); }
    for (let i = 0; i < 300; i++) { const s = new Date(now + (i - 150) * 8 * 3600e3); s.setMinutes(0, 0, 0); e.create('event', { title: 'Aftale ' + txt(3), start: s.toISOString(), end: new Date(s.getTime() + 3600e3).toISOString(), location: i % 4 ? '' : 'Netto' }); }
    const img = 'data:image/jpeg;base64,' + 'A'.repeat(350000);
    for (let i = 0; i < 20; i++) e.create('photo', { title: 'Billede ' + i, description: txt(40), tags: ['tøj'], text: '', kind: 'tøj', image: img, thumb: 'data:image/jpeg;base64,' + 'A'.repeat(15000), at: new Date(now - i * 86400e3).toISOString(), analyzed: true });
    for (let i = 0; i < 300; i++) e.create('person', { name: 'Person ' + i, phone: '+45 2' + String(i).padStart(7, '0'), email: `p${i}@x.dk` });
    for (let i = 0; i < 500; i++) e.create('usagelog', { at: new Date(now - i * 600e3).toISOString(), feature: 'chat', model: 'haiku', inTok: 1000, outTok: 200, usd: 0.001, label: txt(5) });
    return Math.round(performance.now() - t0);
  });
  await p.waitForTimeout(4000); // let it settle and save

  // Unlock again with the data on disk.
  await p.reload(); await p.waitForSelector('input[name=password]');
  if (mobile) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let t = Date.now(); await login(); await p.waitForSelector('.app', { timeout: 60000 }); res.unlockMs = Date.now() - t;

  // Long tasks while working.
  await p.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const x of l.getEntries()) window.__long.push(Math.round(x.duration)); }).observe({ type: 'longtask', buffered: false }); });
  const screens = ['today', 'notes', 'calendar', 'inbox', 'outlays', 'goals', 'assist', 'photos', 'contacts', 'expenses', 'settings'];
  res.screenMs = {};
  for (const s of screens) {
    t = Date.now();
    await p.evaluate((s) => { location.hash = '#/' + s; }, s);
    await p.waitForTimeout(50);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    res.screenMs[s] = Date.now() - t;
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${MODE}-${s}.png` });
    // Things that stick out sideways make the whole page slide left and right on a phone.
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (wide > 1) (res.overflowX ??= {})[s] = wide;
  }

  // Typing in a note.
  await p.evaluate(() => { location.hash = '#/notes'; });
  await p.waitForTimeout(600);
  await p.click('.nrow >> nth=0');
  await p.waitForSelector('.doc__body');
  await p.click('.doc__body');
  await p.keyboard.press('End');
  await p.evaluate(() => { window.__long = []; });
  const text = 'Husk at ringe til Jonas om pant og mad i morgen';
  t = Date.now();
  for (const ch of text) await p.keyboard.type(ch);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  res.typeMsPerKey = Math.round((Date.now() - t) / text.length);
  await p.waitForTimeout(2500);
  res.longTasksWhileTyping = await p.evaluate(() => window.__long);
  await p.screenshot({ path: `${out}/${MODE}-note-edit.png` });

  // Calendar views.
  await p.evaluate(() => { location.hash = '#/calendar'; });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${MODE}-calendar-full.png`, fullPage: true });

  res.storage = await p.evaluate(async () => { const e = await navigator.storage.estimate(); return Math.round(e.usage / 1e6) + ' MB'; });
  res.errors = errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
