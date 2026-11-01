/** Reading saved photos with AI (Haiku can see). */
import type { SyncEngine } from '@centra/sync';
import { askJson, aiReady, aiSettings } from './agent.ts';
import { KINDS, cleanAnalysis, storePhoto, type Analysis, type Photo } from '../photos.ts';

const SYS = `Du beskriver et billede, som en dansk bruger har gemt for at kunne finde og bruge det igen senere.
Svar KUN med JSON: {"title": string, "description": string, "tags": [string], "text": string, "kind": string}
- title: 2-6 ord, konkret ("Grøn strikket trøje fra Arket", "Bookingbekræftelse DJ-lektion").
- description: 1-4 sætninger med det, man vil søge efter: hvad det er, farver, mærke/brand, materiale, størrelse, pris, butik, sted, personer (uden at gætte navne), og hvad billedet nok skal bruges til.
- tags: 3-10 korte søgeord på dansk med små bogstaver (fx "trøje", "grøn", "strik", "arket", "tøj").
- text: AL læsbar tekst i billedet, ordret, med linjeskift (tal, datoer, priser, koder, links). Tom streng hvis ingen tekst.
- kind: én af ${KINDS.join(', ')}.`;

/** Reads a photo with the cheapest model that can see (Haiku). */
export async function analyzePhoto(e: SyncEngine, image: string): Promise<Analysis> {
  const r = await askJson<Partial<Analysis>>(e, SYS, 'Beskriv billedet.', { images: [image], feature: 'billeder', maxTokens: 2500, label: 'Læste et gemt billede' });
  return cleanAnalysis(r);
}

/** Saves a photo and reads it in the background when Assist is connected. Returns the id at once. */
export function savePhoto(e: SyncEngine, p: Parameters<typeof storePhoto>[1], onDone?: (ok: boolean) => void): string {
  const id = storePhoto(e, p);
  if (p.analysis) return id;
  if (aiReady(aiSettings(e))) void analyzePhoto(e, p.image).then((r) => { if (e.get(id)) e.set('photo', id, { ...r, analyzed: true }); onDone?.(true); }, () => onDone?.(false));
  else onDone?.(false);
  return id;
}
export type { Photo };
