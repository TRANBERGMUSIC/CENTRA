#!/usr/bin/env node
// Writes one version everywhere it lives, and points the desktop updater at this repository.
//   node scripts/set-version.mjs 0.3.0 [owner/repo]
import { readFileSync, writeFileSync } from 'node:fs';
const [version, repo = process.env.GITHUB_REPOSITORY] = process.argv.slice(2).map((x) => x?.replace(/^v/, ''));
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) { console.error('usage: set-version.mjs <x.y.z> [owner/repo]'); process.exit(1); }
const json = (p, f) => { const o = JSON.parse(readFileSync(p, 'utf8')); f(o); writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
json('apps/app/package.json', (o) => { o.version = version; });
json('apps/desktop/package.json', (o) => { o.version = version; });
json('apps/app/public/version.json', (o) => { o.version = version; });
json('apps/desktop/src-tauri/tauri.conf.json', (o) => {
  o.version = version;
  if (repo) o.plugins.updater.endpoints = [`https://github.com/${repo}/releases/latest/download/latest.json`];
});
const cargo = 'apps/desktop/src-tauri/Cargo.toml';
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`version ${version}${repo ? ' · updates from ' + repo : ''}`);
