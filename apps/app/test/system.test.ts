import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { ME, tallyLeft, lineNet, balances, debts, payBack, payDebt, type Tally } from '../src/money.ts';
import { runTool, applyUndo, contextFor } from '../src/ai/tools.ts';
import { sortByRules, ruleMatches } from '../src/mailFolders.ts';
import { folderTree, renameFolder, deleteFolder, createFolder, linksIn, backlinks } from '../src/notes.ts';
import { goalStats, type Goal } from '../src/goals.ts';
import { searchPhotos, storePhoto } from '../src/photos.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}

describe('regnestykker', () => {
  it('pant 440, mad 315, snus 64: du skylder Jonas 126,50 kr', async () => {
    const e = await engine();
    const r = runTool(e, 'create_tally', { person: 'Jonas', title: 'Pant og mad', lines: [
      { text: 'Pant', amount: 440, kind: 'income', by: 'mig', whose: 'begge' },
      { text: 'Mad', amount: 315, kind: 'expense', by: 'mig', whose: 'begge' },
      { text: 'Snus', amount: 64, kind: 'expense', by: 'person', whose: 'mig' },
    ] }) as any;
    expect(r.result.result).toBe('Brugeren skylder Jonas 126,50 kr');
    const jonas = (e.list('person') as any[]).find((p) => p.name === 'Jonas').id;
    expect(debts(e).find((d) => d.person === jonas)?.left).toBe(126.5);
    expect(balances(e).find((d) => d.person === jonas)).toBeUndefined();
    // paying it off through the usual "jeg har betalt Jonas"
    const ids = payDebt(e, jonas, 126.5);
    expect(ids).toHaveLength(1);
    expect(tallyLeft(e.get(r.result.id) as unknown as Tally, e.list('payment') as any).left).toBe(0);
    // undo removes the tally and the new contact
    applyUndo(e, r.action.undo);
    expect(e.list('tally')).toHaveLength(0);
  });
  it('hver slags linje regnes rigtigt', () => {
    const L = (kind: any, by: any, whose: any) => lineNet({ amount: 100, kind, by, whose }) / 100;
    expect([L('expense', 'me', 'both'), L('expense', 'me', 'them'), L('expense', 'me', 'me')]).toEqual([50, 100, 0]);
    expect([L('expense', 'them', 'both'), L('expense', 'them', 'me'), L('expense', 'them', 'them')]).toEqual([-50, -100, 0]);
    expect([L('income', 'me', 'both'), L('income', 'me', 'them'), L('income', 'them', 'both'), L('income', 'them', 'me')]).toEqual([-50, -100, 50, 100]);
    expect(L('gift', 'them', 'me')).toBe(0);
  });
  it('de skylder dig: indgår i overblikket og betales af med payBack', async () => {
    const e = await engine();
    const mads = e.create('person', { name: 'Mads' });
    const t = e.create('tally', { title: 'Tur', date: '2026-10-30', person: mads, lines: [{ id: 'a', text: 'Benzin', amount: 300, kind: 'expense', by: 'me', whose: 'both' }] });
    expect(balances(e).find((b) => b.person === mads)?.left).toBe(150);
    payBack(e, mads, 100);
    expect(tallyLeft(e.get(t) as any, e.list('payment') as any).left).toBe(50);
  });
});

