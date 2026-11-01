/**
 * Opening links. Web links open in CENTRA's own browser (a separate window, private mode and VPN if
 * you want), everything else (mailto:, tel:, System Settings) goes to the Mac. In the browser version
 * of CENTRA, or when Indstillinger → Browser says Safari, web links open in the normal browser.
 */
import type { SyncEngine } from '@centra/sync';

import { desktop as desktopApp, native, invoke } from './platform.ts';

/** The in-app browser (with VPN) is in the Mac app; on the iPhone links open in Safari. */
const desktop = () => desktopApp;

/** Opens a link outside CENTRA: in the app through the system (Safari, Mail, Phone, System Settings), else a new tab. */
export async function openExternal(url: string) {
  if (native) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    return openUrl(url);
  }
  window.open(url, '_blank', 'noopener');
}

export type VpnKind = 'wireguard' | 'socks5' | 'http';
/** One VPN you can use in the browser. WireGuard: the provider's .conf file. SOCKS5/HTTP: server and login. */
export type VpnProfile = { id: string; name: string; kind: VpnKind; conf?: string; host?: string; port?: number; user?: string; pass?: string };
export type BrowserSettings = {
  /** Where web links open. */
  mode: 'centra' | 'safari';
  /** Private mode: nothing is saved (cookies, logins, history) when the window closes. */
  incognito: boolean;
  /** Send the browser's traffic through the chosen VPN. */
  vpnOn: boolean;
  /** Your VPNs, and which one is in use. */
  vpns: VpnProfile[];
  vpnActive: string;
  /** Search when what you type isn't an address. */
  search: 'duckduckgo' | 'google' | 'startpage';
  // Before VPN profiles there was one SOCKS5/HTTP server; it is read once as a profile.
  vpnKind?: 'socks5' | 'http'; vpnHost?: string; vpnPort?: number; vpnUser?: string; vpnPass?: string; vpnName?: string;
};
export const DEFAULT_BROWSER: BrowserSettings = { mode: 'centra', incognito: false, vpnOn: false, vpns: [], vpnActive: '', search: 'duckduckgo' };

export function browserSettings(e: SyncEngine): BrowserSettings {
  const r = (e.get('setting-browser') ?? {}) as Partial<BrowserSettings>;
  const s = { ...DEFAULT_BROWSER, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== undefined && k !== 'id' && k !== 'type')) } as BrowserSettings;
  if (!Array.isArray(s.vpns)) s.vpns = [];
  if (!s.vpns.length && s.vpnHost?.trim()) s.vpns = [{ id: 'vpn-old', name: s.vpnName || s.vpnHost, kind: s.vpnKind ?? 'socks5', host: s.vpnHost, port: s.vpnPort, user: s.vpnUser, pass: s.vpnPass }];
  if (!s.vpns.some((v) => v.id === s.vpnActive)) s.vpnActive = s.vpns[0]?.id ?? '';
  return s;
}
export const saveBrowserSettings = (e: SyncEngine, s: Partial<BrowserSettings>) => e.set('setting', 'setting-browser', s);
export const activeVpn = (s: BrowserSettings) => s.vpns.find((v) => v.id === s.vpnActive) ?? null;
export const vpnReady = (s: BrowserSettings) => !!activeVpn(s);

/** A profile as the Mac side wants it. */
export const vpnWire = (v: VpnProfile) => ({ id: v.id, kind: v.kind, name: v.name, conf: v.kind === 'wireguard' ? v.conf ?? '' : null, host: v.host?.trim() ?? '', port: Number(v.port) || 0, user: v.user?.trim() || null, pass: v.pass || null });

/** The server a WireGuard file points at, to show in lists ("185.107.56.1:51820"). */
export const wgEndpoint = (conf = '') => /^\s*Endpoint\s*=\s*(\S+)/im.exec(conf)?.[1] ?? '';

/** What the Mac side needs to open the browser. All VPNs go along, so the toolbar can switch between them. */
export function browserWire(s: BrowserSettings) {
  const a = activeVpn(s);
  return { incognito: s.incognito, search: s.search, vpnOn: s.vpnOn && !!a, vpn: a ? vpnWire(a) : null, vpns: s.vpns.map(vpnWire) };
}

let engine: SyncEngine | null = null;
/** Called once when CENTRA is unlocked, so links anywhere know the browser settings. */
export const bindLinks = (e: SyncEngine | null) => { engine = e; };

/** Opens a link the right place: web links in CENTRA's browser (or Safari), the rest on the Mac. */
export async function openLink(url: string) {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u) || !desktop()) return openExternal(u);
  const s = engine ? browserSettings(engine) : DEFAULT_BROWSER;
  if (s.mode === 'safari') return openExternal(u);
  try {
    await invoke('browser_open', { url: u, cfg: browserWire(s) });
  } catch {
    return openExternal(u); // an older Mac app without the browser
  }
}
