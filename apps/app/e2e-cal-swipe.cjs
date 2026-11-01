// Calendar swipes: the iPhone (day anywhere, week on the strip, the circle under the right number
// after the arrows) and the Mac's week (two fingers sideways on the trackpad).
// Usage: node e2e-cal-swipe.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-cal'] = process.argv.slice(2);
const PW = 'Kalender-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4188, '127.0.0.1');
async function setup(b, opts) {
  const p = await (await b.newContext(opts)).newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto('http://127.0.0.1:4188/');
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 30000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');
  await p.evaluate(() => { const e = window.__session.engine; const d = new Date(); d.setHours(10, 0, 0, 0); e.create('event', { title: 'Frokost med Jonas', start: d.toISOString(), end: new Date(d.getTime() + 3600000).toISOString() }); location.hash = '#/calendar'; });
  await p.waitForTimeout(900);
  return p;
}
// A finger moving sideways from an element (real TouchEvents, which React listens for).
const swipe = (p, sel, dx) => p.evaluate(async ({ sel, dx }) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + Math.min(r.height / 2, 30);
  const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y0 });
  const fire = (type, x) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t(x)], changedTouches: [t(x)] }));
  fire('touchstart', x0);
  for (let i = 1; i <= 8; i++) { fire('touchmove', x0 + (dx * i) / 8); await new Promise((r) => setTimeout(r, 16)); }
  fire('touchend', x0 + dx);
}, { sel, dx });
const label = (p) => p.locator('.calm__label').innerText();
const pillOff = (p) => p.evaluate(() => { const a = document.querySelector('.calm__pill').getBoundingClientRect(), b = document.querySelector('.calm__d.is-sel b').getBoundingClientRect(); return Math.round(Math.abs(a.left - b.left) + Math.abs(a.top - b.top)); });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  const m = await setup(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const day0 = await label(m);
  await swipe(m, '.calm__ev', -200); await m.waitForTimeout(700);
  res.daySwipeOnEvent = day0 !== (await label(m));
  const day1 = await label(m);
  await swipe(m, '.calm__label', 200); await m.waitForTimeout(700);
  res.daySwipeOnLabelBack = (await label(m)) === day0 && day1 !== day0;
  const wk0 = await m.locator('.calm__week').getAttribute('aria-label');
  await swipe(m, '.calm__d:nth-of-type(4)', -180); await m.waitForTimeout(800);
  res.weekSwipeOnStrip = wk0 !== (await m.locator('.calm__week').getAttribute('aria-label'));
  res.pillAfterStrip = await pillOff(m);
  await m.locator('.calm__nav').last().tap();
  res.pillHiddenWhileSliding = await m.evaluate(() => Number(getComputedStyle(document.querySelector(".calm__pill")).opacity) < 0.5);
  await m.waitForTimeout(700);
  res.pillAfterArrow = await pillOff(m);
  await m.locator('.calm__nav').first().tap(); await m.waitForTimeout(80);
  await m.locator('.calm__nav').first().tap(); await m.waitForTimeout(700);
  res.pillAfterTwoQuickArrows = await pillOff(m);
  await m.locator('.calm__more button').last().tap(); await m.waitForTimeout(700);
  res.pillAfterNextDay = await pillOff(m);
  await m.screenshot({ path: `${out}/phone-week.png` });
  res.phoneErrors = m.errors;

  const d = await setup(b, { viewport: { width: 1440, height: 900 } });
  const h0 = await d.locator('.titlerow h1').innerText();
  await d.mouse.move(800, 600);
  for (let i = 0; i < 12; i++) { await d.mouse.wheel(25, 0); await d.waitForTimeout(16); }
  await d.waitForTimeout(700);
  const h1 = await d.locator('.titlerow h1').innerText();
  res.macTrackpadNextWeek = h0 !== h1;
  for (let i = 0; i < 3; i++) { await d.mouse.wheel(10, 0); await d.waitForTimeout(16); }
  await d.waitForTimeout(500);
  res.macSmallNudgeStays = (await d.locator('.titlerow h1').innerText()) === h1;
  for (let i = 0; i < 12; i++) { await d.mouse.wheel(-25, 0); await d.waitForTimeout(16); }
  await d.waitForTimeout(700);
  res.macBack = (await d.locator('.titlerow h1').innerText()) === h0;
  for (let i = 0; i < 5; i++) { await d.mouse.wheel(0, 120); await d.waitForTimeout(16); }
  res.macVerticalStillScrolls = (await d.locator('.titlerow h1').innerText()) === h0;
  res.macErrors = d.errors;
  console.log(JSON.stringify({ ...res, h0, h1 }, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
