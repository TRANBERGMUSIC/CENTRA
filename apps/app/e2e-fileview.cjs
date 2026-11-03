// Files shown inside CENTRA: PDF, Word, PowerPoint, Excel, CSV and text from a mail, on the Mac and the iPhone.
// Usage: node e2e-fileview.cjs <dist built with VITE_E2E=1> <samples dir> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, SAMPLES, out = 'e2e-fileview'] = process.argv.slice(2);
const PW = 'Mail-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4189, '127.0.0.1');
const FILES = ['Plan.pptx', 'Kontrakt.docx', 'Budget.xlsx', 'Faktura.pdf', 'liste.csv', 'noter.txt'].concat(process.env.EXTRA ? process.env.EXTRA.split(',') : []);
const blobs = FILES.map((f) => fs.readFileSync(path.join(SAMPLES, f)).toString('base64'));

async function setup(b, viewport, mobile) {
  const m = await (await b.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })).newPage();
  const errors = []; m.on('pageerror', (e) => errors.push(e.message)); m.on('console', (c) => { if (c.type() === 'error') errors.push('console: ' + c.text()); });
  await m.goto('http://127.0.0.1:4189/');
  await m.fill('input[name=password]', PW); await m.click('button[type=submit]');
  await m.waitForSelector('input[name=password2]');
  await m.fill('input[name=password]', PW); await m.fill('input[name=password2]', PW);
  await m.click('button[type=submit]');
  await m.waitForSelector('.recovery', { timeout: 30000 });
  await m.check('.checkrow input'); await m.click('text=Fortsæt');
  await m.waitForSelector('.app');
  await m.evaluate(({ FILES, blobs }) => {
    window.__calls = [];
    window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (cmd, args) => {
      window.__calls.push({ cmd, args });
      if (cmd === 'mail_part') return { name: FILES[args.index], mime: 'application/octet-stream', data: blobs[args.index] };
      return null;
    } };
    const e = window.__session.engine;
    e.set('mailacct', 'acct1', { name: 'Gmail', provider: 'gmail', email: 'me@example.com', host: 'imap.gmail.com', port: 993, security: 'tls', user: 'me@example.com', pass: 'x', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls', enabled: true });
    e.set('mail', 'mail1', { acct: 'acct1', acctName: 'Gmail', uid: 7, folder: 'INBOX', fromName: 'Anna Berg', fromEmail: 'anna@example.com', to: ['me@example.com'], subject: 'Filer til mødet', preview: 'Her er filerne', body: 'Hej,\n\nHer er filerne.\n\nAnna', html: '', full: true, at: new Date().toISOString(), unread: false,
      parts: FILES.map((name, index) => ({ index, name, mime: '', size: 1000 * (index + 1), cid: '', inline: false })), attachments: FILES, attachment: FILES[0] });
  }, { FILES, blobs });
  return { m, errors };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const res = {};
  const { m, errors } = await setup(b, { width: 1320, height: 860 }, false);
  await m.evaluate(() => { location.hash = '#/inbox/mail1'; });
  await m.waitForTimeout(900);
  for (const [i, f] of FILES.entries()) {
    if (i === 0) await m.locator('.att', { hasText: f }).locator('.att__face').click();
    else await m.locator('.fv button[aria-label="Næste"]').click();
    await m.waitForTimeout(2200);
    res[f] = await m.evaluate(() => {
      const b = document.querySelector('.fv__body');
      return { title: document.querySelector('.fv__title .strong')?.textContent, slides: b.querySelectorAll('.fv__slide').length, items: b.querySelectorAll('.fv__it').length, pages: b.querySelectorAll('canvas.fv__page').length,
        drawn: Array.from(b.querySelectorAll('canvas.fv__page')).filter((c) => c.width > 0).length, docx: b.querySelectorAll('section.docx').length, cells: b.querySelectorAll('.fv__grid td').length, text: (b.innerText || '').slice(0, 120), none: !!b.querySelector('.fv__none') };
    });
    await m.screenshot({ path: `${out}/mac-${f}.png` });
  }
  await m.keyboard.press('Escape');
  await m.waitForTimeout(300);
  res.closed = !(await m.locator('.fv').count());
  res.errors = errors;
  // iPhone without Quick Look in the build: shown in CENTRA instead
  const p = await setup(b, { width: 390, height: 844 }, true);
  await p.m.evaluate(() => { window.__CENTRA_OS = 'ios'; });
  await p.m.evaluate(() => { location.hash = '#/inbox/mail1'; });
  await p.m.waitForTimeout(900);
  await p.m.locator('.att', { hasText: 'Plan.pptx' }).locator('.att__face').tap();
  await p.m.waitForTimeout(2000);
  await p.m.screenshot({ path: `${out}/phone-pptx.png` });
  await p.m.locator('.fv button[aria-label="Næste"]').tap();
  await p.m.waitForTimeout(2000);
  await p.m.screenshot({ path: `${out}/phone-docx.png` });
  res.phoneErrors = p.errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
