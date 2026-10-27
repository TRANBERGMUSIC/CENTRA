/**
 * Sorts new mail with AI: important vs. noise (ads, newsletters, automatic notices), plus a
 * one-line summary. Runs on new mail only, in batches, with the fast model; rules still apply
 * without it.
 */
import type { SyncEngine } from '@centra/sync';
import { askJson, aiSettings } from './agent.ts';

const SYS = `Du sorterer en dansk brugers mails. For hver mail: er den vigtig for brugeren personligt (fra et menneske, arbejde, aftaler, regninger/kvitteringer, sikkerhed, leverancer, noget der kræver handling) eller støj (reklame, nyhedsbrev, tilbud, sociale netværk, automatiske notifikationer uden handling)?
Svar KUN med JSON: {"mails": [{"id": string, "important": boolean, "summary": string}]} hvor summary er højst 12 ord på dansk.`;

export async function triageMails(e: SyncEngine, ids: string[]): Promise<number> {
  const s = aiSettings(e);
  if (s.triage === false || !(s.provider === 'claude' && s.claudeKey)) return 0;
  const mails = ids.map((id) => e.get(id) as any).filter((m) => m && !m.ai).slice(0, 60);
  let n = 0;
  for (let i = 0; i < mails.length; i += 20) {
    const batch = mails.slice(i, i + 20);
    const text = batch.map((m) => `id: ${m.id}\nfra: ${m.fromName} <${m.fromEmail}>\nemne: ${m.subject}\nuddrag: ${String(m.preview ?? '').slice(0, 200)}`).join('\n---\n');
    try {
      const r = await askJson<{ mails: { id: string; important: boolean; summary: string }[] }>(e, SYS, text, { fast: true, maxTokens: 2000, feature: 'mailsortering' });
      for (const x of r.mails ?? []) {
        const m = batch.find((b) => b.id === x.id);
        if (!m) continue;
        e.set('mail', m.id, { ai: { important: !!x.important, summary: String(x.summary ?? '').slice(0, 120) }, ...(x.important ? {} : { needsReply: false }) });
        n++;
      }
    } catch { return n; /* offline or no credit: rules-based sorting still works */ }
  }
  return n;
}
