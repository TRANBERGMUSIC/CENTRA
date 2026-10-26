#!/bin/bash
# CENTRA – installer til Mac. Installér eller opdatér til nyeste version med én linje i Terminal:
#   curl -fsSL https://raw.githubusercontent.com/TRANBERGMUSIC/CENTRA/main/installer/install.sh | bash
# Henter seneste release fra GitHub, lægger CENTRA i Programmer og åbner den.
# Derefter opdaterer CENTRA sig selv, mens den kører.
set -euo pipefail
REPO="TRANBERGMUSIC/CENTRA"
APP="/Applications/CENTRA.app"
TMP="$(mktemp -d)"; trap 'hdiutil detach -quiet "$TMP/mnt" 2>/dev/null || true; rm -rf "$TMP"' EXIT

say() { printf '\n  %s\n' "$1"; }
clear
printf '\n  ┌──────────────────────────────┐\n  │   C E N T R A   installer    │\n  └──────────────────────────────┘\n'

# Adgang til GitHub: offentligt repo virker direkte; et privat repo bruger dit GitHub-login fra `gh`, hvis det findes.
AUTH=()
if command -v gh >/dev/null 2>&1 && TOKEN=$(gh auth token 2>/dev/null); then AUTH=(-H "Authorization: Bearer $TOKEN"); fi

say "Finder nyeste version …"
JSON=$(curl -fsSL ${AUTH[@]+"${AUTH[@]}"} -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || true)
if [ -z "$JSON" ]; then
  say "Kunne ikke finde en udgivelse på github.com/$REPO."
  say "Er der pushet til GitHub, og er bygget færdigt under Actions (ca. 15 min)? Er repoet privat, så log ind med: gh auth login"
  read -r -p "  Tryk Enter for at lukke." _ </dev/tty || true; exit 1
fi
# JSON læses med macOS' indbyggede JavaScript (ingen Python nødvendig).
read -r VERSION ASSET_URL ASSET_API < <(osascript -l JavaScript -e '
function run(argv) {
  const d = JSON.parse(argv[0]);
  const assets = d.assets || [];
  const a = assets.find(x => x.name.endsWith(".dmg") && /universal|aarch64/.test(x.name)) || assets.find(x => x.name.endsWith(".dmg"));
  return [(d.tag_name || "?").replace(/^v/, ""), a ? a.browser_download_url : "-", a ? a.url : "-"].join(" ");
}' "$JSON")
if [ "$ASSET_URL" = "-" ]; then say "Udgivelsen $VERSION har endnu ingen Mac-fil. Vent til bygget er færdigt, og prøv igen."; read -r -p "  Tryk Enter for at lukke." _ </dev/tty || true; exit 1; fi

if [ -d "$APP" ]; then
  CUR=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo "?")
  say "Installeret: $CUR   Nyeste: $VERSION"
fi

say "Henter CENTRA $VERSION …"
if [ ${#AUTH[@]} -gt 0 ]; then
  curl -fL --progress-bar ${AUTH[@]+"${AUTH[@]}"} -H "Accept: application/octet-stream" "$ASSET_API" -o "$TMP/CENTRA.dmg"
else
  curl -fL --progress-bar "$ASSET_URL" -o "$TMP/CENTRA.dmg"
fi

say "Installerer i Programmer …"
osascript -e 'tell application "CENTRA" to quit' >/dev/null 2>&1 || true
sleep 1
mkdir -p "$TMP/mnt"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$TMP/mnt" "$TMP/CENTRA.dmg"
SRC=$(find "$TMP/mnt" -maxdepth 1 -name "*.app" | head -1)
rm -rf "$APP"
ditto "$SRC" "$APP"
hdiutil detach -quiet "$TMP/mnt"
# Hentet med curl, så macOS markerer den ikke som "fra internettet" – fjern for en sikkerheds skyld.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

say "Færdig. Åbner CENTRA $VERSION."
open "$APP"
exit 0