describe('mailmapper', () => {
  it('regler sorterer nye mails, og Assist kan lave mapper og flytte mails', async () => {
    const e = await engine();
    e.set('mail', 'm1', { fromName: 'Netto', fromEmail: 'kvittering@netto.dk', subject: 'Din kvittering', body: 'Tak for købet', at: '2026-10-30T10:00:00Z' });
    e.set('mail', 'm2', { fromName: 'DJ School', fromEmail: 'booking@djschool.dk', subject: 'Booking bekræftet', body: 'Lektion 19. nov', at: '2026-10-30T11:00:00Z' });
    e.set('mail', 'm3', { fromName: 'Sofie', fromEmail: 'sofie@x.dk', subject: 'Fredag?', body: 'Hej', at: '2026-10-30T12:00:00Z' });
    const r = runTool(e, 'create_mail_folder', { name: 'Kvitteringer', description: 'kvitteringer og ordrer', rules: [{ subject: 'kvittering, ordre' }], sort_existing: true }) as any;
    expect(r.result.moved).toBe(1);
    expect((e.get('m1') as any).mbox).toBe(r.result.id);
    const dj = runTool(e, 'create_mail_folder', { name: 'DJ', rules: [{ from: 'djschool' }] }) as any;
    e.set('mail', 'm4', { fromName: 'DJ School', fromEmail: 'info@djschool.dk', subject: 'Ny lektion', body: '', at: '2026-10-31T10:00:00Z' });
    expect(sortByRules(e, ['m4'])).toBe(1); // new mail on arrival
    expect((e.get('m4') as any).mbox).toBe(dj.result.id);
    const mv = runTool(e, 'move_mails', { mail_ids: ['m2'], folder: 'DJ' }) as any;
    expect((e.get('m2') as any)).toMatchObject({ mbox: dj.result.id, mboxManual: true });
    applyUndo(e, mv.action.undo);
    expect((e.get('m2') as any).mbox).toBe('');
    expect(contextFor(e)).toContain('DJ: 1 mails');
    const del = runTool(e, 'delete_mail_folder', { folder_id: dj.result.id }) as any;
    expect((e.get('m4') as any).mbox).toBe('');
    applyUndo(e, del.action.undo);
    expect((e.get('m4') as any).mbox).toBe(dj.result.id);
    expect(ruleMatches({ fromName: 'X', fromEmail: 'a@b.dk', subject: 'Hej', body: 'faktura nr 3' }, { words: 'faktura', from: 'b.dk' })).toBe(true);
    expect(ruleMatches({ fromName: 'X', fromEmail: 'a@c.dk', subject: 'Hej', body: 'faktura' }, { words: 'faktura', from: 'b.dk' })).toBe(false);
  });
});

describe('notemapper', () => {
  it('mapper i mapper, omdøb og slet uden at miste noter, og links mellem noter', async () => {
    const e = await engine();
    const a = e.create('note', { title: 'Vagtplan', folder: 'Arbejde/Netto', tags: [] });
    const b = e.create('note', { title: 'Idé til SmartLink', folder: 'Projekter', tags: [] });
    e.doc(b).getText('body').insert(0, 'Se [[Vagtplan]] og [[Ny ting]]');
    createFolder(e, 'Arbejde/Netto/Gammelt');
    const names = (ns: any[]): string[] => ns.flatMap((n) => [n.path, ...names(n.children)]);
    expect(names(folderTree(e))).toEqual(['Indbakke', 'Arbejde', 'Arbejde/Netto', 'Arbejde/Netto/Gammelt', 'Projekter']);
    expect(folderTree(e).find((f) => f.path === 'Arbejde')!.total).toBe(1);
    const undo = renameFolder(e, 'Arbejde', 'Job');
    expect((e.get(a) as any).folder).toBe('Job/Netto');
    undo.forEach((u) => e.set(u.type, u.id, u.fields));
    expect((e.get(a) as any).folder).toBe('Arbejde/Netto');
    const d = deleteFolder(e, 'Arbejde/Netto');
    expect((e.get(a) as any).folder).toBe('Arbejde');
    expect(d.to).toBe('Arbejde');
    expect(linksIn('Se [[Vagtplan]] og [[Ny ting]]')).toEqual(['Vagtplan', 'Ny ting']);
    expect(backlinks(e, 'vagtplan', a).map((n: any) => n.id)).toEqual([b]);
    const r = runTool(e, 'organize_notes', { create_folders: ['Musik/DJ'], move: [{ note_id: b, folder: 'Musik/DJ' }], tags: [{ note_id: b, tags: ['#SmartLink', 'idé'] }] }) as any;
    expect(e.get(b)).toMatchObject({ folder: 'Musik/DJ', tags: ['smartlink', 'idé'] });
    applyUndo(e, r.action.undo);
    expect(e.get(b)).toMatchObject({ folder: 'Projekter', tags: [] });
  });
});

