// Screenshots every direction × screen at desktop and phone. Usage: node shoot.cjs [outdir]
const { chromium } = require('playwright');
const out = process.argv[2] || 'shots';
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const dir of ['a', 'b', 'c']) for (const screen of ['home', 'note', 'inbox', 'goals']) for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'phone' ? 3 : 1.5 });
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'assert') errs.push(`${dir}/${screen}: ${m.text()}`); });
    p.on('pageerror', (e) => errs.push(`${dir}/${screen}: ${e.message}`));
    await p.goto(`http://localhost:8765/prototypes/directions/index.html?dir=${dir}&screen=${screen}`);
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${dir}-${screen}-${tag}.png` });
    await p.close();
  }
  console.log(errs.length ? errs.join('\n') : 'no console errors');
  await b.close();
})();
