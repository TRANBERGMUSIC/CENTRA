#!/usr/bin/env bash
# Builds the iPhone app (the same Tauri app as on the Mac, without the in-app browser) and uploads it
# to TestFlight. Runs in GitHub Actions on macOS once these secrets exist (docs/IPHONE.md):
#   APPLE_API_KEY_P8   the downloaded .p8 file's full text
#   APPLE_API_KEY_ID   its Key ID
#   APPLE_API_ISSUER   the Issuer ID
#   APPLE_TEAM_ID      your Team ID
# Signing is automatic: Xcode makes the certificate and profile itself with the API key.
# Usage: ios-testflight.sh <version> <build number>
set -euo pipefail
VERSION="$1"; BUILD="$2"
ROOT="$(pwd)"

# Newest Xcode on the machine (App Store Connect only takes builds made with a recent SDK).
XC=$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$XC" ]; then sudo xcode-select -s "$XC/Contents/Developer"; fi
xcodebuild -version
command -v xcodegen >/dev/null || brew install xcodegen

node scripts/set-version.mjs "$VERSION"
# Build number (must grow with every upload) and team, written into the config for this build only.
node -e "
const f='apps/desktop/src-tauri/tauri.conf.json', c=JSON.parse(require('fs').readFileSync(f,'utf8'));
c.bundle.iOS = { ...(c.bundle.iOS||{}), bundleVersion: process.argv[1], developmentTeam: process.argv[2] };
require('fs').writeFileSync(f, JSON.stringify(c, null, 2));
" "$BUILD" "$APPLE_TEAM_ID"

# The App Store Connect key: Xcode signs with it, altool uploads with it. Only on this machine, for this run.
KEY_DIR="$HOME/.appstoreconnect/private_keys"; mkdir -p "$KEY_DIR"
KEY="$KEY_DIR/AuthKey_${APPLE_API_KEY_ID}.p8"
printf '%s\n' "$APPLE_API_KEY_P8" > "$KEY"; chmod 600 "$KEY"
export APPLE_API_ISSUER APPLE_API_KEY="$APPLE_API_KEY_ID" APPLE_API_KEY_PATH="$KEY" APPLE_DEVELOPMENT_TEAM="$APPLE_TEAM_ID"
trap 'rm -f "$KEY"' EXIT

cd apps/desktop
# The Xcode project is generated fresh on every build (src-tauri/gen/apple is not kept in git).
rm -rf src-tauri/gen/apple
npx tauri ios init --ci

APPLE_DIR=src-tauri/gen/apple
# The app's own Swift (scripts/ios/*.swift): Siri ("husk i CENTRA"), push from the sync server and
# the alarm clock (AlarmKit). They go into the app's sources, the app target gets a Swift version
# (it's Objective-C otherwise) and push its entitlement, through a small extra spec that includes
# Tauri's project.yml; then the project is generated again. Never stops the build: if a build with
# all of it fails, the alarm goes first, then all of it, so the app always ships.
MAIN_MM=$(find "$APPLE_DIR/Sources" -name 'main.mm' 2>/dev/null | head -1 || true)
SRC_DIR=""; [ -n "$MAIN_MM" ] && SRC_DIR=$(dirname "$MAIN_MM")
TARGET=""
if [ -f "$APPLE_DIR/project.yml" ]; then
  TARGET=$(ruby -ryaml -e 'f = ARGV[0]; y = YAML.respond_to?(:unsafe_load_file) ? YAML.unsafe_load_file(f) : YAML.load_file(f); puts y["targets"].keys.grep(/_iOS$/).first' "$APPLE_DIR/project.yml" 2>/dev/null || true)
