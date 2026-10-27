/** Reads a receipt (photo or screenshot) or a free-text list of what was bought. */
import type { SyncEngine } from '@centra/sync';
import { askJson } from './agent.ts';

export type ReadReceipt = { store?: string; date?: string; total?: number; items: { name: string; amount: number }[] };

const SYS = `Du læser kvitteringer og indkøbslister for en dansk bruger. Svar KUN med JSON:
{"store": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "items": [{"name": string, "amount": number}]}
- amount er den endelige pris for linjen i kroner (antal × stykpris, efter rabat på linjen). Brug punktum som decimaltegn.
- Rabatter, pant og gebyrer bliver deres egne linjer (rabat med negativt beløb). Moms og "i alt" er IKKE linjer.
- Korte, læsbare danske varenavne ("Mælk 1 l", "Pizza Margherita"). Gæt ikke varer, der ikke står der.
- total er beløbet betalt i alt, hvis det står der.`;

export async function readReceipt(e: SyncEngine, input: { image?: string; text?: string }): Promise<ReadReceipt> {
  const r = await askJson<ReadReceipt>(e, SYS, input.text?.trim() ? `Det her er købt:\n${input.text}` : 'Læs denne kvittering.', { images: input.image ? [input.image] : [], feature: 'kvittering' });
  const items = (r.items ?? []).map((i) => ({ name: String(i.name ?? '').trim(), amount: Math.round(Number(i.amount) * 100) / 100 })).filter((i) => i.name && Number.isFinite(i.amount) && i.amount !== 0);
  return { store: r.store ?? undefined, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') ? r.date : undefined, total: Number.isFinite(Number(r.total)) ? Number(r.total) : undefined, items };
}

/** Photo → small JPEG data URL (max 1600 px, ~150 kB), so receipts don't bloat the encrypted store. */
export function shrinkImage(file: Blob, max = 1600, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Billedet kunne ikke åbnes. Brug JPG, PNG eller HEIC.')); };
    img.src = url;
  });
}
