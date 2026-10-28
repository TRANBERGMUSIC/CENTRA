// Kontakter, udlæg (with a receipt photo read by a mocked Claude) and udgifter, end to end.
// Usage: node e2e-money.cjs <outdir> <receipt.jpg>   (`vite preview` on :4173)
const { chromium } = require('playwright');
const out = process.argv[2] || 'e2e-money', receipt = process.argv[3];
const URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const PW = 'Money-test-password-1';
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  const errors = [], seen = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.route('https://api.anthropic.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    const c = body.messages[0].content;
    const hasImage = Array.isArray(c) && c.some((x) => x.type === 'image');
    seen.push({ hasImage, tools: !!body.tools, model: body.model });
    const text = hasImage
      ? JSON.stringify({ store: 'Netto Nørrebro', date: '2026-10-27', total: 233.5, items: [{ name: 'Pizza Margherita', amount: 55 }, { name: 'Pizza Pepperoni', amount: 59 }, { name: 'Coca-Cola 1,5 l', amount: 22 }, { name: 'Chips', amount: 18.5 }, { name: 'Rødvin', amount: 79 }] })
      : 'klar';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) });
  });
  const res = {};
  await p.goto(URL);
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]'); await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 20000 }); await p.check('.checkrow input'); await p.click('text=Fortsæt'); await p.waitForSelector('.app');
  // connect Claude (mocked) so receipts can be read
  await p.click('.nav-item:has-text("Assist")'); await p.fill('.connect input', 'sk-ant-api03-TESTKEY-abcdefghijklmnopqrstuvwxyz'); await p.click('.connect button[type=submit]'); await p.waitForTimeout(500);

  // Contact
  await p.click('.nav-item:has-text("Kontakter")'); await p.click('.nlist__acts button:has-text("Ny")'); await p.waitForSelector('.pcard__name .gtitle');
  await p.fill('.pcard__name .gtitle', 'Mads Holm'); await p.locator('.pcard__name .gtitle').blur();
  await p.fill('input[type=tel]', '20 30 40 50'); await p.locator('input[type=tel]').blur();
  await p.fill('.pcard__grid input[list=relations]', 'Kollega'); await p.locator('.pcard__grid input[list=relations]').blur();
  await p.fill('.askbar input[placeholder="@brugernavn eller link"]', '@madsholm'); await p.click('.askbar button:has-text("Tilføj")');
  await p.fill('.pnotes', 'Kollega i Netto. Spiller bas i et band. Kan låne en trailer.'); await p.locator('.pnotes').blur();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/1-contact.png` });
  res.contact = (await p.textContent('.plist')).trim();

  // Udlæg with receipt
  await p.click('.nav-item:has-text("Udlæg")'); await p.click('text=Nyt udlæg'); await p.waitForSelector('.odetail');
  await p.fill('.addperson input', 'Mads Holm'); await p.keyboard.press('Enter');
  await p.fill('.addperson input', 'Sofie Lund'); await p.keyboard.press('Enter');
  await p.locator('.odetail input[type=file]').setInputFiles(receipt);
  await p.waitForSelector('text=varer sat ind', { timeout: 10000 });
  await p.waitForTimeout(400);
  res.items = await p.locator('.oitems__name').evaluateAll((els) => els.map((x) => x.value));
  res.total = await p.textContent('.ototal b');
  // Rødvin only for Mads and me
  const vin = p.locator('.oitems li', { has: p.locator('input[value="Rødvin"]') });
  await vin.locator('.oitems__who button:has-text("Sofie")').click();
  await p.waitForTimeout(300);
  res.owes = await p.locator('.oweline .oweline__top').allTextContents();
  await p.screenshot({ path: `${out}/2-outlay.png`, fullPage: false });
  await p.locator('.oweline', { hasText: 'Mads' }).locator('text=Betalt en del').click();
  await p.fill('.oweline .askbar input', '50'); await p.click('.oweline .askbar button[type=submit]'); await p.waitForTimeout(300);
  res.afterPartial = (await p.locator('.oweline', { hasText: 'Mads' }).textContent());
  await p.locator('.oweline', { hasText: 'Sofie' }).locator('text=Betalt alt').click(); await p.waitForTimeout(300);
  res.owecard = (await p.textContent('.owecard')).trim();
  await p.screenshot({ path: `${out}/3-outlay-paid.png` });

  // Udgifter
  await p.click('.nav-item:has-text("Udgifter")');
  const add = async (name, amount, interval, category) => {
    await p.click('text=Ny udgift'); await p.fill('.sheet .gtitle', name); await p.fill('.sheet input[inputmode=decimal]', amount);
    await p.selectOption('.sheet select >> nth=0', interval); if (category) await p.selectOption('.sheet select >> nth=1', category);
    await p.click('.sheet button[type=submit]'); await p.waitForTimeout(150);
  };
  await add('Husleje', '6.500', 'month', 'Bolig');
  await add('Netflix', '129', 'month');
  await add('Spotify', '119', 'month');
  await add('Fitness World', '299', 'month', 'Fitness & sundhed');
  await add('Indboforsikring', '1.380', 'year', 'Forsikring');
  await add('Telenor', '199', 'month', 'Telefon & internet');
  await add('Rejsekort', '450', 'month', 'Transport');
  await p.waitForTimeout(900);
  res.kpis = await p.locator('.kpi').allTextContents();
  res.cancelNetflix = await p.locator('.xlist li', { hasText: 'Netflix' }).locator('a').getAttribute('href');
  res.cancelFitness = await p.locator('.xlist li', { hasText: 'Fitness World' }).locator('a').getAttribute('href');
  await p.screenshot({ path: `${out}/4-expenses.png`, fullPage: true });
  await p.hover('.mbar >> nth=7'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/5-expenses-hover.png` });
  await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/6-expenses-light.png`, fullPage: true });
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await p.click('.nav-item:has-text("I dag")'); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/7-today.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(URL + '#/outlays'); await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/8-phone-outlays.png` });
  res.claudeCalls = seen;
  res.errors = errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
