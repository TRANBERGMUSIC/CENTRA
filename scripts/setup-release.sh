#!/usr/bin/env bash
# One-time setup of auto-updates. Run on your Mac from the repo root:
#   bash scripts/setup-release.sh
# Needs: the GitHub CLI (`brew install gh`, then `gh auth login`).
set -euo pipefail
KEY="$HOME/.tauri/centra.key"
mkdir -p "$HOME/.tauri"
if [ ! -f "$KEY" ]; then
  echo "Laver en signeringsnøgle til opdateringer (gem passwordet i din password manager)."
  npx --yes @tauri-apps/cli@2 signer generate -w "$KEY"
fi
PUB=$(cat "$KEY.pub")
node -e "
const f='apps/desktop/src-tauri/tauri.conf.json', fs=require('fs');
const c=JSON.parse(fs.readFileSync(f,'utf8')); c.plugins.updater.pubkey=process.argv[1];
fs.writeFileSync(f, JSON.stringify(c,null,2)+'\n');" "$PUB"
echo "Offentlig nøgle skrevet i tauri.conf.json."
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$KEY"
read -r -s -p "Password til nøglen (tom hvis ingen): " PW; echo
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body "$PW"
gh api -X POST "repos/{owner}/{repo}/pages" -f build_type=workflow >/dev/null 2>&1 || true
echo "Færdig. Commit tauri.conf.json, og kør derefter: npm run release"
