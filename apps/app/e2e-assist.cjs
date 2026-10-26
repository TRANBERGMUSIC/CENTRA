// Assist end to end with a mocked Claude: empty start, connect key, talk, actions land in the
// calendar/memory, undo, key never stored readable. Usage: node e2e-assist.cjs <outdir>  (`vite preview` on :4173)
const { chromium } = require('playwright');
const out = process.argv[2] || 'e2e-assist';
const URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const PW = 'Assist-test-password-1', KEY = 'sk-ant-api03-TESTKEY-abcdefghijklmnopqrstuvwxyz';
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  const errors = [], sent = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.route('https://api.anthropic.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    sent.push({ key: route.request().headers()['x-api-key'], body });
    const last = body.messages.at(-1);
    const text = last.content.find((c) => c.type === 'text')?.text ?? '';
    let reply;
    if (text === 'Test') reply = { content: [{ type: 'text', text: 'klar' }], stop_reason: 'end_turn' };
    else if (last.content[0].type === 'tool_result') reply = { content: [{ type: 'text', text: 'Det har jeg gemt, og din arbejdstid ligger nu i kalenderen: tirsdag, onsdag og fredag 06–16 og torsdag 06–15.' }], stop_reason: 'end_turn' };
    else {
      const d = new Date(); d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7)); const tue = d.toISOString().slice(0, 10);
      d.setDate(d.getDate() + 2); const thu = d.toISOString().slice(0, 10);
      reply = { content: [
        { type: 'text', text: 'Fint, det sætter jeg op.' },
        { type: 'tool_use', id: 'a', name: 'remember', input: { kind: 'Arbejde', statement: 'Arbejder i Netto tirsdag–fredag 06–16, torsdag til 15' } },
        { type: 'tool_use', id: 'b', name: 'create_event', input: { title: 'Arbejde · Netto', date: tue, start_time: '06:00', end_time: '16:00', repeat_days: ['tir', 'ons', 'fre'], calendar: 'Arbejde' } },
        { type: 'tool_use', id: 'c', name: 'create_event', input: { title: 'Arbejde · Netto', date: thu, start_time: '06:00', end_time: '15:00', repeat_days: ['tor'], calendar: 'Arbejde' } },
        { type: 'tool_use', id: 'd', name: 'watch_mail', input: { description: 'Vagtplan fra Netto', from: 'netto' } },
      ], stop_reason: 'tool_use' };
    }
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply) });
  });
  const res = {};
  await p.goto(URL);
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 20000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app'); await p.waitForTimeout(1200);
  res.noSampleData = (await p.locator('text=Lysplan').count()) === 0 && (await p.locator('text=Mads').count()) === 0;
  await p.screenshot({ path: `${out}/1-today-empty.png` });

  await p.fill('.askbar input', 'Jeg arbejder i Netto fra 06-16 tirsdag-fredag, undtagen torsdag har jeg fri kl 15. Og hold øje med vagtplanen fra Netto.');
  await p.click('.askbar button[type=submit]');
  await p.waitForSelector('.connect input');
  res.queuedTextKept = (await p.inputValue('.composer textarea')).includes('Netto');
  await p.screenshot({ path: `${out}/2-connect.png` });
  await p.fill('.connect input', KEY); await p.click('.connect button[type=submit]');
  await p.waitForSelector('.composer textarea:not([disabled])');
  await p.click('.composer button[type=submit]');
  await p.waitForSelector('.typing'); await p.screenshot({ path: `${out}/3-thinking.png` });
  await p.waitForSelector('text=ligger nu i kalenderen', { timeout: 10000 });
  await p.waitForTimeout(500);
  res.actions = await p.locator('.msg--assistant .act__label').allTextContents();
  res.memory = await p.locator('.assist__side .memrow').allTextContents();
  await p.screenshot({ path: `${out}/4-assist.png` });
  res.keyOnlyToAnthropic = sent.every((s) => s.key === KEY);

  // undo the mail watch
  await p.locator('.act', { hasText: 'Holder øje med' }).locator('text=Fortryd').click();
  res.watchUndone = await p.locator('.act.is-undone').count();

  await p.goto(`${URL}#/calendar`); await p.waitForTimeout(600);
  await p.click('[aria-label="Næste uge"]'); await p.waitForTimeout(400);
  res.calendarNextWeek = await p.locator('.week__ev').allTextContents();
  await p.screenshot({ path: `${out}/5-calendar.png` });

  await p.goto(`${URL}#/settings`); await p.waitForTimeout(500);
  await p.locator('h2', { hasText: 'Assist' }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${out}/6-settings.png` });

  res.keyOnDisk = await p.evaluate((k) => new Promise((resolve) => {
    const r = indexedDB.open('centra');
    r.onsuccess = () => { const q = r.result.transaction('snapshots').objectStore('snapshots').getAll(); q.onsuccess = () => resolve(JSON.stringify(q.result).includes(k.slice(-12)) || JSON.stringify(q.result).includes('Netto')); };
  }), KEY);
  res.keyInLocalStorage = await p.evaluate((k) => JSON.stringify(localStorage).includes(k.slice(-12)), KEY);

  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${URL}#/assist`); await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/7-phone.png` });
  res.errors = errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
