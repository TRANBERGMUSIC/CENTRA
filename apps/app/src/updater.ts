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
declare const __WEB_VERSION__: number;

export const APP_VERSION = __APP_VERSION__;
export const REPO = __GITHUB_REPOSITORY__;
/** When this interface was built (the commit time): fast updates replace it without a new app. */
export const WEB_VERSION = Number(__WEB_VERSION__);
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
  } catch (e) {
    // Offline, or the newest release has no signed update file (latest.json) yet.
    throw new Error(String((e as Error)?.message ?? e));
  }
}

/**
 * Keeps the running app up to date without closing it:
 *  - checks at launch, every 15 minutes, and whenever the window comes back into focus;
 *  - downloads a new version in the background as soon as it appears (desktop);
 *  - installs it with one click ("Genstart"), or by itself once you have been away for a while
 *    (10 min without activity, or 2 min with the window hidden) — the same moments CENTRA would lock anyway.
 */
export type UpdateState = { phase: 'ready'; version: string; install: () => Promise<void> };

export function watchForUpdates(onReady: (u: UpdateState) => void): () => void {
  let busy = false, ready: UpdateState | null = null, lastCheck = 0, lastInput = Date.now(), hiddenAt: number | null = null;

  async function run() {
    if (busy || ready) return;
    busy = true; lastCheck = Date.now();
    try {
      if (platform === 'desktop') {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        const u = await check();
        if (u) {
          await u.download(); // in the background, while you keep working
          ready = { phase: 'ready', version: u.version, install: async () => { await u.install(); await relaunch(); } };
        }
      } else {
        const u = await checkForUpdate();
        if (u) ready = { phase: 'ready', version: u.version, install: u.install };
      }
      if (ready) onReady(ready);
    } catch { /* offline or no release yet: try again later */ }
    finally { busy = false; }
  }

  const input = () => { lastInput = Date.now(); };
  const vis = () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    hiddenAt = null;
    if (Date.now() - lastCheck > 5 * 60_000) void run();
  };
  const idleInstall = setInterval(() => {
    if (!ready) return;
    const away = Date.now() - lastInput > 10 * 60_000 || (hiddenAt !== null && Date.now() - hiddenAt > 2 * 60_000);
    if (away) void ready.install();
  }, 30_000);
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((e) => addEventListener(e, input, { passive: true }));
  document.addEventListener('visibilitychange', vis);
  addEventListener('focus', vis);
  void run();
  const t = setInterval(run, 15 * 60_000);
  return () => {
    clearInterval(t); clearInterval(idleInstall);
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((e) => removeEventListener(e, input));
    document.removeEventListener('visibilitychange', vis);
    removeEventListener('focus', vis);
  };
}
