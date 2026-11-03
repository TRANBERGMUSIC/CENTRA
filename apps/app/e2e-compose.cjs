// Writing mail: new mail, reply all, forward with its attachments, adding a file, opening an attachment.
// Usage: node e2e-compose.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-compose'] = process.argv.slice(2);
const PW = 'Mail-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4188, '127.0.0.1');

async function setup(b, viewport, mobile) {
  const m = await (await b.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })).newPage();
  const errors = []; m.on('pageerror', (e) => errors.push(e.message));
  await m.goto('http://127.0.0.1:4188/');
  await m.fill('input[name=password]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('input[name=password2]');
  await m.fill('input[name=password]', PW); await m.fill('input[name=password2]', PW);
  await m.click('button[type=submit]');
  await m.waitForSelector('.recovery', { timeout: 30000 });
  await m.check('.checkrow input'); await m.click('text=Fortsæt');
  await m.waitForSelector('.app');
  await m.evaluate(() => {
    window.__calls = [];
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (cmd, args) => {
      window.__calls.push({ cmd, args });
      if (cmd === 'mail_send') return { from: 'me@example.com', message_id: 'abc@example.com', saved_in: '' };
      if (cmd === 'mail_save_part') return '/tmp/CENTRA vedhæftninger/Plan.pptx';
      return null;
    } };
    const e = window.__session.engine;
    e.set('mailacct', 'acct1', { name: 'Gmail', provider: 'gmail', email: 'me@example.com', host: 'imap.gmail.com', port: 993, security: 'tls', user: 'me@example.com', pass: 'x', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls', enabled: true });
    e.create('person', { name: 'Sigge Holm', email: 'sigge@example.com' });
    e.set('mail', 'mail1', { acct: 'acct1', acctName: 'Gmail', uid: 7, folder: 'INBOX', fromName: 'Anna Berg', fromEmail: 'anna@example.com', to: ['me@example.com', 'bo@example.com'], cc: ['carl@example.com'],
      subject: 'Præsentation til mødet', preview: 'Her er slides', body: 'Hej,\n\nHer er slides til mødet.\n\nAnna', html: '', full: true, at: new Date().toISOString(), unread: false,
      parts: [{ index: 0, name: 'Plan.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 2400000, cid: '', inline: false }, { index: 1, name: 'Budget.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 48000, cid: '', inline: false }],
      attachments: ['Plan.pptx', 'Budget.xlsx'], attachment: 'Plan.pptx', messageId: 'orig@example.com' });
  });
  return { m, errors };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  // Mac
  {
    const { m, errors } = await setup(b, { width: 1320, height: 860 }, false);
    await m.evaluate(() => { location.hash = '#/inbox/mail1'; });
    await m.waitForTimeout(900);
    res.buttons = await m.locator('.reader__bar').innerText();
    await m.screenshot({ path: `${out}/mac-mail.png` });
    // Open an attachment
    await m.locator('.att', { hasText: 'Plan.pptx' }).locator('.att__face').click();
    await m.waitForTimeout(300);
    res.viewerOpen = await m.locator('.fv').count();
    await m.keyboard.press('Escape');
    await m.waitForTimeout(200);
    await m.locator('.att', { hasText: 'Budget.xlsx' }).locator('text=Åbn').click();
    await m.waitForTimeout(200);
    res.opened = await m.evaluate(() => window.__calls.filter((c) => c.cmd === 'mail_save_part').map((c) => ({ index: c.args.index, save: c.args.save, preview: c.args.preview })));
    // Reply all
    await m.locator('.reader__bar >> text=Svar alle').click();
    await m.waitForTimeout(300);
    res.replyAllChips = await m.locator('.cmp__chip').allInnerTexts();
    await m.screenshot({ path: `${out}/mac-replyall.png` });
    await m.locator('.cmp textarea').fill('Tak, ses i morgen.');
    await m.locator('.cmp >> text=Send').first().click();
    await m.waitForTimeout(400);
    res.replyAllSent = await m.evaluate(() => { const c = window.__calls.filter((x) => x.cmd === 'mail_send').pop(); return c && { to: c.args.mail.to, cc: c.args.mail.cc, subject: c.args.mail.subject, inReplyTo: c.args.mail.in_reply_to, quote: c.args.mail.body.includes('> Her er slides') }; });
    // Forward with attachments and one more file
    await m.locator('.reader__bar >> text=Videresend').click();
    await m.waitForTimeout(300);
    await m.locator('.cmp input[aria-label=Til]').fill('sig');
    await m.waitForTimeout(150);
    res.suggest = await m.locator('.cmp__hits').innerText().catch(() => '');
    await m.keyboard.press('Enter');
    await m.locator('.cmp input[type=file]').setInputFiles({ name: 'Noter.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('hello world') });
    await m.waitForTimeout(300);
    res.forwardFiles = await m.locator('.cmp__files li').allInnerTexts();
    await m.screenshot({ path: `${out}/mac-forward.png` });
    await m.locator('.cmp >> text=Send').first().click();
    await m.waitForTimeout(400);
    res.forwardSent = await m.evaluate(() => { const c = window.__calls.filter((x) => x.cmd === 'mail_send').pop(); return c && { to: c.args.mail.to, subject: c.args.mail.subject, files: c.args.mail.files.map((f) => [f.name, atob(f.data)]), forward: c.args.mail.forward && { uid: c.args.mail.forward.uid, parts: c.args.mail.forward.parts, acct: c.args.mail.forward.account.user }, header: c.args.mail.body.includes('Videresendt mail') }; });
    // New mail
    await m.locator('button[aria-label="Ny mail"]').click();
    await m.waitForTimeout(400);
    await m.locator('.cmpsheet input[aria-label=Til]').fill('ny@example.com,');
    await m.locator('.cmpsheet input[aria-label=Emne]').fill('Hej');
    await m.locator('.cmpsheet textarea').fill('En ny mail.');
    await m.screenshot({ path: `${out}/mac-new.png` });
    await m.locator('.cmpsheet >> text=Send').first().click();
    await m.waitForTimeout(400);
    res.newSent = await m.evaluate(() => { const c = window.__calls.filter((x) => x.cmd === 'mail_send').pop(); return c && { to: c.args.mail.to, subject: c.args.mail.subject, body: c.args.mail.body, fwd: c.args.mail.forward }; });
    res.sheetClosed = !(await m.locator('.cmpsheet').count());
    res.macErrors = errors;
  }
  // iPhone
  {
    const { m, errors } = await setup(b, { width: 390, height: 844 }, true);
    await m.evaluate(() => { location.hash = '#/inbox/mail1'; });
    await m.waitForTimeout(900);
    await m.screenshot({ path: `${out}/phone-mail.png`, fullPage: false });
    await m.locator('.phone-back').tap();
    await m.waitForTimeout(500);
    await m.locator('button[aria-label="Ny mail"]').tap();
    await m.waitForTimeout(500);
    await m.locator('.cmpsheet input[aria-label=Til]').fill('sigge');
    await m.waitForTimeout(200);
    await m.screenshot({ path: `${out}/phone-new.png` });
    res.phoneSheet = await m.evaluate(() => { const r = document.querySelector('.cmpsheet').getBoundingClientRect(); return [r.top, r.left, r.width, r.height].map(Math.round); });
    res.phoneErrors = errors;
  }
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
