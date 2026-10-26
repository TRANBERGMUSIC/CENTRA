#!/usr/bin/env node
// Turns signed update files on/off for one build (off when the signing secret isn't set up yet).
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'apps/desktop/src-tauri/tauri.conf.json';
const c = JSON.parse(readFileSync(f, 'utf8'));
c.bundle.createUpdaterArtifacts = process.argv[2] !== 'off';
writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
console.log('updater artifacts', c.bundle.createUpdaterArtifacts ? 'on' : 'off (TAURI_SIGNING_PRIVATE_KEY mangler)');
