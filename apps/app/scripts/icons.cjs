// Renders the CENTRA app icons (dark + light) from the logo geometry in src/ui/Logo.tsx.
// Usage: node scripts/icons.cjs <outdir>   → icon-dark-1024.png, icon-light-1024.png, symbol.svg
const { chromium } = require('playwright');
const { writeFileSync, mkdirSync } = require('node:fs');
const out = process.argv[2] || 'icons-out';
mkdirSync(out, { recursive: true });
const ARC = 'M72.6 27.4 A32 32 0 1 0 72.6 72.6';
const stops = [[0, '#FFE2B8'], [0.38, '#FF9A5C'], [0.72, '#D9507A'], [1, '#7B4DFF']].map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
const mark = (glow = 1) => `
  <defs>
    <linearGradient id="g" x1="30" y1="12" x2="78" y2="86" gradientUnits="userSpaceOnUse">${stops}</linearGradient>
    <radialGradient id="o" cx="0.42" cy="0.38" r="0.62"><stop offset="0" stop-color="#FFFBF4"/><stop offset="0.55" stop-color="#FFE2B8"/><stop offset="1" stop-color="#FFB27A"/></radialGradient>
    <radialGradient id="h"><stop offset="0" stop-color="#FFD9A8" stop-opacity="${0.85 * glow}"/><stop offset="0.45" stop-color="#FF9A5C" stop-opacity="${0.28 * glow}"/><stop offset="1" stop-color="#FF9A5C" stop-opacity="0"/></radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
  </defs>
  <path d="${ARC}" fill="none" stroke="url(#g)" stroke-width="16" stroke-linecap="round" filter="url(#soft)" opacity="${0.55 * glow}"/>
  <circle cx="50" cy="50" r="26" fill="url(#h)"/>
  <path d="${ARC}" fill="none" stroke="url(#g)" stroke-width="16" stroke-linecap="round"/>
  <path d="M58 24.2 A27 27 0 0 0 29.5 34" fill="none" stroke="#fff" stroke-opacity="0.38" stroke-width="3" stroke-linecap="round"/>
  <circle cx="50" cy="50" r="10" fill="url(#o)"/>`;
// macOS icon grid: 824×824 squircle-ish tile centred in 1024 (Big Sur template).
const tile = (bg, edge, glow) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">${bg}</linearGradient></defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="${edge}" stroke-width="2"/>
  <svg x="232" y="232" width="560" height="560" viewBox="0 0 100 100" overflow="visible">${mark(glow)}</svg>
</svg>`;
const dark = tile('<stop offset="0" stop-color="#23242A"/><stop offset="1" stop-color="#0B0C0F"/>', 'rgba(255,255,255,0.08)', 1);
const light = tile('<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EFEBE5"/>', 'rgba(0,0,0,0.06)', 0.6);
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${mark(1)}</svg>`;
writeFileSync(`${out}/symbol.svg`, symbol);
(async () => {
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [name, svg] of [['icon-dark-1024', dark], ['icon-light-1024', light]]) {
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.screenshot({ path: `${out}/${name}.png`, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
}
// Full-bleed square for the web/PWA icons (iOS masks it itself).
await p.setContent(`<html><body style="margin:0">${dark.replace('x="100" y="100" width="824" height="824" rx="185"', 'x="0" y="0" width="1024" height="1024" rx="0"').replace('x="232" y="232" width="560" height="560"', 'x="182" y="182" width="660" height="660"')}</body></html>`);
await p.screenshot({ path: `${out}/icon-square-1024.png`, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await b.close();
console.log('ok');
})();
