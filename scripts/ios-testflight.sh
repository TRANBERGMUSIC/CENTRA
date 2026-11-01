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
# App icon (made from the brand icon, without transparency, which App Store Connect refuses)
ICONSET=$(find "$APPLE_DIR" -type d -name 'AppIcon.appiconset' | head -1)
if [ -n "$ICONSET" ]; then cp src-tauri/icons/ios/*.png "$ICONSET/"; fi
# Info.plist: permissions texts and "standard encryption only" (no export questions for each build)
PLIST=$(find "$APPLE_DIR" -name Info.plist -path '*_iOS*' | head -1)
if [ -n "$PLIST" ]; then
  pb() { /usr/libexec/PlistBuddy -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true; /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"; }
  pb ITSAppUsesNonExemptEncryption bool false
  pb NSMicrophoneUsageDescription string "CENTRA bruger mikrofonen, når du taler til Assist."
  pb NSSpeechRecognitionUsageDescription string "CENTRA laver din tale om til tekst, så Assist kan forstå den."
  pb NSCameraUsageDescription string "CENTRA bruger kameraet, når du tager et billede af en kvittering eller noget, du vil gemme."
  pb NSPhotoLibraryUsageDescription string "CENTRA henter billeder, du vælger, så Assist kan se dem, eller du kan gemme dem under Billeder."
  pb NSFaceIDUsageDescription string "CENTRA bruger Face ID til at låse dine data op."
  echo "Info.plist: $PLIST"
fi

npx tauri ios build --ci --export-method app-store-connect

IPA=$(find "$APPLE_DIR/build" -name '*.ipa' | head -1)
if [ -z "$IPA" ]; then echo "Fandt ingen .ipa efter bygget." >&2; exit 1; fi
echo "Uploader $IPA"
xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
echo "Uploadet til TestFlight. Den dukker op i TestFlight-appen om 10–30 minutter."
cd "$ROOT"
