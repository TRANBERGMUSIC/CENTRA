#!/usr/bin/env bash
# Builds the iPhone app and uploads it to TestFlight. Runs in GitHub Actions on macOS once these
# secrets exist (docs/IPHONE.md): APP_STORE_CONNECT_API_KEY (the .p8 content), APP_STORE_CONNECT_KEY_ID,
# APP_STORE_CONNECT_ISSUER_ID, APPLE_TEAM_ID.   Usage: ios-testflight.sh <version> <build number>
set -euo pipefail
VERSION="$1"; BUILD="$2"
npm ci
node scripts/set-version.mjs "$VERSION"
npm run build -w @centra/design-system
npm run build -w @centra/app
cd apps/app
[ -d ios ] || npx cap add ios --packagemanager SPM
npx cap sync ios
KEY_DIR="$HOME/private_keys"; mkdir -p "$KEY_DIR"
printf '%s' "$APP_STORE_CONNECT_API_KEY" > "$KEY_DIR/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"
AUTH=(-authenticationKeyPath "$KEY_DIR/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8" -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID")
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$RUNNER_TEMP/CENTRA.xcarchive" archive \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" \
  -allowProvisioningUpdates "${AUTH[@]}"
cat > "$RUNNER_TEMP/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>teamID</key><string>${APPLE_TEAM_ID}</string><key>destination</key><string>upload</string></dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/CENTRA.xcarchive" -exportOptionsPlist "$RUNNER_TEMP/export.plist" -exportPath "$RUNNER_TEMP/out" -allowProvisioningUpdates "${AUTH[@]}"
echo "Uploadet til TestFlight. Den dukker op i TestFlight-appen om 10–30 minutter."
