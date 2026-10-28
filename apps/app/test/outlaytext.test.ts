import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { ME, shares, owed, iOwe, type Outlay } from '../src/money.ts';
import { applyDraft, describe as describeOutlay } from '../src/ai/outlayText.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
let n = 0; const rid = () => `i${++n}`;
const blank = (e: SyncEngine) => e.get(e.create('outlay', { title: '', date: '2026-10-28', people: [ME], items: [] })) as unknown as Outlay;

describe('udlæg skrevet med egne ord', () => {
  it('laver varer, personer og deling ud fra AI-svaret', async () => {
    const e = await engine();
    const sofie = e.create('person', { name: 'Sofie Holm' });
    const o = blank(e);
    const { fields, created } = applyDraft(e, o, {
      title: 'Pizza fredag', paid_by: 'mig', people: ['mig', 'Sofie Holm', 'Mads'], category: 'Mad & ude',
      items: [{ name: 'Pizza', amount: 240, who: [] }, { name: 'Cola', amount: 25, who: ['Mads'] }],
    }, rid);
    expect(created.map((c) => c.name)).toEqual(['Mads']);
    const mads = created[0].id;
    expect(fields.people).toEqual([ME, sofie, mads]);
    expect(fields.items!.map((i) => [i.name, i.amount, i.who])).toEqual([['Pizza', 240, []], ['Cola', 25, [mads]]]);
    expect(fields.title).toBe('Pizza fredag');
    e.set('outlay', o.id, fields as any);
    const now = e.get(o.id) as unknown as Outlay;
    expect(shares(now)).toEqual({ [ME]: 80, [sofie]: 80, [mads]: 105 });
    expect(owed(now, []).map((x) => x.left)).toEqual([80, 105]);
  });

  it('en rettelse beholder uændrede varer, og "Sofie lagde ud" gør det til noget, jeg skylder', async () => {
    const e = await engine();
    const sofie = e.create('person', { name: 'Sofie Holm' });
    const id = e.create('outlay', { title: 'Middag', date: '2026-10-28', people: [ME, sofie], items: [{ id: 'keep', name: 'Pasta', amount: 300, who: [] }, { id: 'gone', name: 'Vin', amount: 120, who: [sofie] }] });
    const o = e.get(id) as unknown as Outlay;
    // what the AI sees: names, not ids
    expect(describeOutlay(e, o)).toMatchObject({ paid_by: 'mig', people: ['mig', 'Sofie Holm'], items: [{ name: 'Pasta' }, { name: 'Vin', who: ['Sofie Holm'] }] });
    const { fields } = applyDraft(e, o, { title: 'Middag', paid_by: 'Sofie', people: ['mig', 'Sofie'], items: [{ name: 'Pasta', amount: 300, who: [] }, { name: 'Vin', amount: 150, who: ['Sofie'] }] }, rid);
    expect(fields.paidBy).toBe(sofie);
    expect(fields.items![0].id).toBe('keep');
    expect(fields.items![1].id).not.toBe('gone'); // repriced
    e.set('outlay', id, fields as any);
    expect(iOwe(e.get(id) as unknown as Outlay, [])?.left).toBe(150);
  });

  it('"Mads var ikke med" fjerner ham, og "mig" tilbage som betaler rydder paidBy', async () => {
    const e = await engine();
    const mads = e.create('person', { name: 'Mads' });
    const o = e.get(e.create('outlay', { title: 'Kaffe', date: '2026-10-28', people: [ME, mads], paidBy: mads, items: [{ id: 'k', name: 'Kaffe', amount: 90, who: [] }] })) as unknown as Outlay;
    const { fields } = applyDraft(e, o, { paid_by: 'mig', people: ['mig'], items: [{ name: 'Kaffe', amount: 90, who: [] }] }, rid);
    expect(fields.people).toEqual([ME]);
    expect(fields.paidBy).toBeUndefined();
    expect(fields.title).toBeUndefined(); // kept as it is
  });

  it('ikke valgt betaler forbliver ikke valgt, og vrøvl bliver sorteret fra', async () => {
    const e = await engine();
    const o = e.get(e.create('outlay', { title: '', date: '2026-10-28', people: [ME], paidBy: '', items: [] })) as unknown as Outlay;
    const { fields, created } = applyDraft(e, o, { paid_by: '(ikke valgt)', people: [], date: 'i går', category: 'Pizza', items: [{ name: '', amount: 10 }, { name: 'Is', amount: Number.NaN }, { name: 'Chips', amount: 19.999 }] }, rid);
    expect(fields.paidBy).toBe('');
    expect(fields.people).toEqual([ME]);
    expect(fields.items!.map((i) => [i.name, i.amount])).toEqual([['Chips', 20]]);
    expect(fields.date).toBeUndefined();
    expect(fields.category).toBeUndefined();
    expect(created).toEqual([]);
  });
});

