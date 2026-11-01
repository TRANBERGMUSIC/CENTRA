import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { calTypes, createType, updateType, deleteType, typeForName, eventColor, typeOf } from '../src/calTypes.ts';
import { plainText } from '../src/notes.ts';

beforeAll(ready);
const KEYS = () => new KeyRing('kabcd', SHARED);
let SHARED: Uint8Array;
beforeAll(() => { SHARED = randomKey(); });
async function engine(hub = new MemoryHub(), device = 'mac') {
  const e = new SyncEngine({ device, keys: KEYS(), store: new MemoryStore(), relay: new MemoryRelay(hub), flushMs: 5 });
  await e.start();
  return e;
}

describe('kalendertyper', () => {
  it('starts with Personlig and Arbejde, takes as many new ones as you like, and colours events by type', async () => {
    const e = await engine();
    expect(calTypes(e).map((t) => t.name)).toEqual(['Personlig', 'Arbejde']);
    const tr = createType(e, 'Træning', '#34c759');
    const fam = createType(e, 'Familie', '#0a84ff');
    expect(createType(e, 'træning', '#000000')).toBe(tr); // same name: the same type
    expect(calTypes(e).length).toBe(4);
    const ev = { cat: tr };
    expect(eventColor(calTypes(e), ev)).toBe('#34C759');
    updateType(e, tr, { color: '#ff3b30' });
    expect(eventColor(calTypes(e), ev)).toBe('#FF3B30');
    // events from before types follow their calendar's name
    expect(typeOf(calTypes(e), { cal: 'Arbejde' })?.id).toBe('calcat-work');
    // Assist: a known name, or a new type in a free colour
    expect(typeForName(e, 'arbejde')).toBe('calcat-work');
    const music = typeForName(e, 'Musik');
    expect(calTypes(e).find((t) => t.id === music)?.color).toMatch(/^#[0-9A-F]{6}$/);
    // deleting a type keeps its events
    const id = e.create('event', { title: 'Løb', start: '2026-11-02T07:00', end: '2026-11-02T08:00', cat: fam });
    deleteType(e, fam);
    expect(e.get(id)?.title).toBe('Løb');
    expect(e.get(id)?.cat).toBeNull();
    deleteType(e, 'calcat-personal');
    expect(calTypes(e).some((t) => t.id === 'calcat-personal')).toBe(false); // a deleted starting type stays deleted
  });

  it('never makes the starting types twice when the Mac and the iPhone both change them', async () => {
    const hub = new MemoryHub();
    const mac = await engine(hub, 'mac'), phone = await engine(hub, 'phone');
    updateType(mac, 'calcat-work', { color: '#ff9500' });
    updateType(phone, 'calcat-work', { name: 'Netto' });
    await new Promise((r) => setTimeout(r, 80));
    const t = calTypes(mac).filter((x) => x.id === 'calcat-work');
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({ name: 'Netto', color: '#FF9500' });
  });
});

describe('note previews', () => {
  it('shows lists and checklists without the Markdown signs', () => {
    expect(plainText('# Indkøb\n- [ ] mælk\n- [x] æg\n- **pant** 440\n++husk++ ~~ikke~~ *det*')).toBe('Indkøb\n☐ mælk\n☑ æg\n• pant 440\nhusk ikke det');
  });
});
