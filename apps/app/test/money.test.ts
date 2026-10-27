import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { parseKr, kr, shares, owed, balances, payBack, parseItemLines, perMonth, payDates, monthSpend, findOrCreatePerson, cancelLink, ME, type Outlay, type Expense } from '../src/money.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}

describe('beløb', () => {
  it('læser danske og engelske tal', () => {
    expect([parseKr('1.234,50'), parseKr('1234.5'), parseKr('99 kr'), parseKr('12,-'), parseKr('1.500'), parseKr('7,5')]).toEqual([1234.5, 1234.5, 99, 12, 1500, 7.5]);
    expect(kr(1234.5)).toBe('1.234,50 kr');
    expect(kr(100)).toBe('100 kr');
  });
  it('læser varelinjer', () => {
    expect(parseItemLines('Pizza 120\n2x øl: 90,50\n45 kr chips\nnoget uden pris')).toEqual([{ name: 'Pizza', amount: 120 }, { name: '2x øl', amount: 90.5 }, { name: 'chips', amount: 45 }]);
  });
});

describe('udlæg', () => {
  it('deler i hele øre, og resten lander hos mig', () => {
    const o = { items: [{ id: 'a', name: 'Pizza', amount: 100, who: [] }], people: [ME, 'p1', 'p2'] };
    expect(shares(o)).toEqual({ me: 33.34, p1: 33.33, p2: 33.33 });
    const o2 = { items: [{ id: 'a', name: 'Pizza', amount: 300, who: [] }, { id: 'b', name: 'Vin', amount: 120, who: ['p1'] }, { id: 'c', name: 'Cola', amount: 30, who: [ME, 'p2'] }], people: [ME, 'p1', 'p2'] };
    expect(shares(o2)).toEqual({ me: 115, p1: 220, p2: 115 });
    // I paid it all for someone else: nothing is split with me
    expect(shares({ items: [{ id: 'a', name: 'Billet', amount: 349, who: [] }], people: ['p1'] })).toEqual({ p1: 349 });
  });

  it('delvise betalinger på tværs af udlæg, ældste først', async () => {
    const e = await engine();
    const mads = findOrCreatePerson(e, 'mads').id;
    expect(findOrCreatePerson(e, 'Mads').created).toBe(false);
    expect(findOrCreatePerson(e, 'jeg').id).toBe(ME);
    const o1 = e.create('outlay', { title: 'Biograf', date: '2026-10-01', people: [ME, mads], items: [{ id: 'a', name: 'Billetter', amount: 240, who: [] }] });
    const o2 = e.create('outlay', { title: 'Pizza', date: '2026-10-20', people: [ME, mads], items: [{ id: 'a', name: 'Pizza', amount: 200, who: [] }] });
    expect(balances(e)).toEqual([{ person: mads, share: 220, paid: 0, left: 220, open: [o1, o2] }]);
    payBack(e, mads, 150);
    const pays = e.list('payment') as any[];
    expect(owed(e.get(o1) as unknown as Outlay, pays)[0].left).toBe(0);
    expect(owed(e.get(o2) as unknown as Outlay, pays)[0].left).toBe(70);
    expect(balances(e)[0].left).toBe(70);
    payBack(e, mads, 70);
    expect(balances(e)[0].left).toBe(0);
  });
});

describe('udgifter', () => {
  it('pr. måned og betalingsdatoer, også 31. i korte måneder', () => {
    const rent: Expense = { id: 'r', name: 'Husleje', amount: 6000, interval: 'month', category: 'Bolig', date: '2026-01-31' };
    const ins: Expense = { id: 'i', name: 'Indbo', amount: 1200, interval: 'year', category: 'Forsikring', date: '2026-03-15' };
    expect(perMonth(rent) + perMonth(ins)).toBe(6100);
    const feb = payDates(rent, new Date(2026, 1, 1), new Date(2026, 2, 1));
    expect(feb.map((d) => d.getDate())).toEqual([28]);
    expect(payDates(ins, new Date(2027, 0, 1), new Date(2027, 11, 31)).map((d) => d.getMonth())).toEqual([2]);
    expect(payDates({ ...rent, end: '2026-05-31' }, new Date(2026, 5, 1), new Date(2026, 6, 1))).toHaveLength(0);
  });
  it('månedens forbrug tæller min andel af udlæg med', async () => {
    const e = await engine();
    e.create('expense', { name: 'Netflix', amount: 129, interval: 'month', category: 'Abonnementer', date: '2026-01-05' });
    e.create('outlay', { title: 'Pizza', date: '2026-10-20', people: [ME, 'x'], items: [{ id: 'a', name: 'Pizza', amount: 200, who: [] }] });
    const s = monthSpend(e, 2026, 9);
    expect(s.map((x) => [x.name, x.amount, x.date])).toEqual([['Netflix', 129, '2026-10-05'], ['Pizza (din andel)', 100, '2026-10-20']]);
    expect(cancelLink({ name: 'Netflix Standard' })).toBe('https://www.netflix.com/cancelplan');
    expect(cancelLink({ name: 'Fitness World' })).toContain('google.com/search?q=opsig');
  });
});

import { runTool, applyUndo, contextFor } from '../src/ai/tools.ts';
describe('Assist: kontakter, udlæg og udgifter', () => {
  it('gemmer kontakter, laver udlæg, registrerer betaling og udgift', async () => {
    const e = await engine();
    const c = runTool(e, 'save_contact', { name: 'Mads Holm', phone: '20 30 40 50', relation: 'Kollega', notes: 'Arbejder i Netto. Har en trailer.' }) as any;
    runTool(e, 'save_contact', { name: 'Mads', socials: [{ kind: 'instagram', value: '@madsh' }], notes: 'Spiller bas.' });
    const mads = e.get(c.result.id) as any;
    expect(mads.notes).toBe('Arbejder i Netto. Har en trailer.\nSpiller bas.');
    expect(mads.socials).toEqual([{ kind: 'instagram', value: '@madsh' }]);
    expect((runTool(e, 'find_contact', { query: 'trailer' }).result as any[])[0].name).toBe('Mads Holm');

    const o = runTool(e, 'create_outlay', { title: 'Pizza fredag', people: ['mig', 'Mads', 'Sofie'], items: [{ name: 'Pizzaer', amount: 300 }, { name: 'Vin', amount: 120, who: ['Mads', 'Sofie'] }] }) as any;
    expect(o.result.total).toBe(420);
    expect(o.result.owes).toEqual([{ person: 'Mads Holm', owes: 160 }, { person: 'Sofie', owes: 160 }]);
    expect(o.result.new_contacts).toEqual(['Sofie']);
    const p = runTool(e, 'record_payment', { person: 'mads', amount: 100 }) as any;
    expect(p.result.still_owes).toBe(60);
    expect(contextFor(e)).toContain('Mads Holm skylder 60 kr');
    applyUndo(e, p.action.undo);
    expect((runTool(e, 'balances', {}).result as any[]).find((b) => b.person === 'Mads Holm').owes).toBe(160);

    const x = runTool(e, 'add_expense', { name: 'Netflix', amount: 129, interval: 'month' }) as any;
    expect((e.get(x.result.id) as any).category).toBe('Abonnementer');
    expect((runTool(e, 'list_expenses', {}).result as any).items[0].cancel).toBe('https://www.netflix.com/cancelplan');
    expect(contextFor(e)).toContain('Faste udgifter: 129 kr');
  });
});