describe('Sendt', () => {
  it('henter Sendt-mappen og erstatter den lokale kopi af en mail sendt fra CENTRA', async () => {
    const e = await engine();
    const calls: any[] = [];
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: async (cmd: string, args: any) => {
      calls.push([cmd, args]);
      if (cmd === 'mail_send') return { from: 'w@x.dk', message_id: 'abc@x.dk', saved_in: 'Sent' };
      if (cmd === 'mail_fetch' && args.folder === 'SENT') return { folder: 'Sent', uid_validity: 7, exists: 1, messages: [
        { uid: 4, message_id: 'abc@x.dk', in_reply_to: '', references: '', from_name: 'W', from_email: 'w@x.dk', to: ['sofie@x.dk'], cc: [], subject: 'Hej', date: '2026-10-28T20:00:00Z', text: 'Hej Sofie', seen: true, flagged: false, answered: false, attachments: [], list: false },
        { uid: 5, message_id: 'phone@x.dk', in_reply_to: '', references: '', from_name: 'W', from_email: 'w@x.dk', to: ['mads@x.dk'], cc: [], subject: 'Fra telefonen', date: '2026-10-28T21:00:00Z', text: 'Hej Mads', seen: true, flagged: false, answered: false, attachments: [], list: false },
      ] };
      if (cmd === 'mail_fetch') return { folder: 'INBOX', uid_validity: 1, exists: 0, messages: [] };
      return null;
    } }));
    const { sendMail, syncAccount } = await import('../src/mail.ts');
    const acct = e.create('mailacct', { name: 'Arbejde', host: 'h', port: 993, security: 'tls', user: 'w', pass: 'p', smtpHost: 'h', smtpPort: 465, smtpSecurity: 'tls', email: 'w@x.dk' });
    await sendMail(e, acct, { to: ['sofie@x.dk'], subject: 'Hej', body: 'Hej Sofie' });
    const local = (e.list('mail') as any[]).filter((m) => m.sent);
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ messageId: 'abc@x.dk', fromName: 'sofie@x.dk', cat: 'Sendt', needsReply: false });
    await syncAccount(e, e.get(acct) as any);
    const sent = (e.list('mail') as any[]).filter((m) => m.sent).sort((a, b) => a.uid - b.uid);
    expect(sent.map((m) => [m.uid, m.folder, m.subject])).toEqual([[4, 'Sent', 'Hej'], [5, 'Sent', 'Fra telefonen']]);
    expect(e.get(acct)).toMatchObject({ sentLastUid: 5, sentUidValidity: 7, sentFolder: 'Sent' });
    // the next fetch only asks for newer ones
    await syncAccount(e, e.get(acct) as any);
    expect(calls.filter(([c, a]) => c === 'mail_fetch' && a.folder === 'SENT').pop()[1].sinceUid).toBe(5);
    expect((e.list('mail') as any[]).filter((m) => m.sent)).toHaveLength(2);
    delete (globalThis as any).window;
  });
});
