import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { parseVCards, fromMac, plan, apply, merged, rememberDeleted, normBirthday, type MacContact } from '../src/contactImport.ts';
import type { Person } from '../src/money.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}

// As exported by the Contacts app on a Mac (vCard 3.0), plus an Android-style 2.1 card.
const VCF = [
  'BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'N:Tranberg;Maria;Louise;;', 'FN:Maria Louise Tranberg', 'ORG:Netto;', 'TITLE:Butikschef',
  'item1.TEL;type=CELL;type=VOICE;type=pref:+45 20 30 40 50', 'TEL;type=HOME;type=VOICE:44 55 66 77',
  'item2.EMAIL;type=INTERNET;type=pref:maria@example.dk', 'item2.X-ABLabel:_$!<Other>!$_',
  'item3.ADR;type=HOME;type=pref:;;Hillerødgade 12\\n2. tv;København N;;2200;Danmark',
  'BDAY:1604-05-12', 'X-SOCIALPROFILE;type=instagram;x-user=mariatranberg:x-apple:mariatranberg',
  'URL;type=HOME:https://www.linkedin.com/in/maria-t', 'NOTE:Søster. Spiller\\, synger',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/', ' 2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIy',
  'X-ABUID:ABC-123:ABPerson', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Holm;S=C3=B8ren;;;', 'TEL;CELL:+4511223344', 'END:VCARD',
].join('\r\n');

describe('vCard', () => {
  it('læser navn, numre, mails, adresse, fødselsdag, profiler, noter og billede', () => {
    const [m, s] = parseVCards(VCF);
    expect(m.name).toBe('Maria Louise Tranberg');
    expect(m.uid).toBe('ABC-123');
    expect(m.company).toBe('Netto · Butikschef');
    expect(m.phones).toEqual([{ label: 'Mobil', value: '+45 20 30 40 50' }, { label: 'Hjem', value: '44 55 66 77' }]);
    expect(m.emails).toEqual([{ label: 'Andet', value: 'maria@example.dk' }]);
    expect(m.addresses[0].value).toBe('Hillerødgade 12, 2. tv, 2200 København N, Danmark');
    expect(m.birthday).toBe('--05-12');
    expect(m.socials).toEqual([{ kind: 'instagram', value: 'mariatranberg' }, { kind: 'linkedin', value: 'https://www.linkedin.com/in/maria-t' }]);
    expect(m.notes).toBe('Søster. Spiller, synger');
    expect(m.photo).toMatch(/^data:image\/jpeg;base64,\/9j\/.+2wBDAQkJ/);
    expect(s.name).toBe('Søren Holm');
    expect(s.phones[0]).toEqual({ label: 'Mobil', value: '+4511223344' });
  });
  it('fødselsdage', () => {
    expect([normBirthday('1990-05-12'), normBirthday('19900512'), normBirthday('--0512'), normBirthday('1604-05-12'), normBirthday('x')]).toEqual(['1990-05-12', '1990-05-12', '--05-12', '--05-12', undefined]);
  });
});

describe('import', () => {
  it('opretter nye, opdaterer eksisterende uden at overskrive, og dublerer ikke', async () => {
    const e = await engine();
    const mine = e.create('person', { name: 'Maria T', phone: '20304050', notes: 'Min egen note', relation: 'Familie' });
    const incoming = parseVCards(VCF);
    const p1 = plan(e, incoming);
    expect(p1.map((x) => [x.c.name, x.status, x.match?.id ?? null])).toEqual([['Maria Louise Tranberg', 'update', mine], ['Søren Holm', 'new', null]]);
    const r = await apply(e, p1);
    expect(r).toEqual({ created: 1, updated: 1 });
    const maria = e.get(mine) as unknown as Person;
    expect(maria.name).toBe('Maria T');                // what you typed stays
    expect(maria.notes).toBe('Min egen note');
    expect(maria.phone).toBe('20304050');
    expect(maria.email).toBe('maria@example.dk');      // what was missing is filled in
    expect(maria.company).toBe('Netto · Butikschef');
    expect(maria.macId).toBe('ABC-123');
    expect(maria.extra).toEqual([{ label: 'Hjem', value: '44 55 66 77' }, { label: 'Fødselsdag', value: '12. maj' }]);
    // A second import finds the same people and has nothing new.
    const p2 = plan(e, parseVCards(VCF));
    expect(p2.map((x) => x.status)).toEqual(['same', 'same']);
    expect((e.list('person') as unknown[]).length).toBe(2);
  });
  it('finder en person, der kun er gemt med fornavn', async () => {
    const e = await engine();
    const maria = e.create('person', { name: 'Maria' });
    const p = plan(e, parseVCards(VCF));
    expect(p.find((x) => x.c.name === 'Maria Louise Tranberg')!.match?.id).toBe(maria);
    expect(p.find((x) => x.c.name === 'Søren Holm')!.match).toBeUndefined();
    await apply(e, p);
    expect((e.get(maria) as unknown as Person).name).toBe('Maria Louise Tranberg');
  });
  it('husker kontakter du har slettet', async () => {
    const e = await engine();
    await apply(e, plan(e, parseVCards(VCF)));
    const soren = (e.list('person') as unknown as Person[]).find((p) => p.name === 'Søren Holm')!;
    rememberDeleted(e, soren.macId); e.remove('person', soren.id);
    const p = plan(e, parseVCards(VCF)).find((x) => x.c.name === 'Søren Holm')!;
    expect(p.ignored).toBe(true);
  });
  it('kontakter fra Mac-appen', () => {
    const c: MacContact = { id: 'X1', given: 'Fiona', middle: '', family: 'Tranberg', nickname: '', company: '', title: '', phones: [{ label: 'iPhone', value: '+45 99 88 77 66' }, { label: 'Arbejde', value: '33 44 55 66' }], emails: [], addresses: [], urls: [{ label: 'homepage', value: 'https://instagram.com/fiona' }], socials: [{ label: 'Facebook', value: 'fiona.t' }], birthday: '2001-02-03', photo: null };
    const i = fromMac(c)!;
    expect(i.name).toBe('Fiona Tranberg');
    expect(i.socials).toEqual([{ kind: 'facebook', value: 'fiona.t' }, { kind: 'instagram', value: 'fiona' }]);
    const m = merged(undefined, i);
    expect([m.phone, m.birthday, m.extra]).toEqual(['+45 99 88 77 66', '2001-02-03', [{ label: 'Arbejde', value: '33 44 55 66' }]]);
  });
});
