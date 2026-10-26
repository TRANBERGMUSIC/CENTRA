// End-to-end: first-time setup, login on a second device, live sync, password change, lock-out,
// recovery with the recovery code. Runs against a production build (CSP on).
// Usage: node e2e.cjs <outdir>    (relay on :8787 with an empty account store, `vite preview` on :4173)
const { chromium, devices } = require('playwright');
const out = process.argv[2] || 'e2e-shots';
const URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const PW1 = process.env.E2E_PW || 'Test-password-for-e2e-1';
const PW2 = PW1 + '-ny';
const PW3 = PW1 + '-gendannet';

(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const errors = [];
  const res = {};
  const watch = (p, n) => {
    p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(`${n}: ${m.text()}`); });
  };
  const mac = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  const phone = await (await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3 })).newPage();
  watch(mac, 'mac'); watch(phone, 'phone');
  const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });

  // 1. First launch on the Mac: username is prefilled, choose the password, get the recovery code.
  await mac.goto(URL);
  await mac.waitForSelector('input[name=password]');
  res.prefilledUser = await mac.inputValue('input[name=username]');
  await mac.fill('input[name=password]', PW1);
  await mac.click('button[type=submit]');
  await mac.waitForSelector('input[name=password2]');
  await shot(mac, '01-first-time');
  await mac.fill('input[name=password]', PW1);
  await mac.fill('input[name=password2]', PW1);
  await mac.click('button[type=submit]');
  await mac.waitForSelector('.recovery', { timeout: 20000 });
  const code = (await mac.textContent('.recovery')).trim();
  res.recoveryCodeFormat = /^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/.test(code);
  await shot(mac, '02-recovery-code');
  await mac.check('.checkrow input');
  await mac.click('text=Fortsæt');
  await mac.waitForSelector('.titlerow h1');
  await mac.waitForTimeout(800);
  await shot(mac, '03-today');

  // 2. Phone logs in with the same password.
  await phone.goto(URL);
  await phone.fill('input[name=password]', PW1);
  await phone.click('button[type=submit]');
  await phone.waitForSelector('.app', { timeout: 20000 });

  // 3. Live sync.
  await phone.goto(`${URL}#/notes`); await phone.waitForTimeout(400);
  await mac.goto(`${URL}#/notes`); await mac.waitForTimeout(400);
  await mac.keyboard.press('Control+n');
  await mac.waitForSelector('.doc__title');
  const t0 = Date.now();
  await mac.fill('.doc__title', 'Skrevet på Mac');
  await phone.waitForSelector('text=Skrevet på Mac', { timeout: 5000 });
  res.noteSyncMs = Date.now() - t0;

  // 4. Password change on the Mac logs the phone out.
  await mac.goto(`${URL}#/settings`); await mac.waitForTimeout(500);
  await mac.click('text=Skift password');
  await mac.fill('.secform input[autocomplete=current-password]', PW1);
  const nw = mac.locator('.secform input[autocomplete=new-password]');
  await nw.nth(0).fill(PW2); await nw.nth(1).fill(PW2);
  await mac.click('.secform button[type=submit]');
  await phone.waitForSelector('input[name=password]', { timeout: 15000 });
  res.phoneNotice = (await phone.textContent('.unlock__error').catch(() => ''))?.trim();
  await shot(phone, '04-phone-logged-out');

  // 5. Old password fails; five wrong tries lock the account.
  for (let i = 0; i < 5; i++) {
    await phone.fill('input[name=password]', PW1);
    await phone.click('button[type=submit]');
    await phone.waitForSelector('.unlock__error', { timeout: 15000 });
    await phone.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled || /Vent \d\d/.test(document.querySelector('button[type=submit]')?.textContent || ''), null, { timeout: 15000 });
  }
  res.lockMessage = (await phone.textContent('.unlock__error'))?.trim();
  await shot(phone, '05-locked');

  // 6. Recovery on the phone after the lock-out window: the recovery code sets a new password.
  //    (Recovery is throttled by the same lock, so wait it out.)
  await phone.waitForTimeout(31_000);
  await phone.click('text=Glemt password?');
  await phone.fill('input[name=recovery]', code.toLowerCase());
  await phone.fill('input[name=password]', PW3);
  await phone.fill('input[name=password2]', PW3);
  await shot(phone, '06-recover');
  await phone.click('button[type=submit]');
  await phone.waitForSelector('.unlock__info', { timeout: 20000 });
  res.recoverInfo = (await phone.textContent('.unlock__info'))?.trim();
  await phone.fill('input[name=password]', PW3);
  await phone.click('button[type=submit]');
  await phone.waitForSelector('.app', { timeout: 20000 }).catch(async (e) => { await shot(phone, 'debug'); console.log('DEBUG', await phone.textContent('.unlock__card')); throw e; });
  res.dataAfterRecovery = await phone.goto(`${URL}#/notes`).then(() => phone.waitForSelector('text=Skrevet på Mac', { timeout: 5000 }).then(() => true).catch(() => false));
  await phone.goto(`${URL}#/today`); await phone.waitForTimeout(800);
  await shot(phone, '07-phone-today');
  // Recovery logged every other session out; the Mac logs in with the new password.
  res.macLoggedOut = await mac.waitForSelector('input[name=password]', { timeout: 10000 }).then(() => true).catch(() => false);
  await mac.fill('input[name=password]', PW3);
  await mac.click('button[type=submit]');
  await mac.waitForSelector('.app', { timeout: 20000 });
  await mac.goto(`${URL}#/settings`); await mac.waitForTimeout(800);
  await shot(mac, '08-settings');

  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
