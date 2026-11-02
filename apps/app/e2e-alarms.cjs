// Vækkeure on the huskeliste and an alert on an event, on the Mac and the iPhone.
// Usage: node e2e-alarms.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-reminders'] = process.argv.slice(2);
const PW = 'Alarm-test-password-1';
const URL = 'http://127.0.0.1:4191/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4191, '127.0.0.1');
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
  for (const [dev, opts] of [['mac', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const p = await setup(b, opts);
    await p.evaluate(() => { location.hash = '#/reminders'; });
    await p.waitForSelector('.al');
    await p.click('.al__head .btn');
    await p.fill('.al__pick', '06:30');
    await p.fill('.al__label', 'Arbejde');
    await p.click('.al__new button[type=submit]');
    await p.waitForTimeout(400);
    res[dev] = { alarms: await p.evaluate(() => window.__session.engine.list('alarm').map((a) => ({ time: a.time, days: a.days, label: a.label, on: a.on, uuid: !!a.uuid }))) };
    await p.screenshot({ path: `${out}/${dev}-alarms.png` });
    await p.locator('.al__sw input').first().click();
    res[dev].offAfterToggle = await p.evaluate(() => window.__session.engine.list('alarm')[0].on === false);
    // an event with an alert
    await p.evaluate(() => { const e = window.__session.engine; const d = new Date(Date.now() + 20 * 60000); e.create('event', { title: 'Tandlæge', start: d.toISOString(), end: new Date(d.getTime() + 3600000).toISOString() }); location.hash = '#/calendar'; });
    await p.waitForTimeout(900);
    await p.locator(dev === 'mac' ? '.week__ev' : '.calm__ev').first().click();
    await p.waitForSelector('.sheet select');
    await p.locator('.sheet select').first().selectOption('15');
    await p.click('.sheet button[type=submit]');
    await p.waitForTimeout(400);
    res[dev].eventAlert = await p.evaluate(() => window.__session.engine.list('event')[0].alert);
    await p.evaluate(() => { location.hash = '#/settings'; });
    await p.waitForTimeout(700);
    res[dev].notifyPanel = await p.locator('text=Notifikationer').count();
    res[dev].errors = p.errors;
  }
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
