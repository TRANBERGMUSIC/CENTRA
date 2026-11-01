// Assist on the iPhone: the message box empties when you send, and the conversation has room.
// Usage: node e2e-assist-phone.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-assist'] = process.argv.slice(2);
const PW = 'Assist-test-password-1';
const URL = 'http://127.0.0.1:4183/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4183, '127.0.0.1');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.route('https://api.anthropic.com/**', async (r) => {
    await new Promise((ok) => setTimeout(ok, 900));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Klaret. Jeg har slettet regnestykket med Jonas.' }], usage: { input_tokens: 10, output_tokens: 10 } }) });
  });
  await p.goto(URL);
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 30000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');
  await p.evaluate(() => { window.__session.engine.set('setting', 'setting-ai', { provider: 'claude', claudeKey: 'sk-ant-test' }); location.hash = '#/assist'; });
  await p.waitForSelector('.composer textarea:not([disabled])');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/phone-assist-empty.png` });
  const res = {};
  const box = async () => p.evaluate(() => { const t = document.querySelector('.composer textarea'); const r = t.getBoundingClientRect(); const c = document.querySelector('.chat').getBoundingClientRect(); return { value: t.value, w: Math.round(r.width), h: Math.round(r.height), font: getComputedStyle(t).fontSize, chatH: Math.round(c.height) }; });
  res.before = await box();
  await p.tap('.composer textarea');
  await p.keyboard.type('Slet det gamle regnestykke med Jonas, det fra sidste uge med pant og mad, tak');
  res.typed = await box();
  await p.screenshot({ path: `${out}/phone-assist-typed.png` });
  await p.tap('.composer button[type=submit]');
  await p.waitForTimeout(60);
  res.justSent = await box();
  // what iOS does when the keyboard commits its suggestion after the tap: the old text comes back as input
  await p.evaluate(() => { const t = document.querySelector('.composer textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Slet det gamle regnestykke med Jonas, det fra sidste uge med pant og mad, tak'); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(100);
  res.afterLateCommit = await box();
  await p.waitForTimeout(1500);
  res.afterReply = await box();
  await p.screenshot({ path: `${out}/phone-assist-reply.png` });
  await p.keyboard.type('h');
  res.typingAgain = (await box()).value;
  res.errors = errors;
  console.log(JSON.stringify(res, null, 2));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
