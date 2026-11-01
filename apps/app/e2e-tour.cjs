// A look at every screen with realistic data, on the Mac and the iPhone (for design reviews).
// Usage: node e2e-tour.cjs <dist built with VITE_E2E=1> <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [DIST, out = 'e2e-tour'] = process.argv.slice(2);
const PW = 'Tour-test-password-1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); res.end(data); });
}).listen(4189, '127.0.0.1');
const SCREENS = (process.env.SCREENS || 'today,calendar,inbox,notes,goals,reminders,contacts,outlays,expenses,photos,assist,usage,connections,settings').split(',');
async function setup(b, opts) {
  const p = await (await b.newContext(opts)).newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.route('https://api.anthropic.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Klaret.' }], usage: { input_tokens: 1, output_tokens: 1 } }) }));
  await p.goto('http://127.0.0.1:4189/');
  await p.fill('input[name=password]', PW); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=password2]');
  await p.fill('input[name=password]', PW); await p.fill('input[name=password2]', PW);
  await p.click('button[type=submit]');
  await p.waitForSelector('.recovery', { timeout: 30000 });
  await p.check('.checkrow input'); await p.click('text=Fortsæt');
  await p.waitForSelector('.app');
  await p.evaluate(() => {
    const e = window.__session.engine, now = Date.now(), iso = (ms) => new Date(ms).toISOString();
    e.set('setting', 'setting-ai', { provider: 'claude', claudeKey: 'sk-ant-test', modelMode: 'auto' });
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const at = (d, h, m = 0) => { const x = new Date(day); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x; };
    for (let d = -3; d < 10; d++) if ([2, 3, 5].includes(at(d, 0).getDay())) e.create('event', { title: 'Arbejde · Netto', start: iso(at(d, 6).getTime()), end: iso(at(d, 16).getTime()), cat: 'calcat-work', place: 'Netto Nørrebro' });
    e.create('event', { title: 'Frokost med Jonas', start: iso(at(0, 12).getTime()), end: iso(at(0, 13).getTime()), place: 'Mirabelle' });
    e.create('event', { title: 'DJ-lektion', start: iso(at(0, 17, 30).getTime()), end: iso(at(0, 19).getTime()) });
    e.create('event', { title: 'Tandlæge', start: iso(at(1, 9, 15).getTime()), end: iso(at(1, 10).getTime()) });
    e.create('event', { title: 'Koncert i Vega', start: iso(at(3, 20).getTime()), end: iso(at(3, 23, 30).getTime()) });
    const senders = [['Sofie Holm', 'sofie@holm.dk', 'Weekend i Aarhus?', 'Hej! Er du stadig frisk på weekenden? Jeg har fundet et sted til os'], ['Netto', 'vagtplan@netto.dk', 'Vagtplan uge 46', 'Hermed vagtplanen for uge 46. Bemærk ændringer torsdag'], ['Jonas Lund', 'jonas@lund.dk', 'Pant og mad', 'Fik du styr på pantpengene? Jeg skylder dig vist stadig'], ['LunchHub', 'noreply@lunchhub.dk', 'Ny henvendelse: Frokostordning', 'Firma ønsker tilbud på frokostordning til 25 personer'], ['Vega', 'billet@vega.dk', 'Dine billetter', 'Tak for dit køb. Her er dine billetter til koncerten'], ['MobilePay', 'no-reply@mobilepay.dk', 'Du har modtaget 126,50 kr', 'Jonas Lund har sendt dig 126,50 kr']];
    senders.forEach(([n, em, s, pv], i) => e.create('mail', { fromName: n, fromEmail: em, subject: s, preview: pv, body: pv + '\n\nVenlig hilsen\n' + n, html: `<p>${pv}.</p><p>Venlig hilsen<br>${n}</p>`, full: true, at: iso(now - i * 5400e3), unread: i < 2, needsReply: i === 0 || i === 3, to: ['wajtranberg@gmail.com'], cat: i > 3 ? 'Notifikationer' : 'Personer' }));
    const notes = [['Indkøb', '- [ ] mælk\n- [x] æg\n- [ ] brød\n- [ ] kaffe'], ['Idéer til CENTRA', '# Næste\n- Huskeliste med Siri\n- **Bedre** kalender\n- Ugeoversigt på forsiden'], ['DJ-sæt fredag', '1. Intro 122 bpm\n2. Peak 128\n3. Outro'], ['Opsigelse Netto', 'Sidste dag er 10. november. Husk at aflevere nøgle og trøje.']];
    notes.forEach(([t, b], i) => { const id = e.create('note', { title: t, folder: i === 3 ? 'Arbejde' : 'Indbakke', tags: [], editedAt: iso(now - i * 86400e3), createdAt: iso(now - i * 86400e3), pinned: i === 1 }); e.doc(id).getText('body').insert(0, b); });
    e.create('goal', { title: 'Løbe 5 km 10 gange', kind: 'count', target: 10, each: 'løbetur', status: 'active', area: 'Sundhed', createdAt: iso(now - 20 * 86400e3), due: iso(now + 60 * 86400e3).slice(0, 10) });
    e.create('goal', { title: 'Lancere CENTRA på iPhone', kind: 'milestones', steps: [['TestFlight', true], ['Sync', true], ['Siri', false], ['App Store', false]], status: 'active', area: 'Projekter', createdAt: iso(now - 30 * 86400e3) });
    const jonas = e.create('person', { name: 'Jonas Lund', phone: '+45 20 30 40 50', email: 'jonas@lund.dk', relation: 'Ven' });
    e.create('person', { name: 'Sofie Holm', phone: '+45 31 22 11 00', email: 'sofie@holm.dk', relation: 'Kæreste' });
    e.create('person', { name: 'Sigge Berg', phone: '+45 42 42 42 42', relation: 'Ven' });
    e.create('outlay', { title: 'Pizza fredag', date: iso(now - 2 * 86400e3).slice(0, 10), people: ['me', jonas], items: [{ id: 'a', name: 'Pizza', amount: 240, who: [] }, { id: 'b', name: 'Cola', amount: 40, who: [] }] });
    e.create('expense', { name: 'Husleje', amount: 6500, interval: 'month', category: 'Bolig', day: 1, active: true });
    e.create('expense', { name: 'Netflix', amount: 149, interval: 'month', category: 'Abonnementer', day: 12, active: true });
    e.create('expense', { name: 'Spotify', amount: 119, interval: 'month', category: 'Abonnementer', day: 3, active: true });
    e.create('reminder', { text: 'Levere udstyr tilbage til Sigge', at: iso(at(0, 12).getTime() + 86400e3), done: false, createdAt: iso(now) });
    e.create('reminder', { text: 'Ringe til tandlægen', at: iso(now - 40 * 60e3), done: false, createdAt: iso(now - 3600e3) });
    e.create('reminder', { text: 'Købe gave til mor', at: null, done: false, createdAt: iso(now) });
    e.create('memory', { statement: 'Arbejder i Netto 06–16 tirsdag til fredag', kind: 'Rutine', source: 'Assist' });
    e.create('chat', { at: iso(now), messages: [], log: [{ role: 'user', text: 'Husk mig på at levere udstyr tilbage til Sigge i morgen kl 12', at: iso(now) }, { role: 'assistant', text: 'Klaret. **Levere udstyr tilbage til Sigge** står på huskelisten i morgen kl. 12.00.', at: iso(now), via: 'claude', model: 'claude-haiku-5-5', actions: [{ label: 'Husk: Levere udstyr tilbage til Sigge · i morgen kl. 12.00' }] }] });
  });
  await p.waitForTimeout(400);
  return p;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const errs = {};
  for (const [dev, opts] of [['mac', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    if (process.env.ONLY && process.env.ONLY !== dev) continue;
    const p = await setup(b, opts);
    for (const s of SCREENS) {
      await p.evaluate((s) => { location.hash = '#/' + s; }, s);
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${out}/${dev}-${s}.png` });
    }
    errs[dev] = p.errors;
  }
  console.log(JSON.stringify(errs));
  await b.close(); server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
