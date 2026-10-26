// Local mode (no server): first-time setup, reload + login, data persists encrypted on disk,
// lock-out, password change, recovery. Usage: node e2e-local.cjs <outdir>  (`vite preview` on :4173)
const { chromium } = require('playwright');
const out = process.argv[2] || 'e2e-local';
const URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const PW1 = 'Lokal-test-password-1', PW2 = PW1 + '-ny', PW3 = PW1 + '-gendannet';
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const res = {};
  const login = async (pw) => { await p.fill('input[name=password]', pw); await p.click('button[type=submit]'); };

  await p.goto(URL);
  await login(PW1);
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW1); await p.fill('input[name=password2]', PW1);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 20000 });
  const code = (await p.textContent('.recovery')).trim();
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');
  res.syncLine = (await p.textContent('.syncline')).trim();

  await p.goto(`${URL}#/notes`); await p.keyboard.press('Control+n');
  await p.waitForSelector('.doc__title'); await p.fill('.doc__title', 'Hemmelig plan for julekoncerten');
  await p.waitForTimeout(800);

  // On disk: nothing readable.
  res.diskPlaintext = await p.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('centra');
    r.onsuccess = () => { const q = r.result.transaction('snapshots').objectStore('snapshots').getAll(); q.onsuccess = () => resolve(JSON.stringify(q.result).includes('Hemmelig plan') || JSON.stringify(q.result).includes('Lysplan')); };
  }));
  res.localStoragePlaintext = await p.evaluate((pw) => JSON.stringify(localStorage).includes('Hemmelig') || JSON.stringify(localStorage).includes(pw), PW1);

  // Reload: login screen, wrong passwords lock, right one opens with the note still there.
  await p.reload(); await p.waitForSelector('input[name=password]');
  for (let i = 0; i < 5; i++) { await login('forkert-' + i); await p.waitForSelector('.unlock__error'); await p.waitForTimeout(300); }
  res.lock = (await p.textContent('.unlock__error')).trim();
  await p.screenshot({ path: `${out}/locked.png` });
  await p.evaluate(() => localStorage.removeItem('centra.guard')); // skip the 30 s wait in the test
  await p.reload(); await p.waitForSelector('input[name=password]');
  await login(PW1); await p.waitForSelector('.app', { timeout: 20000 });
  await p.goto(`${URL}#/notes`);
  res.notePersisted = await p.waitForSelector('text=Hemmelig plan for julekoncerten', { timeout: 5000 }).then(() => true).catch(() => false);

  // Change password, reload, old fails, new works.
  await p.goto(`${URL}#/settings`); await p.click('text=Skift password');
  await p.fill('.secform input[autocomplete=current-password]', PW1);
  const nw = p.locator('.secform input[autocomplete=new-password]'); await nw.nth(0).fill(PW2); await nw.nth(1).fill(PW2);
  await p.click('.secform button[type=submit]'); await p.waitForSelector('text=Password skiftet', { timeout: 20000 });
  await p.screenshot({ path: `${out}/settings.png` });
  await p.reload(); await login(PW1); await p.waitForSelector('.unlock__error');
  res.oldPasswordRefused = true;
  await login(PW2); await p.waitForSelector('.app', { timeout: 20000 });

  // Forgot it: recovery code sets a new one, data intact.
  await p.reload(); await p.click('text=Glemt password?');
  await p.fill('input[name=recovery]', code); await p.fill('input[name=password]', PW3); await p.fill('input[name=password2]', PW3);
  await p.click('button[type=submit]'); await p.waitForSelector('.unlock__info', { timeout: 20000 });
  await login(PW3); await p.waitForSelector('.app', { timeout: 20000 });
  await p.goto(`${URL}#/notes`);
  res.dataAfterRecovery = await p.waitForSelector('text=Hemmelig plan for julekoncerten', { timeout: 5000 }).then(() => true).catch(() => false);
  await p.goto(`${URL}#/today`); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/today.png` });
  res.errors = errors.filter((e) => !/WebSocket|ERR_CONNECTION/.test(e));
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
