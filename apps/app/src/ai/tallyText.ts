/**
 * A regnestykke in your own words: "pantede flasker med Jonas for 440, købte mad for 315, han gav mig
 * en pakke snus til 64". The AI (Haiku) turns it into lines; CENTRA does the arithmetic itself.
 */
import type { SyncEngine } from '@centra/sync';
import { askJson } from './agent.ts';
import { ME, findOrCreatePerson, people as contacts, personName, toLines, type Tally, type TallyLine } from '../money.ts';
export { toLines };

export type TallyDraft = {
  title?: string | null; date?: string | null; person?: string | null;
  lines?: { text: string; amount: number; kind: TallyLine['kind']; by: 'mig' | 'person'; whose: 'begge' | 'mig' | 'person' }[];
};

export const TALLY_RULES = `Hver linje er én ting, der skete mellem brugeren ("mig") og den anden person:
- kind: "expense" = penge betalt ud (mad, billetter, benzin). "income" = penge modtaget (pant, salg, gevinst, refusion). "gift" = en gave, ingen skylder noget for den.
- by: hvem der betalte (expense), fik pengene (income) eller gav gaven (gift): "mig" eller "person".
- whose: hvis det var: "begge" (deles ligeligt), "mig" (kun brugerens) eller "person" (kun den andens).
Eksempler: "vi pantede flasker for 440" (og brugeren fik pengene, når intet andet står) → income 440, by mig, whose begge.
"vi købte mad for 315" (betalt af brugeren, når intet andet står) → expense 315, by mig, whose begge.
"han gav mig en pakke snus til 64" → expense 64, by person, whose mig (han betalte for noget til brugeren, så brugeren skylder ham), MEDMINDRE teksten siger det var en gave → gift.
"jeg lagde 100 ud til hans billet" → expense 100, by mig, whose person.
Gæt aldrig beløb. Er det uklart, hvem der betalte eller fik pengene, så vælg brugeren ("mig").`;

const SYS = `Du laver regnestykker mellem en dansk bruger og én anden person, så man kan se, hvem der skylder hvem.
Du får regnestykkets nuværende tilstand som JSON og brugerens tekst. Teksten kan være nye ting eller rettelser ("snusen var en gave", "Jonas fik pantpengene", "slet maden").

Svar KUN med JSON med den fulde nye tilstand:
{"title": string, "date": "YYYY-MM-DD"|null, "person": string|null, "lines": [{"text": string, "amount": number, "kind": "expense"|"income"|"gift", "by": "mig"|"person", "whose": "begge"|"mig"|"person"}]}

${TALLY_RULES}
- Behold alle linjer, teksten ikke ændrer, i samme rækkefølge; nye til sidst. amount er altid positiv, i kroner, punktum som decimaltegn.
- person: den anden persons navn (brug navnet fra kontaktlisten, hvis det tydeligt er den samme; et fornavn er nok, hvis det kun passer på én).
- title: kort, fx "Pant og mad med Jonas". Behold den nuværende, medmindre den er tom.`;

export function describeTally(e: SyncEngine, t: Tally) {
  return {
    title: t.title ?? '', date: t.date ?? null, person: t.person ? personName(e, t.person) : null,
    lines: (t.lines ?? []).map((l) => ({ text: l.text, amount: l.amount, kind: l.kind, by: l.by === 'me' ? 'mig' : 'person', whose: l.whose === 'both' ? 'begge' : l.whose === 'me' ? 'mig' : 'person' })),
  };
}

export async function readTallyText(e: SyncEngine, t: Tally, text: string): Promise<TallyDraft> {
  const names = contacts(e).map((p) => p.name).filter(Boolean).slice(0, 300);
  const msg = `I dag er ${new Date().toISOString().slice(0, 10)}.\nKontakter: ${names.join(', ') || '(ingen)'}\n\nRegnestykket nu:\n${JSON.stringify(describeTally(e, t))}\n\nBrugeren skriver:\n${text.trim()}`;
  return askJson<TallyDraft>(e, SYS, msg, { feature: 'udlaeg', maxTokens: 3000, label: `Regnestykke: ${text.trim().slice(0, 100)}` });
}

export function applyTallyDraft(e: SyncEngine, t: Tally, d: TallyDraft, rid: () => string): { fields: Partial<Tally>; created: string[] } {
  const created: string[] = [];
  const fields: Partial<Tally> = { lines: toLines(d.lines, rid, t.lines ?? []) };
  if (d.person?.trim()) {
    const { id, created: made } = findOrCreatePerson(e, d.person.trim());
    if (id !== ME) { fields.person = id; if (made) created.push(id); }
  }
  if (d.title?.trim() && !t.title?.trim()) fields.title = d.title.trim();
  if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) fields.date = d.date;
  return { fields, created };
}