describe('mål', () => {
  it('"løbe 5 km 10 gange i år": tæller gange i året og ved, om du er bagud', async () => {
    const e = await engine();
    const r = runTool(e, 'create_goal', { title: 'Løbe 5 km', kind: 'count', target: 10, each: 'løbe 5 km', period: 'year' }) as any;
    const id = r.result.id;
    const log = runTool(e, 'log_goal_progress', { goal_id: id }) as any;
    expect(log.result.progress).toMatch(/^1 af 10 gange i \d{4}$/);
    runTool(e, 'log_goal_progress', { goal_id: id, date: `${new Date().getFullYear() - 1}-06-01` }); // last year doesn't count
    e.set('goal', id, { start: `${new Date().getFullYear()}-01-01` }); // made in January
    const g = e.get(id) as unknown as Goal;
    const s = goalStats(g, e.list('goalUpdate') as any, new Date(new Date().getFullYear(), 9, 1));
    expect(s.value).toBe(1);
    expect(s.onTrack).toBe(false); // October with 1 of 10
    const s2 = goalStats(g, e.list('goalUpdate') as any, new Date(new Date().getFullYear(), 0, 20));
    expect(s2.onTrack).toBe(true);
    // made today: measured from today, so not behind yet
    e.set('goal', id, { start: new Date().toISOString().slice(0, 10) });
    expect(goalStats(e.get(id) as any, e.list('goalUpdate') as any).onTrack).toBe(true);
  });
  it('noget der skal gøres én gang, og update_goal holder orden', async () => {
    const e = await engine();
    const r = runTool(e, 'create_goal', { title: 'Få lavet hjemmesiden', kind: 'once', due: '2026-12-20', next: 'Vælg domæne', steps: ['Domæne', 'Design'] }) as any;
    const id = r.result.id;
    expect(goalStats(e.get(id) as any, []).label).toBe('0 af 2 trin');
    runTool(e, 'log_goal_progress', { goal_id: id, step_done: 'domæne' });
    expect(goalStats(e.get(id) as any, []).label).toBe('1 af 2 trin');
    runTool(e, 'log_goal_progress', { goal_id: id, done: true });
    expect(goalStats(e.get(id) as any, []).label).toBe('Gjort');
    const u = runTool(e, 'update_goal', { goal_id: id, status: 'paused', add_steps: ['Tekster'] }) as any;
    expect((e.get(id) as any).steps).toHaveLength(3);
    applyUndo(e, u.action.undo);
    expect((e.get(id) as any).steps).toHaveLength(2);
    expect(contextFor(e)).toContain('Få lavet hjemmesiden (once');
  });
});

describe('billeder', () => {
  it('finder trøjen fra i forgårs, og Assist kan gemme et vedhæftet billede', async () => {
    const e = await engine();
    const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
    storePhoto(e, { image: 'data:image/png;base64,AAAA', thumb: 'data:image/png;base64,AA', takenAt: day(2), analysis: { title: 'Grøn strikket trøje', description: 'Grøn strik fra Arket, 600 kr', tags: ['trøje', 'grøn', 'tøj'], kind: 'tøj' } });
    storePhoto(e, { image: 'data:image/png;base64,BBBB', thumb: 'data:image/png;base64,BB', takenAt: day(1), analysis: { title: 'Bookingbekræftelse', description: 'DJ-lektion', tags: ['booking'], text: 'Reservation 4802892 · 19. nov kl. 10', kind: 'skærmbillede' } });
    expect(searchPhotos(e, 'trøjen').map((p) => p.title)).toEqual(['Grøn strikket trøje']);
    expect(searchPhotos(e, '4802892').map((p) => p.title)).toEqual(['Bookingbekræftelse']);
    const twoDaysAgo = day(2).slice(0, 10);
    expect(searchPhotos(e, '', { from: twoDaysAgo, to: twoDaysAgo }).map((p) => p.title)).toEqual(['Grøn strikket trøje']);
    const r = runTool(e, 'search_photos', { query: 'grøn trøje' }) as any;
    expect(r.images).toHaveLength(1);
    expect(r.action.open).toEqual({ screen: 'photos', id: r.result[0].id });
    const look = runTool(e, 'look_at_photos', { photo_ids: [r.result[0].id] }) as any;
    expect(look.images[0]).toBe('data:image/png;base64,AAAA');
    // saving what the user attached
    const { setAttachments } = await import('../src/ai/tools.ts');
    expect(() => runTool(e, 'save_attached_photos', { photos: [{ title: 'X' }] })).toThrow();
    setAttachments(['data:image/jpeg;base64,CCCC']);
    const s = runTool(e, 'save_attached_photos', { photos: [{ index: 0, title: 'Sort jakke', tags: ['Jakke'], kind: 'tøj', description: 'Sort dunjakke' }] }) as any;
    expect(e.get(s.result.ids[0])).toMatchObject({ title: 'Sort jakke', tags: ['jakke'], source: 'assist', analyzed: true });
    setAttachments([]);
  });
});

