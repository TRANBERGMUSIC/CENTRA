// Forbindelser end to end with the Mac app's Rust side mocked (the real IMAP/SMTP code is tested
// in Rust against Dovecot): add Gmail, fetch, read, reply, archive, delete; add a calendar feed;
// edit an event; fix and delete a goal update. Usage: node e2e-connect.cjs <outdir>  (`vite preview` on :4173)
const { chromium } = require('playwright');
const out = process.argv[2] || 'e2e-connect';
const URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const PW = 'Connect-test-password-1';
const now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString();
const d = new Date(); d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7)); const wed = d.toISOString().slice(0, 10).replace(/-/g, '');
const ICS = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:g1\r\nSUMMARY:Tandlæge\r\nLOCATION:Vesterbrogade 12\r\nDTSTART;TZID=Europe/Copenhagen:${wed}T150000\r\nDTEND;TZID=Europe/Copenhagen:${wed}T153000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:g2\r\nSUMMARY:Mors fødselsdag\r\nDTSTART;VALUE=DATE:${wed}\r\nDTEND;VALUE=DATE:${wed}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const MAILS = [
  { uid: 11, message_id: 'v45@netto.dk', in_reply_to: '', references: '', from_name: 'Netto Vagtplan', from_email: 'vagtplan@netto.dk', to: ['willads@gmail.com'], cc: [], subject: 'Din vagtplan for uge 45', date: iso(30), text: 'Hej Willads,\n\nHer er din vagtplan for uge 45: tirsdag til fredag 06–16, torsdag til 15.\n\nVenlig hilsen\nNetto', seen: false, flagged: false, answered: false, attachments: ['vagtplan-uge45.pdf'], list: false },
  { uid: 12, message_id: 's1@example.dk', in_reply_to: '', references: '', from_name: 'Sofie Lund', from_email: 'sofie@example.dk', to: ['willads@gmail.com'], cc: [], subject: 'Frokost på lørdag?', date: iso(90), text: 'Hej! Skal vi spise frokost på lørdag kl. 12?\n\nSofie', seen: false, flagged: false, answered: false, attachments: [], list: false },
  { uid: 13, message_id: 'k1@shop.dk', in_reply_to: '', references: '', from_name: 'Elgiganten', from_email: 'ordre@elgiganten.dk', to: ['willads@gmail.com'], cc: [], subject: 'Din kvittering for ordre 4471', date: iso(600), text: 'Tak for din ordre.', seen: true, flagged: false, answered: false, attachments: [], list: false },
  { uid: 14, message_id: 'n1@shop.dk', in_reply_to: '', references: '', from_name: 'Zalando', from_email: 'news@zalando.dk', to: ['willads@gmail.com'], cc: [], subject: 'Ugens tilbud', date: iso(1500), text: 'Se ugens tilbud.', seen: true, flagged: false, answered: false, attachments: [], list: true },
];
(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  const errors = [], calls = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.exposeFunction('__rust', (cmd, args) => {
    calls.push([cmd, JSON.parse(JSON.stringify(args ?? {}))]);
    if (cmd === 'mail_test') return args.account.pass === 'abcdefghijklmnop' ? 4 : Promise.reject('Login blev afvist. Tjek e-mail og adgangskode (Gmail og iCloud kræver en app-adgangskode).');
    if (cmd === 'mail_fetch') return { uid_validity: 7, exists: 4, messages: args.sinceUid ? [] : MAILS };
    if (cmd === 'mail_update' || cmd === 'mail_send') return null;
    if (cmd === 'fetch_calendar') return ICS;
    if (cmd.startsWith('plugin:updater')) return null;
    return null;
  });
  await p.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => window.__rust(cmd, args), transformCallback: () => 0, metadata: {} }; });
  const res = {};
  await p.goto(URL);
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]'); await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 20000 }); await p.check('.checkrow input'); await p.click('text=Fortsæt'); await p.waitForSelector('.app');

  await p.click('.nav-sub:has-text("Forbindelser")'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/1-connections.png` });
  await p.click('text=Tilføj mailkonto'); await p.click('.provider:has-text("Gmail")');
  await p.fill('input[type=email]', 'willads@gmail.com'); await p.fill('.sheet input[type=password]', 'forkert');
  await p.click('.sheet button[type=submit]'); await p.waitForSelector('.sheet .unlock__error');
  res.wrongPassword = await p.textContent('.sheet .unlock__error');
  await p.fill('.sheet input[type=password]', 'abcd efgh ijkl mnop');
  await p.screenshot({ path: `${out}/2-add-gmail.png` });
  await p.click('.sheet button[type=submit]'); await p.waitForSelector('text=4 mails hentet fra Gmail', { timeout: 8000 });
  res.accountRow = (await p.textContent('.panel:has(h2:text("Mail")) .rows')).trim();

  await p.click('text=Tilføj kalender');
  await p.fill('.sheet input >> nth=0', 'Google privat'); await p.fill('.sheet input >> nth=1', 'webcal://calendar.google.com/calendar/ical/x/basic.ics');
  await p.click('.sheet button[type=submit]'); await p.waitForSelector('text=er tilføjet med 2 aftaler', { timeout: 8000 });
  await p.screenshot({ path: `${out}/3-connected.png` });

  await p.click('.nav-item:has-text("Indbakke")'); await p.waitForTimeout(500);
  res.tabs = await p.locator('.inbox .tab').allTextContents();
  await p.click('.mrow:has-text("Sofie")'); await p.waitForTimeout(300);
  await p.click('.reader__bar >> text=Svar'); await p.fill('.replybox textarea', 'Ja, gerne! Ses kl. 12.');
  await p.screenshot({ path: `${out}/4-inbox-reply.png` });
  await p.click('.replybox >> text=Send og arkivér'); await p.waitForSelector('text=Sendt til Sofie Lund');
  await p.waitForTimeout(700);
  const sent = calls.find((c) => c[0] === 'mail_send')[1];
  res.sent = { to: sent.mail.to, subject: sent.mail.subject, inReplyTo: sent.mail.in_reply_to, hasQuote: sent.mail.body.includes('> Hej! Skal vi'), user: sent.account.user, passNoSpaces: sent.account.pass };
  res.archivedOnServer = calls.some((c) => c[0] === 'mail_update' && c[1].action === 'archive');
  res.sofieGone = (await p.locator('.mrow:has-text("Sofie")').count()) === 0;
  p.once('dialog', (dl) => dl.accept());
  await p.click('.mrow:has-text("Zalando")'); await p.click('.reader__bar >> text=Slet'); await p.waitForTimeout(700);
  res.trashedOnServer = calls.some((c) => c[0] === 'mail_update' && c[1].action === 'trash');

  await p.click('.nav-item:has-text("Kalender")'); await p.waitForTimeout(400);
  if (!(await p.locator('.week__ev:has-text("Tandlæge")').count())) { await p.click('[aria-label="Næste uge"]'); await p.waitForTimeout(300); }
  res.feedEvent = await p.locator('.week__ev:has-text("Tandlæge")').count();
  res.allDay = await p.locator('.week__allday button').allTextContents();
  await p.click('text=Ny aftale'); await p.fill('.sheet .gtitle', 'Træning'); await p.click('.daypick button:has-text("Man")'); await p.click('.daypick button:has-text("Tor")');
  await p.fill('.sheet input[type=time] >> nth=0', '17:00'); await p.fill('.sheet input[type=time] >> nth=1', '18:00');
  await p.screenshot({ path: `${out}/5-new-event.png` });
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(300);
  await p.locator('.week__ev:has-text("Træning")').first().click();
  await p.fill('.sheet .gtitle', 'Styrketræning'); await p.click('.sheet button[type=submit]'); await p.waitForTimeout(300);
  res.renamedSeries = await p.locator('.week__ev:has-text("Styrketræning")').count();
  await p.locator('.week__ev:has-text("Styrketræning")').first().click();
  await p.click('.sheet >> text=Aflys kun'); await p.waitForTimeout(300);
  res.afterSkip = await p.locator('.week__ev:has-text("Styrketræning")').count();
  await p.locator('.week__ev:has-text("Tandlæge")').click(); await p.waitForTimeout(200);
  res.feedReadOnly = (await p.locator('.sheet').textContent()).includes('Ret den i den kalender');
  await p.screenshot({ path: `${out}/6-calendar.png` });
  await p.keyboard.press('Escape');

  await p.click('.nav-item:has-text("Mål")'); await p.click('text=Nyt mål'); await p.keyboard.type('Løb 300 km'); await p.keyboard.press('Enter');
  await p.click('text=Færdig');
  await p.fill('.gupdate input >> nth=0', '5'); await p.fill('.gupdate input >> nth=1', 'Første tur'); await p.click('text=Log opdatering'); await p.waitForTimeout(300);
  await p.fill('.gupdate input >> nth=0', '50'); await p.click('text=Log opdatering'); await p.waitForTimeout(300);
  await p.locator('.urow').first().locator('[aria-label="Ret opdatering"]').click();
  await p.fill('.uedit input >> nth=0', '5,5'); await p.click('.uedit >> text=Gem'); await p.waitForTimeout(200);
  await p.locator('.urow').nth(1).locator('[aria-label="Slet opdatering"]').click(); await p.waitForTimeout(300);
  res.goalFigure = (await p.textContent('.gfig')).trim();
  await p.screenshot({ path: `${out}/7-goal.png` });
  res.errors = errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
