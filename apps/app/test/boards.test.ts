import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { addBoard, addCard, addList, boards, listsOf, cardsOf, moveCard, moveList, removeBoard, removeList, addCheck, progress, findBoard, findList } from '../src/boards.ts';
import { dueItems } from '../src/due.ts';
import { runTool } from '../src/ai/tools.ts';

beforeAll(ready);
async function pair() {
  const hub = new MemoryHub();
  const keys = new KeyRing('k1', randomKey());
  const mk = async (device: string) => { const e = new SyncEngine({ device, keys, store: new MemoryStore(), relay: new MemoryRelay(hub), flushMs: 5 }); await e.start(); return e; };
  return [await mk('mac'), await mk('iphone')] as const;
}
const settle = () => new Promise((r) => setTimeout(r, 60));

describe('boards', () => {
  it('makes a board with lists, cards move and keep their order', async () => {
    const [e] = await pair();
    const b = addBoard(e, 'Yami Sushi hjemmeside');
    const [todo, doing, done] = listsOf(e, b);
    expect([todo.name, doing.name, done.name]).toEqual(['Skal laves', 'I gang', 'Færdig']);
    const a = addCard(e, b, todo.id, 'Menukort');
    const c = addCard(e, b, todo.id, 'Billeder');
    const d = addCard(e, b, todo.id, 'Domæne');
    moveCard(e, d, todo.id, 0);
    expect(cardsOf(e, todo.id).map((x) => x.title)).toEqual(['Domæne', 'Menukort', 'Billeder']);
    moveCard(e, a, doing.id, 0);
    expect(cardsOf(e, doing.id).map((x) => x.title)).toEqual(['Menukort']);
    moveCard(e, c, doing.id, 0);
    expect(cardsOf(e, doing.id).map((x) => x.title)).toEqual(['Billeder', 'Menukort']);
    moveList(e, done.id, 0);
    expect(listsOf(e, b).map((l) => l.name)).toEqual(['Færdig', 'Skal laves', 'I gang']);
    const card = e.get(c) as any;
    addCheck(e, card, 'Tag billeder');
    addCheck(e, e.get(c) as any, 'Redigér');
    expect(progress(e.get(c) as any)).toBe('0/2');
    expect(findBoard(e, 'yami')?.id).toBe(b);
    expect(findList(e, b, 'i gang')?.id).toBe(doing.id);
  });

  it('syncs between the Mac and the iPhone', async () => {
    const [mac, phone] = await pair();
    const b = addBoard(mac, 'Køter lager');
    const l = listsOf(mac, b)[0];
    const id = addCard(mac, b, l.id, 'Tæl højttalere');
    await settle();
    expect(boards(phone).map((x) => x.name)).toEqual(['Køter lager']);
    const doing = listsOf(phone, b)[1];
    moveCard(phone, id, doing.id, 0);
    await settle();
    expect((mac.get(id) as any).list).toBe(doing.id);
  });

  it('removes a list or a board with its cards, and brings them back', async () => {
    const [e] = await pair();
    const b = addBoard(e, 'Test');
    const l = addList(e, b, 'Ekstra');
    addCard(e, b, l, 'Et kort');
    const undoList = removeList(e, l);
    expect(listsOf(e, b).length).toBe(3);
    undoList();
    expect(cardsOf(e, l).length).toBe(1);
    const undo = removeBoard(e, b);
    expect(boards(e).length).toBe(0);
    expect(e.list('bcard').length).toBe(0);
    undo();
    expect(boards(e).length).toBe(1);
    expect(listsOf(e, b).length).toBe(4);
  });

  it('a deadline comes as a notification until the card is done', async () => {
    const [e] = await pair();
    const b = addBoard(e, 'Bord');
    const at = new Date(Date.now() + 3600_000).toISOString();
    const id = addCard(e, b, listsOf(e, b)[0].id, 'Send tilbud', { due: at });
    expect(dueItems(e).some((x) => x.id === `card:${id}` && x.title === 'Frist: Send tilbud')).toBe(true);
    e.set('bcard', id, { done: true });
    expect(dueItems(e).some((x) => x.id === `card:${id}`)).toBe(false);
  });

  it('Assist can make a board with cards and move them', async () => {
    const [e] = await pair();
    const r = await runTool(e, 'create_board', { name: 'Tranberg Group site', cards: [{ title: 'Logo' }, { title: 'Tekster', list: 'I gang', due: '2026-12-01' }] });
    const id = (r.result as any).id;
    expect(listsOf(e, id).map((l) => l.name)).toEqual(['Skal laves', 'I gang', 'Færdig']);
    const tekster = (e.list('bcard') as any[]).find((c) => c.title === 'Tekster');
    expect((e.get(tekster.list) as any).name).toBe('I gang');
    await runTool(e, 'add_cards', { board: 'tranberg', cards: [{ title: 'Kontaktformular', list: 'Senere', checklist: ['Felter', 'Spamfilter'] }] });
    const kf = (e.list('bcard') as any[]).find((c) => c.title === 'Kontaktformular');
    expect((e.get(kf.list) as any).name).toBe('Senere');
    expect(kf.checklist.length).toBe(2);
    await runTool(e, 'move_card', { card: tekster.id, list: 'Færdig', done: true });
    expect((e.get((e.get(tekster.id) as any).list) as any).name).toBe('Færdig');
    expect((e.get(tekster.id) as any).done).toBe(true);
  });
});
