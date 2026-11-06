// The inbox with realistic mail (people, newsletters, receipts, phishing and scam) on the Mac and the iPhone.
// Usage: node e2e-inbox.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-inbox'] = process.argv.slice(2);
const PW = 'Mail-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const LOGOS = { 'google.com': fs.readFileSync(path.join(out, '..', 'logo-g.png')).toString('base64'), 'netflix.com': fs.readFileSync(path.join(out, '..', 'logo-n.png')).toString('base64') };
const server = http.createServer((req, res) => { const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); }); }).listen(4192, '127.0.0.1');

async function setup(b, viewport, mobile) {
  const m = await (await b.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })).newPage();
  const errors = []; m.on('pageerror', (e) => errors.push(e.message));
  await m.goto('http://127.0.0.1:4192/');
  await m.fill('input[name=password]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('input[name=password2]');
  await m.fill('input[name=password]', PW); await m.fill('input[name=password2]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('.recovery', { timeout: 30000 }); await m.check('.checkrow input'); await m.click('text=Fortsæt');
  await m.waitForSelector('.app');
  await m.evaluate((LOGOS) => {
    window.__calls = [];
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (cmd, args) => { window.__calls.push({ cmd, args }); if (cmd === 'mail_send') return { from: 'me@example.com', message_id: 'x@y', saved_in: '' }; if (cmd === 'mail_logo') return LOGOS[args.domain] ? { mime: 'image/png', data: LOGOS[args.domain] } : null; return null; } };
    const e = window.__session.engine;
    e.set('mailacct', 'acct1', { name: 'Gmail', provider: 'gmail', email: 'me@example.com', host: 'imap.gmail.com', port: 993, security: 'tls', user: 'me@example.com', pass: 'x', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls', enabled: true, lastSync: new Date().toISOString(), lastUid: 99 });
    const h = (n) => new Date(Date.now() - n * 3600_000).toISOString();
    const mails = [
      { fromName: 'Sigge Holm', fromEmail: 'sigge@gmail.com', to: ['me@example.com', 'bo@example.com'], subject: 'Udstyr til lørdag', body: 'Hej! Kan du levere højtalerne tilbage kl. 12? Mvh Sigge', cat: 'Personer', needsReply: true, unread: true, at: h(0.3) },
      { fromName: 'MitID', fromEmail: 'no-reply@mitid-sikkerhed.com', subject: 'Din MitID udløber i dag', body: 'Bekræft din identitet inden 24 timer: https://mitid-dk.secure-login.ru/login', auth: 'spf=softfail dkim=none dmarc=fail', cat: 'Notifikationer', unread: true, at: h(0.8) },
      { fromName: 'Netto', fromEmail: 'nyhedsbrev@netto.dk', subject: 'Ugens tilbud: 3 for 2 på kaffe', body: 'Se alle ugens tilbud.', list: true, cat: 'Nyhedsbreve', unread: true, at: h(1.5) },
      { fromName: 'PostNord', fromEmail: 'info@pn-levering.top', subject: 'Din pakke venter – betal told', body: 'Betal told på 19 kr.', html: '<p><a href="http://185.22.10.4/pay">www.postnord.dk/betal</a></p>', cat: 'Personer', unread: true, at: h(2) },
      { fromName: 'Anna Berg', fromEmail: 'anna@example.com', to: ['me@example.com'], subject: 'Præsentation til mødet', body: 'Her er slides til mødet på torsdag.', attachments: ['Plan.pptx'], attachment: 'Plan.pptx', cat: 'Personer', unread: false, at: h(5) },
      { fromName: 'Elgiganten', fromEmail: 'ordre@elgiganten.dk', subject: 'Ordrebekræftelse 220193', body: 'Tak for din ordre.', attachments: ['Faktura.pdf'], attachment: 'Faktura.pdf', cat: 'Kvitteringer', unread: false, at: h(20) },
      { fromName: 'Hacker', fromEmail: 'x@mail.ru', subject: 'Your account has been hacked', body: 'I have access to your device and recorded you. Pay 1200 USD in bitcoin to this BTC wallet within 48 hours.', cat: 'Personer', unread: true, at: h(26) },
      { fromName: 'Mor', fromEmail: 'mor@example.dk', to: ['me@example.com'], subject: 'Søndag', body: 'Kommer du til middag på søndag? Knus', cat: 'Personer', unread: false, at: h(30) },
      { fromName: 'LinkedIn', fromEmail: 'notifications@linkedin.com', subject: 'Du har 3 nye notifikationer', body: 'Se hvem der har set din profil.', cat: 'Notifikationer', unread: false, at: h(40) },
    ];
    mails.push({ fromName: 'Google', fromEmail: 'no-reply@accounts.google.com', subject: 'Sikkerhedsadvarsel', body: 'Ny login på Mac.', cat: 'Notifikationer', unread: true, at: h(0.1) });
    mails.push({ fromName: 'Netflix', fromEmail: 'info@mailer.netflix.com', subject: 'Nyt på Netflix', body: 'Se hvad der er nyt.', list: true, cat: 'Nyhedsbreve', unread: false, at: h(3) });
    mails.forEach((x, i) => e.set('mail', `m${i + 1}`, { acct: 'acct1', acctName: 'Gmail', uid: i + 1, folder: 'INBOX', to: ['me@example.com'], cc: [], html: '', full: true, parts: [], attachments: [], ...x, preview: x.body }));
  }, LOGOS);
  return { m, errors };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  const { m, errors } = await setup(b, { width: 1320, height: 860 }, false);
  await m.evaluate(() => { location.hash = '#/inbox'; });
  await m.waitForTimeout(900);
  await m.evaluate(async () => { const { screenMail } = window.__centraTest ?? {}; if (screenMail) screenMail(window.__session.engine); });
  await m.waitForTimeout(400);
  await m.screenshot({ path: `${out}/mac-inbox.png` });
  await m.evaluate(() => window.__centraTest?.screenMail(window.__session.engine));
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${out}/mac-logos.png` });
  res.logos = await m.locator('.mrow .avatar--logo').count();
  res.logoAsked = await m.evaluate(() => window.__calls.filter((c) => c.cmd === 'mail_logo').map((c) => c.args.domain).sort());
  res.flagged = await m.evaluate(() => window.__session.engine.list('mail').filter((x) => x.danger).map((x) => [x.fromName, x.danger, x.mbox]));
  // The phishing folder and a flagged mail
  await m.locator('.mfolder--danger', { hasText: 'Phishing' }).click();
  await m.waitForTimeout(400);
  await m.locator('.mrow').first().click();
  await m.waitForTimeout(600);
  await m.screenshot({ path: `${out}/mac-phishing.png` });
  // Not phishing: back to the inbox
  await m.locator('.mdanger >> text=Ikke phishing').click();
  await m.waitForTimeout(300);
  res.cleared = await m.evaluate(() => { const x = window.__session.engine.list('mail').find((y) => y.fromName === 'MitID'); return [x.danger, x.mbox, x.dangerOk]; });
  // Search is a button
  await m.locator('button[aria-label="Søg i mails"]').click();
  await m.fill('input.msearch', 'pakke');
  await m.waitForTimeout(300);
  res.search = await m.locator('.mrow').count();
  res.macErrors = errors;
  const p = await setup(b, { width: 390, height: 844 }, true);
  await p.m.evaluate(() => { location.hash = '#/inbox'; });
  await p.m.waitForTimeout(900);
  await p.m.evaluate(() => window.__centraTest?.screenMail(window.__session.engine));
  await p.m.waitForTimeout(400);
  await p.m.screenshot({ path: `${out}/phone-inbox.png` });
  res.phoneErrors = p.errors;
  console.log(JSON.stringify(res));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