fi
ENT="$APPLE_DIR/CentraPush.entitlements"
TAURI_ENT=$(find "$APPLE_DIR" -name '*.entitlements' -path '*_iOS*' 2>/dev/null | head -1 || true)
# gen <swift files…>: the project with these files (none: Tauri's own project)
gen() {
  [ -n "$SRC_DIR" ] && rm -f "$SRC_DIR"/Centra*.swift
  [ -n "$TAURI_ENT" ] && { /usr/libexec/PlistBuddy -c "Delete :aps-environment" "$TAURI_ENT" >/dev/null 2>&1 || true; }
  if [ -z "$SRC_DIR" ] || [ -z "$TARGET" ] || [ $# -eq 0 ]; then (cd "$APPLE_DIR" && xcodegen generate --spec project.yml) || true; return; fi
  for f in "$@"; do cp "$ROOT/scripts/ios/$f" "$SRC_DIR/"; done
  local ent=""
  if printf '%s\n' "$@" | grep -q CentraPush.swift; then
    # aps-environment production: TestFlight and the App Store use Apple's production push service.
    # Into Tauri's own entitlements file when it has one, else a file of our own.
    if [ -n "$TAURI_ENT" ]; then
      /usr/libexec/PlistBuddy -c "Add :aps-environment string production" "$TAURI_ENT"
    else
      printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>aps-environment</key><string>production</string></dict></plist>\n' > "$ENT"
      ent="        CODE_SIGN_ENTITLEMENTS: CentraPush.entitlements\n"
    fi
  fi
  printf "include:\n  - project.yml\ntargets:\n  %s:\n    settings:\n      base:\n        SWIFT_VERSION: \"5.0\"\n$ent" "$TARGET" > "$APPLE_DIR/centra.yml"
  (cd "$APPLE_DIR" && xcodegen generate --spec centra.yml) || { (cd "$APPLE_DIR" && xcodegen generate --spec project.yml); return 1; }
}
# App icon, Info.plist texts and settings (again after every generate, which rewrites the Info.plist)
dress() {
  ICONSET=$(find "$APPLE_DIR" -type d -name 'AppIcon.appiconset' | head -1)
  if [ -n "$ICONSET" ]; then cp src-tauri/icons/ios/*.png "$ICONSET/"; fi
  PLIST=$(find "$APPLE_DIR" -name Info.plist -path '*_iOS*' | head -1)
  [ -n "$PLIST" ] || return 0
  pb() { /usr/libexec/PlistBuddy -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true; /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"; }
  pb ITSAppUsesNonExemptEncryption bool false
  pb NSMicrophoneUsageDescription string "CENTRA bruger mikrofonen, når du taler til Assist."
  pb NSSpeechRecognitionUsageDescription string "CENTRA laver din tale om til tekst, så Assist kan forstå den."
  pb NSCameraUsageDescription string "CENTRA bruger kameraet, når du tager et billede af en kvittering eller noget, du vil gemme."
  pb NSPhotoLibraryUsageDescription string "CENTRA henter billeder, du vælger, så Assist kan se dem, eller du kan gemme dem under Billeder."
  pb NSFaceIDUsageDescription string "CENTRA bruger Face ID til at låse dine data op."
  pb NSUserNotificationsUsageDescription string "CENTRA giver dig besked, når det er tid til noget på din huskeliste."
  pb NSAlarmKitUsageDescription string "CENTRA bruger alarmer til dit vækkeur."
  # Danish is the app's own language: Siri understands "Husk i CENTRA" in Danish
  pb CFBundleDevelopmentRegion string da
  echo "Info.plist: $PLIST"
}
build() { npx tauri ios build --ci --export-method app-store-connect; }

built=""; ok=""
for set in "CentraIntents.swift CentraPush.swift CentraAlarms.swift" "CentraIntents.swift CentraPush.swift" ""; do
  # shellcheck disable=SC2086
  if gen $set; then :; else echo "::warning::Kunne ikke sætte $set op."; continue; fi
  dress
  echo "Bygger med: ${set:-kun Tauri}"
  if build; then built="$set"; ok=1; break; fi
  echo "::warning::iPhone-bygget med ${set:-kun Tauri} fejlede${set:+; prøver med mindre}."
done
[ -n "$ok" ] || exit 1
case "$built" in *CentraAlarms*) ;; *) echo "::warning::Vækkeuret (AlarmKit) kom ikke med i denne build." ;; esac
case "$built" in *CentraPush*) ;; *) echo "::warning::Push kom ikke med i denne build." ;; esac

IPA=$(find "$APPLE_DIR/build" -name '*.ipa' | head -1)
if [ -z "$IPA" ]; then echo "Fandt ingen .ipa efter bygget." >&2; exit 1; fi
echo "Uploader $IPA"
xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
echo "Uploadet til TestFlight. Den dukker op i TestFlight-appen om 10–30 minutter."
cd "$ROOT"
