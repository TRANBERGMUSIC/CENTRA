/**
 * Auto-update from GitHub Releases, on every platform from one place.
 *
 *  Desktop (Tauri):    the Tauri updater reads releases/latest/download/latest.json, verifies the
 *                      minisign signature, downloads, installs and relaunches.
 *  Mobile (Capacitor): the web layer updates over the air — ota.json on the latest release points
 *                      to a zipped web build; @capgo/capacitor-updater downloads it and swaps it in
 *                      on the next launch. Native changes still go through TestFlight / Play.
 *  Web:                GitHub Pages serves the newest build; version.json tells an open tab to reload.
 */
declare const __APP_VERSION__: string;
declare const __GITHUB_REPOSITORY__: string;

export const APP_VERSION = __APP_VERSION__;
export const REPO = __GITHUB_REPOSITORY__;
const latest = (file: string) => `https://github.com/${REPO}/releases/latest/download/${file}`;

export type Platform = 'desktop' | 'mobile' | 'web';
export const platform: Platform = '__TAURI_INTERNALS__' in window ? 'desktop' : (window as any).Capacitor?.isNativePlatform?.() ? 'mobile' : 'web';

export type Update = { version: string; notes?: string; install: () => Promise<void> };

const newer = (a: string, b: string) => {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

export async function checkForUpdate(): Promise<Update | null> {
  try {
    if (platform === 'desktop') {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const u = await check();
      if (!u) return null;
      return { version: u.version, notes: u.body, install: async () => { await u.downloadAndInstall(); await relaunch(); } };
    }
    if (platform === 'mobile') {
      const { CapacitorHttp } = await import('@capacitor/core');
      const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
      await CapacitorUpdater.notifyAppReady();
      const res = await CapacitorHttp.get({ url: latest('ota.json') });
      const m = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      if (!m?.version || !newer(m.version, APP_VERSION)) return null;
      return {
        version: m.version, notes: m.notes,
        install: async () => {
          const bundle = await CapacitorUpdater.download({ url: m.url, version: m.version, checksum: m.checksum });
          await CapacitorUpdater.set(bundle);
        },
      };
    }
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const { version } = await r.json();
    if (!newer(version, APP_VERSION)) return null;
    return { version, install: async () => location.reload() };
  } catch {
    return null; // offline, no release yet, or not running inside the native shell
  }
}

/** Check at launch and every 30 minutes; hand any update to `onUpdate`. */
export function watchForUpdates(onUpdate: (u: Update) => void): () => void {
  let seen = '';
  const run = async () => { const u = await checkForUpdate(); if (u && u.version !== seen) { seen = u.version; onUpdate(u); } };
  void run();
  const t = setInterval(run, 30 * 60 * 1000);
  return () => clearInterval(t);
}
