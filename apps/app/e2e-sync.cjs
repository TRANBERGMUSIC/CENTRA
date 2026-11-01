// Sync switched on for an existing Mac: the local-only account goes up as it is (same password,
// same data, new recovery key), a new device logs in and gets everything, edits flow both ways,
// and a phone that comes first does not create an empty account.
// Usage: node e2e-sync.cjs <dist-local> <dist-sync> <outdir>   (dist-sync built with VITE_SYNC=on VITE_RELAY_URL=ws://127.0.0.1:8787)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const [LOCAL, SYNCED, out = 'e2e-sync'] = process.argv.slice(2);
const PW = 'Sync-test-password-1';
const URL = 'http://127.0.0.1:4180/';

let root = LOCAL;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4180, '127.0.0.1');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
const relay = spawn('node', ['server.ts'], { cwd: path.join(__dirname, '../../services/relay'), env: { ...process.env, PORT: '8787', DATA }, stdio: 'inherit' });

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => setTimeout(r, 1500));
  const b = await chromium.launch();
  const res = {};
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); };
  const login = async (p, pw = PW) => { await p.fill('input[name=password]', pw); await p.click('button[type=submit]'); };

  // 0. A phone first, before the Mac has gone up: it must not make a new (empty) account.
  root = SYNCED;
  const early = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ep = await early.newPage(); watch(ep);
  await ep.goto(URL); await login(ep);
  await ep.waitForSelector('.unlock__error', { timeout: 20000 });
  res.phoneFirst = (await ep.textContent('.unlock__error')).trim();
  res.phoneFirstNoCreateForm = (await ep.locator('input[name=password2]').count()) === 0;
  await ep.screenshot({ path: `${out}/0-phone-first.png` });
  await early.close();

  // 1. The Mac as it is today: no server, account and data only on this computer.
  root = LOCAL;
  const mac = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const mp = await mac.newPage(); watch(mp);
  await mp.goto(URL); await login(mp);
  await mp.waitForSelector('input[name=password2]');
  await mp.fill('input[name=password]', PW); await mp.fill('input[name=password2]', PW);
  await mp.click('button[type=submit]');
  await mp.waitForSelector('.recovery', { timeout: 30000 });
  res.oldCode = (await mp.textContent('.recovery')).trim();
  await mp.check('.checkrow input'); await mp.click('text=Fortsæt');
  await mp.waitForSelector('.app');
  await mp.goto(`${URL}#/notes`); await mp.keyboard.press('Control+n');
  await mp.waitForSelector('.doc__title'); await mp.fill('.doc__title', 'Pant med Jonas');
  await mp.waitForTimeout(1200);

  // 2. The update with sync arrives: log in once, the account and the data go up.
  root = SYNCED;
  await mp.reload(); await mp.waitForSelector('input[name=password]');
  await login(mp);
  await mp.waitForSelector('.recovery', { timeout: 30000 });
  res.migrationNotice = (await mp.textContent('.unlock__info'))?.trim();
  res.newCode = (await mp.textContent('.recovery')).trim();
  await mp.screenshot({ path: `${out}/1-mac-new-recovery.png` });
  await mp.check('.checkrow input'); await mp.click('text=Fortsæt');
  await mp.waitForSelector('.app');
  await mp.goto(`${URL}#/notes`);
  res.macKeptNote = await mp.waitForSelector('text=Pant med Jonas', { timeout: 8000 }).then(() => true).catch(() => false);
  await mp.waitForTimeout(1500);
  const acct = JSON.parse(fs.readFileSync(path.join(DATA, 'tranberg', 'account.json'), 'utf8'));
  const log = fs.readFileSync(path.join(DATA, 'tranberg', 'log.jsonl'), 'utf8');
  res.serverHasAccount = !!acct.pub?.wrappedAK;
  res.serverEnvelopes = log.trim().split('\n').length;
  res.serverSeesNoPlaintext = !log.includes('Pant med Jonas') && !JSON.stringify(acct).includes(PW);

  // 3. The iPhone (a fresh device): logs in with the same password and gets everything.
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
  const pp = await phone.newPage(); watch(pp);
  await pp.goto(URL); await login(pp);
  await pp.waitForSelector('.app', { timeout: 30000 });
  res.phoneShowsRecovery = (await pp.locator('.recovery').count()) > 0;
  await pp.waitForTimeout(1200);
  await pp.screenshot({ path: `${out}/2-phone-today.png` });
  await pp.goto(`${URL}#/notes`);
  res.phoneGotNote = await pp.waitForSelector('text=Pant med Jonas', { timeout: 10000 }).then(() => true).catch(() => false);
  await pp.waitForTimeout(1200);
  await pp.screenshot({ path: `${out}/2-phone-notes.png` });

  // 4. Edits flow both ways.
  await pp.keyboard.press('Control+n');
  await pp.waitForSelector('.doc__title'); await pp.fill('.doc__title', 'Skrevet på iPhone');
  await mp.goto(`${URL}#/notes`);
  res.macGotPhoneNote = await mp.waitForSelector('text=Skrevet på iPhone', { timeout: 10000 }).then(() => true).catch(() => false);

  // 5. Both devices are listed; the old recovery key no longer works, the new one is different.
  await mp.goto(`${URL}#/settings`);
  await mp.waitForTimeout(800);
  res.devices = await mp.locator('.panel:has-text("Enheder") .row').count();
  await mp.screenshot({ path: `${out}/3-mac-settings.png`, fullPage: true });
  res.codeChanged = res.oldCode !== res.newCode;

  // 6. The Mac logs in again later: a normal login (no second upload, no new recovery key).
  await mp.reload(); await login(mp);
  await mp.waitForSelector('.app', { timeout: 30000 });
  res.secondLoginNoRecovery = (await mp.locator('.recovery').count()) === 0;
  res.envelopesAfter = fs.readFileSync(path.join(DATA, 'tranberg', 'log.jsonl'), 'utf8').trim().split('\n').length;

  res.errors = errors.filter((e) => !/ResizeObserver/.test(e));
  console.log(JSON.stringify(res, null, 2));
  await b.close(); relay.kill(); server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
})().catch((e) => { console.error(e); relay.kill(); server.close(); process.exit(1); });
