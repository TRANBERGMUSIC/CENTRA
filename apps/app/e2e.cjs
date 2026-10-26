// End-to-end check of step 2: two devices on one account, live sync, screenshots of every screen.
// Usage: node e2e.cjs <outdir>   (relay on :8787 and `vite` on :5173 must be running)
const { chromium, devices } = require('playwright');
const out = process.argv[2] || 'e2e-shots';
const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const email = `demo+${Date.now()}@centra.app`, pass = 'lys over koncerthuset';
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const errors = [];
  const watch = (p, n) => { p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`${n}: ${m.text()}`)); };
  const mac = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  const phone = await (await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3 })).newPage();
  watch(mac, 'mac'); watch(phone, 'phone');

  async function signIn(p, shot) {
    await p.goto(URL);
    await p.fill('input[type=email]', email);
    await p.fill('input[type=password]', pass);
    if (shot) { await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/${shot}` }); }
    await p.click('button[type=submit]');
    await p.waitForSelector('.titlerow h1', { timeout: 20000 });
  }
  await signIn(mac, 'unlock-desktop.png');
  await mac.waitForTimeout(1500);
  await signIn(phone);
  await phone.waitForTimeout(1500);

  for (const s of ['today', 'notes/n1', 'inbox/m1', 'goals/g1', 'calendar', 'assist', 'settings']) {
    await mac.goto(`${URL}#/${s}`); await mac.waitForTimeout(900);
    await mac.screenshot({ path: `${out}/desktop-${s.split('/')[0]}.png` });
  }
  for (const s of ['today', 'goals/g1', 'inbox', 'notes/n1']) {
    await phone.goto(`${URL}#/${s}`); await phone.waitForTimeout(900);
    await phone.screenshot({ path: `${out}/phone-${s.split('/')[0]}.png` });
  }

  // Live sync: a note made on the Mac appears in the phone's note list.
  await phone.goto(`${URL}#/notes`); await phone.waitForTimeout(500);
  await mac.goto(`${URL}#/notes`); await mac.waitForTimeout(500);
  await mac.keyboard.press('Control+n');
  await mac.waitForSelector('.doc__title');
  const t0 = Date.now();
  await mac.fill('.doc__title', 'Skrevet på Mac');
  await phone.waitForSelector('text=Skrevet på Mac', { timeout: 5000 });
  const noteMs = Date.now() - t0;

  // Live sync of a goal: approving Assist's suggestion on the Mac moves the phone's figure to 412.
  await phone.goto(`${URL}#/goals/g1`); await phone.waitForTimeout(600);
  const before = (await phone.textContent('.gfig b')).trim();
  await mac.goto(`${URL}#/goals/g1`); await mac.waitForTimeout(600);
  const t1 = Date.now();
  await mac.click('.details .sugg >> text=Godkend');
  await phone.waitForFunction(() => document.querySelector('.gfig b')?.textContent?.includes('412'), null, { timeout: 5000 });
  const goalMs = Date.now() - t1;
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: `${out}/phone-goals-after-sync.png` });
  await mac.screenshot({ path: `${out}/desktop-goals-after-approve.png` });

  // Command palette
  await mac.goto(`${URL}#/today`); await mac.waitForTimeout(500);
  await mac.keyboard.press('Control+k'); await mac.keyboard.type('lys'); await mac.waitForTimeout(500);
  await mac.screenshot({ path: `${out}/desktop-palette.png` });

  console.log(JSON.stringify({ noteSyncMs: noteMs, goalSyncMs: goalMs, goalBefore: before, errors }, null, 1));
  await b.close();
})();