describe('Assist kan alt', () => {
  it('finder og sletter et gammelt regnestykke med Jonas, og det kan fortrydes', async () => {
    const e = await engine();
    const r = runTool(e, 'create_tally', { person: 'Jonas', title: 'Pant og mad', lines: [{ text: 'Pant', amount: 440, kind: 'income', by: 'mig', whose: 'begge' }] }) as any;
    const n = runTool(e, 'create_note', { title: 'Indkøb', body: '- [ ] mælk' }) as any;
    const found = runTool(e, 'find_items', { query: 'jonas', kinds: ['tally'] }).result as any;
    expect(found.items).toHaveLength(1);
    expect(found.items[0].kind).toBe('regnestykke');
    expect(found.items[0].summary).toContain('Jonas');
    // any kind, by words, without saying which
    expect((runTool(e, 'find_items', { query: 'mælk' }).result as any).items[0].kind).toBe('note');
    const del = runTool(e, 'delete_items', { ids: [found.items[0].id] }) as any;
    expect(e.list('tally')).toHaveLength(0);
    expect(del.action.label).toContain('regnestykke');
    applyUndo(e, del.action.undo);
    expect(e.list('tally')).toHaveLength(1);
    expect((e.get(r.result.id) as any).lines).toHaveLength(1);
    // change anything: a note's text and a field, then undo both
    const noteId = n.result.id ?? (e.list('note') as any[])[0].id;
    const up = runTool(e, 'update_item', { id: noteId, fields: { body: '- [x] mælk', title: 'Handel' } }) as any;
    expect(e.doc(noteId).getText('body').toString()).toBe('- [x] mælk');
    expect((e.get(noteId) as any).title).toBe('Handel');
    expect((runTool(e, 'get_item', { id: noteId }).result as any).body).toBe('- [x] mælk');
    applyUndo(e, up.action.undo);
    expect(e.doc(noteId).getText('body').toString()).toBe('- [ ] mælk');
    expect((e.get(noteId) as any).title).toBe('Indkøb');
    expect(() => runTool(e, 'delete_items', { ids: ['findes-ikke'] })).toThrow();
  });
});

describe('noter på en aftale', () => {
  it('flybilletter står i aftalens noter, ikke som en ny note, og kan fortrydes', async () => {
    const e = await engine();
    const r = runTool(e, 'create_event', { title: 'Fly til Barcelona', date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), start_time: '07:15', end_time: '10:05', notes: '**Booking** ABC123\nTerminal 3' }) as any;
    const id = r.result.id;
    expect(e.list('note')).toHaveLength(0);
    expect(e.doc(id).getText('notes').toString()).toContain('ABC123');
    expect((e.get(id) as any).notesPreview).toBe('Booking ABC123 Terminal 3');
    const add = runTool(e, 'event_notes', { event_id: id, text: '- [ ] pas\n- [ ] oplader' }) as any;
    expect(e.doc(id).getText('notes').toString()).toBe('**Booking** ABC123\nTerminal 3\n\n- [ ] pas\n- [ ] oplader');
    expect(contextFor(e)).toContain('noter: Booking ABC123');
    expect((runTool(e, 'find_items', { query: 'oplader' }).result as any).items[0].id).toBe(id);
    expect((runTool(e, 'get_item', { id }).result as any).notes).toContain('oplader');
    applyUndo(e, add.action.undo);
    expect(e.doc(id).getText('notes').toString()).toBe('**Booking** ABC123\nTerminal 3');
    expect((e.get(id) as any).notesPreview).toBe('Booking ABC123 Terminal 3');
    runTool(e, 'update_item', { id, fields: { notes: 'Gate B22' } });
    expect((e.get(id) as any).notesPreview).toBe('Gate B22');
  });
});
