#!/usr/bin/env node
// Cuts a release: bumps the version, commits, tags and pushes. GitHub Actions builds and publishes it,
// and every installed CENTRA picks it up by itself.
//   npm run release            (patch: 0.2.0 → 0.2.1)
//   npm run release -- minor   (0.2.0 → 0.3.0)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const kind = process.argv[2] ?? 'patch';
const cur = JSON.parse(readFileSync('apps/app/package.json', 'utf8')).version.split('.').map(Number);
const next = kind === 'major' ? [cur[0] + 1, 0, 0] : kind === 'minor' ? [cur[0], cur[1] + 1, 0] : [cur[0], cur[1], cur[2] + 1];
const v = next.join('.');
const sh = (c) => execSync(c, { stdio: 'inherit' });
if (execSync('git status --porcelain').toString().trim()) { console.error('Commit eller stash dine ændringer først.'); process.exit(1); }
sh(`node scripts/set-version.mjs ${v}`);
sh(`git commit -am "CENTRA ${v}"`);
sh(`git tag v${v}`);
sh('git push && git push --tags');
console.log(`\nv${v} er skubbet. Følg bygget under Actions på GitHub; appen opdaterer sig selv, når den er ude.`);
