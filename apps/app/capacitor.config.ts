import type { CapacitorConfig } from '@capacitor/cli';

/**
 * iOS and Android shells around the same web build.
 * First time, on a Mac with Xcode / Android Studio:
 *   npm run build -w @centra/app && cd apps/app && npx cap add ios && npx cap add android
 * The web layer then updates itself over the air from GitHub Releases (see src/updater.ts).
 */
const config: CapacitorConfig = {
  appId: 'dk.tranberg.centra',
  appName: 'CENTRA',
  webDir: 'dist',
  backgroundColor: '#0B0F0E',
  ios: { contentInset: 'never' },
  plugins: {
    CapacitorUpdater: { autoUpdate: false, appReadyTimeout: 10000, responseTimeout: 20 },
    CapacitorHttp: { enabled: true },
  },
};
export default config;
