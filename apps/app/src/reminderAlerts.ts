/**
 * Notifications for the huskeliste, and what Siri was told.
 *
 *  iPhone  every open reminder with a time is planned with the system (local notifications), so it
 *          comes on time even when CENTRA is closed. Kept in step with the list: a new time, a new
 *          text, ticked off or deleted (here or on the Mac) moves or removes the planned one.
 *  Mac     the system can't plan ahead for the app there, so the app looks every 15 seconds while
 *          it runs and shows the notification when one is due.
 *  Both    a due reminder also shows in the app, with "Klaret".
 *
 * What the notification says stays on the device; it's the reminder's own text.
 */
import type { SyncEngine } from '@centra/sync';
import { ios, mobileApp, native, invoke } from './platform.ts';
import { reminders, toPlan, setDone, addReminder, type Reminder } from './reminders.ts';
import { aiReady, aiSettings } from './ai/agent.ts';
import { queueAssist } from './screens/Assist.tsx';

type Toast = (t: { text: string; title?: string; icon?: 'bell'; sticky?: boolean; action?: { label: string; run: () => void } }) => void;
type Go = (r: { screen: 'reminders' | 'assist' }) => void;

const PLANNED = 'centra.reminders.planned';
const SHOWN = 'centra.reminders.shown';
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** Asks once for permission to notify (the iPhone and the Mac ask the first time). */
export async function askToNotify(): Promise<boolean> {
  try {
    if (native) {
      const granted = await invoke<boolean | null>('plugin:notification|is_permission_granted');
      if (granted) return true;
      if (granted === false) return false;
      return (await invoke<string>('plugin:notification|request_permission')) === 'granted';
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') return (await Notification.requestPermission()) === 'granted';
    return Notification.permission === 'granted';
  } catch { return false; }
}

/** iPhone: plans exactly the reminders that should be planned, and takes back the rest. */
async function plan(e: SyncEngine) {
  const want = toPlan(reminders(e));
  const had = read<Record<string, string>>(PLANNED, {});
  const keep: Record<string, string> = {};
  const gone = Object.keys(had).filter((id) => !want.some((w) => String(w.id) === id && w.key === had[id])).map(Number);
  const add = want.filter((w) => had[String(w.id)] !== w.key);
  if (!gone.length && !add.length) return;
  if (add.length && !(await askToNotify())) return;
  if (gone.length) await invoke('plugin:notification|cancel', { notifications: gone }).catch(() => {});
  for (const w of want) if (had[String(w.id)] === w.key) keep[String(w.id)] = w.key;
  for (const w of add) {
    try {
      await invoke('plugin:notification|notify', { options: { id: w.id, title: 'Husk', body: w.text, schedule: { at: { date: new Date(w.at).toISOString(), repeating: false, allowWhileIdle: true } } } });
      keep[String(w.id)] = w.key;
    } catch { /* try again next round */ }
  }
  write(PLANNED, keep);
}

/** Starts it all; returns a stop function. */
export function startReminders(e: SyncEngine, toast: Toast, go: Go): () => void {
  let alive = true, sig = '';
  const shown = new Set(read<string[]>(SHOWN, []));

  const due = () => {
    const now = Date.now();
    for (const r of reminders(e) as Reminder[]) {
      if (r.done || !r.at || shown.has(r.id + r.at)) continue;
      const t = new Date(r.at).getTime();
      if (t > now) continue;
      shown.add(r.id + r.at);
      if (now - t > 6 * 3600_000) continue; // long past (the app was closed): the list shows it as overdue
      toast({ icon: 'bell', title: 'Husk', text: r.text, sticky: true, action: { label: 'Klaret', run: () => setDone(e, r.id, true) } });
      // The iPhone already showed it (planned); on the Mac and in a browser it's shown now.
      if (!mobileApp) {
        if (native) void invoke('plugin:notification|notify', { options: { id: 1, title: 'Husk', body: r.text } }).catch(() => {});
        else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') try { new Notification('Husk', { body: r.text, tag: r.id }); } catch { /* fine */ }
      }
    }
    write(SHOWN, [...shown].slice(-300));
  };

  const tick = () => {
    if (!alive) return;
    due();
    if (ios) {
      const s = toPlan(reminders(e)).map((w) => w.id + w.key).join(';');
      if (s !== sig) { sig = s; void plan(e).catch(() => { sig = ''; }); }
    }
  };

  // "Hey Siri, husk i CENTRA": what was said waits in the app's inbox until CENTRA opens.
  const siri = async () => {
    if (!ios || !alive) return;
    const said = await invoke<string[]>('siri_inbox').catch(() => [] as string[]);
    if (!said.length || !alive) return;
    if (aiReady(aiSettings(e))) {
      queueAssist(said.length === 1 ? `Husk mig på: ${said[0]}` : `Husk mig på disse ting:\n${said.map((s) => `- ${s}`).join('\n')}`);
      go({ screen: 'assist' });
    } else {
      for (const s of said) addReminder(e, s, null, 'Siri');
      toast({ icon: 'bell', text: said.length === 1 ? `På huskelisten: ${said[0]}` : `${said.length} ting på huskelisten`, action: { label: 'Se listen', run: () => go({ screen: 'reminders' }) } });
    }
  };

  tick(); void siri(); setTimeout(() => void siri(), 1500);
  const t = setInterval(tick, 15_000);
  // Siri opens the app and hands over what was said at about the same moment: look now and again shortly.
  const vis = () => { if (!document.hidden) { tick(); void siri(); setTimeout(() => void siri(), 1500); } };
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('focus', vis);
  // A reminder added, moved or ticked off (here, or on another device): planned again shortly after.
  let soon: ReturnType<typeof setTimeout> | undefined;
  const off = e.on((ids) => { if ([...ids].some((id) => (e.get(id) as any)?.type === 'reminder' || !e.get(id))) { clearTimeout(soon); soon = setTimeout(tick, 400); } });
  return () => { alive = false; clearInterval(t); clearTimeout(soon); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); off(); };
}
