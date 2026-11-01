/**
 * The browser window's toolbar (its own little page, browser.html). It only talks to CENTRA's Mac
 * side; the web page under it is a separate view without any access to CENTRA.
 */
import './toolbar.css';

// Talks to Tauri directly (the same calls @tauri-apps/api makes), so this page shares no code with CENTRA's own bundle.
type Internals = { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>; transformCallback: (cb: (e: any) => void, once?: boolean) => number };
const T = () => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
const invoke = <T,>(cmd: string, args: Record<string, unknown> = {}) => T().invoke<T>(cmd, args);
const listen = <P,>(event: string, cb: (e: { payload: P }) => void) => invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: T().transformCallback(cb) });

type State = { url: string; title: string; loading: boolean; incognito: boolean; vpn_on: boolean; vpn_name: string; vpn_available: boolean; vpn_error: string; vpn_id?: string; vpns?: { id: string; name: string }[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const q = $<HTMLInputElement>('q'), addr = $<HTMLFormElement>('addr'), badge = $('badge'), load = $('load'), note = $<HTMLButtonElement>('note');
const inc = $<HTMLButtonElement>('inc'), vpn = $<HTMLButtonElement>('vpn'), vpnLabel = $('vpnlabel'), reload = $<HTMLButtonElement>('reload'), pick = $<HTMLSelectElement>('vpnpick');
let state: State = { url: '', title: '', loading: false, incognito: false, vpn_on: false, vpn_name: '', vpn_available: false, vpn_error: '' };
let editing = false;
let noteTimer = 0;
let reveal = '';

/** "https://www.dr.dk/nyheder" → "dr.dk/nyheder" while not editing. */
const pretty = (u: string) => { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname)).slice(0, 200); } catch { return u; } };

function say(text: string, kind: 'info' | 'error' = 'info', ms = 5000, path = '') {
  note.textContent = text; note.hidden = !text; note.dataset.kind = kind; reveal = path;
  note.title = path ? 'Vis i Finder' : text;
  clearTimeout(noteTimer);
  if (ms) noteTimer = window.setTimeout(() => { note.hidden = true; reveal = ''; }, ms);
}

function render() {
  if (!editing) q.value = state.url ? pretty(state.url) : '';
  const secure = state.url.startsWith('https:');
  badge.dataset.kind = state.vpn_on ? 'vpn' : state.incognito ? 'private' : secure ? 'secure' : state.url ? 'insecure' : '';
  badge.title = state.vpn_on ? `Gennem VPN: ${state.vpn_name}` : secure ? 'Sikker forbindelse (https)' : state.url ? 'Ikke krypteret (http)' : '';
  document.body.classList.toggle('is-private', state.incognito);
  document.body.classList.toggle('is-vpn', state.vpn_on);
  addr.classList.toggle('is-loading', state.loading);
  load.hidden = !state.loading;
  reload.classList.toggle('is-loading', state.loading);
  reload.setAttribute('aria-label', state.loading ? 'Stop' : 'Genindlæs');
  inc.setAttribute('aria-pressed', String(state.incognito));
  vpn.setAttribute('aria-pressed', String(state.vpn_on));
  vpn.classList.toggle('is-error', !!state.vpn_error);
  vpnLabel.textContent = state.vpn_on ? (state.vpn_name ? `VPN · ${state.vpn_name}` : 'VPN') : 'VPN';
  vpn.title = !state.vpn_available ? 'Sæt VPN op i CENTRA under Indstillinger → Browser' : state.vpn_on ? `Trafikken går gennem ${state.vpn_name}. Tryk for at slå fra.` : 'Send trafikken gennem din VPN';
  document.title = state.title ? `${state.title} · CENTRA` : 'CENTRA Browser';
  // More than one VPN: a menu to switch (Sverige, Holland, Japan …).
  const list = state.vpns ?? [];
  pick.hidden = list.length < 2;
  const key = list.map((v) => v.id + v.name).join('|');
  if (pick.dataset.key !== key) { pick.dataset.key = key; pick.replaceChildren(...list.map((v) => { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; return o; })); }
  pick.value = state.vpn_id ?? '';
  if (state.vpn_error) say(state.vpn_error, 'error', 0);
  else if (note.dataset.kind === 'error') say('');
}

async function run<T>(cmd: string, args: Record<string, unknown> = {}) {
  try { return await invoke<T>(cmd, args); } catch (e) { say(String((e as Error)?.message ?? e), 'error', 6000); return undefined; }
}

addr.addEventListener('submit', (ev) => { ev.preventDefault(); const v = q.value.trim(); if (!v) return; editing = false; q.blur(); void run('browser_go', { input: v }); });
q.addEventListener('focus', () => { editing = true; q.value = state.url; requestAnimationFrame(() => q.select()); });
q.addEventListener('blur', () => { editing = false; render(); });
q.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { q.blur(); } });
$('back').addEventListener('click', () => void run('browser_nav', { action: 'back' }));
$('fwd').addEventListener('click', () => void run('browser_nav', { action: 'forward' }));
reload.addEventListener('click', () => void run('browser_nav', { action: state.loading ? 'stop' : 'reload' }));
inc.addEventListener('click', () => { say(state.incognito ? 'Privat er slået fra' : 'Privat: intet gemmes, når vinduet lukkes'); void run('browser_toggle', { incognito: !state.incognito }); });
vpn.addEventListener('click', () => {
  if (!state.vpn_available) return say('Sæt VPN op i CENTRA under Indstillinger → Browser', 'error', 6000);
  say(state.vpn_on ? 'VPN er slået fra' : `Forbinder gennem ${state.vpn_name || 'VPN'} …`);
  void run('browser_toggle', { vpnOn: !state.vpn_on });
});
pick.addEventListener('change', () => { say(`Skifter til ${pick.selectedOptions[0]?.textContent ?? 'VPN'} …`); void run('browser_toggle', { vpnId: pick.value }); });
$('ext').addEventListener('click', () => void run('browser_external'));
$('copy').addEventListener('click', async () => { if (!state.url) return; try { await navigator.clipboard.writeText(state.url); say('Linket er kopieret'); } catch { say('Kunne ikke kopiere', 'error'); } });
$('clear').addEventListener('click', async () => { await run('browser_clear'); say('Cookies, logins og historik er ryddet'); });
note.addEventListener('click', () => { if (reveal) void run('browser_reveal', { path: reveal }); });

// Keyboard: ⌘L address, ⌘R reload, ⌘[ / ⌘] back and forward.
document.addEventListener('keydown', (ev) => {
  if (!(ev.metaKey || ev.ctrlKey)) return;
  const k = ev.key.toLowerCase();
  if (k === 'l') { ev.preventDefault(); q.focus(); }
  else if (k === 'r') { ev.preventDefault(); void run('browser_nav', { action: 'reload' }); }
  else if (k === '[') { ev.preventDefault(); void run('browser_nav', { action: 'back' }); }
  else if (k === ']') { ev.preventDefault(); void run('browser_nav', { action: 'forward' }); }
});

void listen<State>('browser-state', (ev) => { state = ev.payload; render(); });
void listen<{ name?: string; path?: string; done: boolean; ok?: boolean }>('browser-download', (ev) => {
  const d = ev.payload;
  if (!d.done) say(`Henter ${d.name ?? 'fil'} …`, 'info', 0, d.path ?? '');
  else if (d.ok === false) say('Overførslen mislykkedes', 'error');
  else say(`Hentet til Overførsler · Vis`, 'info', 8000, reveal);
});
void invoke<State>('browser_state').then((s) => { if (s) { state = s; render(); } }).catch(() => {});
render();
