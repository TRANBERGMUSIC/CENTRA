/**
 * Write an udlæg in your own words instead of scanning a receipt: "Pizza 240 og 2 cola 40, Sofie og Mads
 * var med, Mads betaler sin cola selv". Also corrections: "Mads var ikke med", "colaen kostede 30",
 * "Sofie lagde ud". The AI gets the udlæg as it is now and returns the whole new version, which is then
 * applied here (names → contacts, unchanged items keep their id).
 */
import type { SyncEngine } from '@centra/sync';
import { askJson } from './agent.ts';
import { ME, CATEGORIES, findOrCreatePerson, people as contacts, personName, payerOf, type Outlay, type Item } from '../money.ts';

export type OutlayDraft = {
  title?: string | null; place?: string | null; date?: string | null; category?: string | null;
  paid_by?: string | null; people?: string[]; items?: { name: string; amount: number; who?: string[] }[];
};

const SYS = `Du holder styr på et udlæg for en dansk bruger: en regning, der deles mellem flere personer.
Du får udlæggets nuværende tilstand som JSON og brugerens tekst. Teksten kan være en liste over, hvad der er købt,
en beskrivelse ("pizza 240 til mig, Sofie og Mads, Mads fik en cola til 25 alene") eller en rettelse
("Mads var ikke med", "colaen kostede 30", "Sofie lagde ud", "slet chipsene").

Svar KUN med JSON med den fulde nye tilstand:
{"title": string, "place": string|null, "date": "YYYY-MM-DD"|null, "category": string, "paid_by": string,
 "people": [string], "items": [{"name": string, "amount": number, "who": [string]}]}

Regler:
- Behold alt, teksten ikke ændrer. Returnér ALLE varer, også de uændrede, i samme rækkefølge; nye varer til sidst.
  Fjern kun varer, når teksten siger det. Er teksten bare flere varer, lægges de til.
- amount er linjens samlede pris i kroner (antal × stykpris). Punktum som decimaltegn. Gæt aldrig et beløb.
  Står der kun et samlet beløb ("maden kostede 800"), bliver det én vare.
- "mig" er brugeren selv ("jeg", "mig", "os" inkluderer brugeren). Brug navnene fra kontaktlisten, når det tydeligt er
  samme person (et fornavn er nok, hvis det kun passer på én). Ellers navnet, som det er skrevet.
- people: alle, der deler regningen, med "mig", hvis brugeren er med.
- who: tom liste betyder, at varen deles ligeligt mellem alle i people. Ellers navnene på dem, der betaler varen.
- paid_by: "mig", medmindre teksten siger, at en anden betalte ("Sofie lagde ud", "jeg skylder Mads for …").
  Betalte en anden, er "mig" med i people, og den, der betalte, er også med.
- category er en af: ${CATEGORIES.join(', ')}.
- title er kort ("Pizza fredag"). Behold den nuværende titel, medmindre den er tom eller teksten ændrer den.`;

/** The udlæg as the AI sees it: names instead of ids. */
export function describe(e: SyncEngine, o: Outlay) {
  const name = (id: string) => (id === ME ? 'mig' : personName(e, id));
  return {
    title: o.title ?? '', place: o.place ?? null, date: o.date ?? null, category: o.category ?? 'Mad & ude',
    paid_by: o.paidBy === '' ? '(ikke valgt)' : name(payerOf(o)),
    people: (o.people ?? [ME]).map(name),
    items: (o.items ?? []).map((i) => ({ name: i.name, amount: i.amount, who: (i.who ?? []).map(name) })),
  };
}

export async function readOutlayText(e: SyncEngine, o: Outlay, text: string): Promise<OutlayDraft> {
  const names = contacts(e).map((p) => p.name).filter(Boolean).slice(0, 300);
  const msg = `I dag er ${new Date().toISOString().slice(0, 10)}.\nKontakter: ${names.join(', ') || '(ingen)'}\n\nUdlægget nu:\n${JSON.stringify(describe(e, o))}\n\nBrugeren skriver:\n${text.trim()}`;
  return askJson<OutlayDraft>(e, SYS, msg, { fast: true, feature: 'kvittering', maxTokens: 6000 });
}

export type Applied = { fields: Partial<Outlay>; created: { id: string; name: string }[] };

/** Turns the AI's answer into fields for the udlæg. Creates contacts for names nobody matches. */
export function applyDraft(e: SyncEngine, o: Outlay, d: OutlayDraft, rid: () => string): Applied {
  const created: { id: string; name: string }[] = [];
  const ids = new Map<string, string>();
  const idOf = (n: string) => {
    const k = n.trim().toLowerCase();
    if (!k || k === '(ikke valgt)') return '';
    if (!ids.has(k)) {
      const { id, created: made } = findOrCreatePerson(e, n.trim());
      if (made) created.push({ id, name: n.trim() });
      ids.set(k, id);
    }
    return ids.get(k)!;
  };
  const pb = d.paid_by?.trim();
  const payer = !pb || pb === '(ikke valgt)' ? (o.paidBy === '' ? '' : payerOf(o)) : idOf(pb) || ME;
  let ppl = [...new Set((d.people ?? []).map(idOf).filter(Boolean))];
  if (!ppl.length) ppl = o.people?.length ? [...o.people] : [ME];
  if (payer !== ME) { if (!ppl.includes(ME)) ppl.unshift(ME); if (payer && !ppl.includes(payer)) ppl.push(payer); }
  // Unchanged items keep their id (and so their place in the list); a renamed or repriced one gets a new one.
  const old = [...(o.items ?? [])];
  const items: Item[] = [];
  for (const i of d.items ?? []) {
    const name = String(i.name ?? '').trim(), amount = Math.round(Number(i.amount) * 100) / 100;
    if (!name || !Number.isFinite(amount) || amount === 0) continue;
    let who = [...new Set((i.who ?? []).map(idOf).filter(Boolean))];
    for (const w of who) if (!ppl.includes(w)) ppl.push(w);
    if (who.length === ppl.length) who = [];
    const same = old.findIndex((x) => x.name === name && x.amount === amount);
    items.push({ id: same >= 0 ? old.splice(same, 1)[0].id : rid(), name, amount, who });
  }
  // Someone added to the people later shares what was shared by everyone before.
  for (const it of items) if (it.who.length && it.who.length === ppl.length) it.who = [];
  const fields: Partial<Outlay> = { people: ppl, items, paidBy: payer === ME ? (undefined as unknown as string) : payer };
  if (d.title?.trim()) fields.title = d.title.trim();
  if (d.place !== undefined) fields.place = d.place?.trim() ?? '';
  if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) fields.date = d.date;
  if (d.category && CATEGORIES.includes(d.category)) fields.category = d.category;
  return { fields, created };
}
