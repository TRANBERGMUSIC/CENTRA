import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { parseIcs, zonedToUtc } from '../src/ics.ts';
import { classify, matchWatches } from '../src/mail.ts';
import { runTool, contextFor } from '../src/ai/tools.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
const ev = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT\r\n`;
const win = [new Date('2026-10-01T00:00:00Z'), new Date('2027-01-31T00:00:00Z')] as const;

describe('iCal', () => {
  it('tidszoner, også over sommertid', () => {
    expect(new Date(zonedToUtc(2026, 10, 27, 6, 0, 0, 'Europe/Copenhagen')).toISOString()).toBe('2026-10-27T05:00:00.000Z'); // vintertid
    expect(new Date(zonedToUtc(2026, 7, 1, 6, 0, 0, 'Europe/Copenhagen')).toISOString()).toBe('2026-07-01T04:00:00.000Z'); // sommertid
    expect(new Date(zonedToUtc(2026, 10, 27, 6, 0, 0, 'Romance Standard Time')).toISOString()).toBe('2026-10-27T05:00:00.000Z'); // Outlook-navn
  });

  it('ugentlig gentagelse med undtagelse og flyttet dag, krydser sommertid', () => {
    const t = cal(ev(['UID:netto@x', 'SUMMARY:Netto', 'DTSTART;TZID=Europe/Copenhagen:20261020T060000', 'DTEND;TZID=Europe/Copenhagen:20261020T160000',
      'RRULE:FREQ=WEEKLY;BYDAY=TU,WE,FR;UNTIL=20261106T235959Z', 'EXDATE;TZID=Europe/Copenhagen:20261028T060000', 'LOCATION:Netto\\, Nørrebro'])
      + ev(['UID:netto@x', 'RECURRENCE-ID;TZID=Europe/Copenhagen:20261030T060000', 'SUMMARY:Netto (kort)', 'DTSTART;TZID=Europe/Copenhagen:20261030T080000', 'DTEND;TZID=Europe/Copenhagen:20261030T120000']));
    const r = parseIcs(t, ...win);
    expect(r.map((x) => [x.start, x.title])).toEqual([
      ['2026-10-20T04:00:00.000Z', 'Netto'], ['2026-10-21T04:00:00.000Z', 'Netto'], ['2026-10-23T04:00:00.000Z', 'Netto'],
      ['2026-10-27T05:00:00.000Z', 'Netto'], ['2026-10-30T07:00:00.000Z', 'Netto (kort)'],
      ['2026-11-03T05:00:00.000Z', 'Netto'], ['2026-11-04T05:00:00.000Z', 'Netto'], ['2026-11-06T05:00:00.000Z', 'Netto'],
    ]);
    expect(r[0].place).toBe('Netto, Nørrebro');
  });

  it('heldagsbegivenheder, UTC-tider, månedlig, aflyst og foldede linjer', () => {
    const t = cal(ev(['UID:a', 'SUMMARY:Fødselsdag', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106', 'RRULE:FREQ=YEARLY'])
      + ev(['UID:b', 'SUMMARY:Møde med en meget lang', '  titel', 'DTSTART:20261102T090000Z', 'DURATION:PT1H30M'])
      + ev(['UID:c', 'SUMMARY:Husleje', 'DTSTART;TZID=Europe/Copenhagen:20261101T090000', 'DTEND;TZID=Europe/Copenhagen:20261101T091500', 'RRULE:FREQ=MONTHLY;COUNT=3'])
      + ev(['UID:d', 'SUMMARY:Aflyst', 'STATUS:CANCELLED', 'DTSTART:20261103T090000Z', 'DTEND:20261103T100000Z'])
      + ev(['UID:e', 'SUMMARY:Sidste fredag', 'DTSTART;TZID=Europe/Copenhagen:20261030T150000', 'DTEND;TZID=Europe/Copenhagen:20261030T160000', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'END:VALARM']));
    const r = parseIcs(t, ...win);
    const by = (s: string) => r.filter((x) => x.title === s);
    expect(by('Fødselsdag')).toHaveLength(1);
    expect(by('Fødselsdag')[0].allDay).toBe(true);
    expect(by('Møde med en meget lang titel')[0]).toMatchObject({ start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:30:00.000Z' });
    expect(by('Husleje').map((x) => x.start)).toEqual(['2026-11-01T08:00:00.000Z', '2026-12-01T08:00:00.000Z', '2027-01-01T08:00:00.000Z']);
    expect(by('Aflyst')).toHaveLength(0);
    expect(by('Sidste fredag').map((x) => x.start.slice(0, 10))).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });
});

describe('mail', () => {
  const base = { uid: 1, message_id: 'x', in_reply_to: '', references: '', from_name: 'Sofie', from_email: 'sofie@example.dk', to: ['w@test.dk'], cc: [], subject: 'Frokost?', date: new Date().toISOString(), text: '', seen: false, flagged: false, answered: false, attachments: [], list: false };
  it('sorterer mails', () => {
    expect(classify(base, 'w@test.dk')).toEqual({ cat: 'Personer', needsReply: true });
    expect(classify({ ...base, answered: true }, 'w@test.dk').needsReply).toBe(false);
    expect(classify({ ...base, list: true }, 'w@test.dk').cat).toBe('Nyhedsbreve');
    expect(classify({ ...base, subject: 'Din kvittering fra Netto' }, 'w@test.dk').cat).toBe('Kvitteringer');
    expect(classify({ ...base, from_email: 'no-reply@bank.dk' }, 'w@test.dk')).toEqual({ cat: 'Notifikationer', needsReply: false });
  });

  it('overvågning fanger den rigtige mail, og Assist kan søge, læse og lave udkast', async () => {
    const e = await engine();
    e.set('mailacct', 'a', { name: 'Gmail', email: 'w@test.dk' });
    runTool(e, 'watch_mail', { description: 'Vagtplan fra Netto', from: 'netto', subject_contains: 'vagtplan' });
    e.set('mail', 'm-a-1', { acct: 'a', acctName: 'Gmail', fromName: 'Netto HR', fromEmail: 'hr@netto.dk', subject: 'Ny vagtplan uge 45', preview: 'Se planen', body: 'Hej Willads, her er planen.', at: new Date().toISOString(), needsReply: true });
    e.set('mail', 'm-a-2', { acct: 'a', acctName: 'Gmail', fromName: 'Netto HR', fromEmail: 'hr@netto.dk', subject: 'Julefrokost', preview: '', at: new Date().toISOString() });
    const hits = matchWatches(e, ['m-a-1', 'm-a-2']);
    expect(hits.map((h) => h.mail.id)).toEqual(['m-a-1']);
    expect((e.get('m-a-1') as any).watch).toBeTruthy();
    const found = runTool(e, 'search_mail', { query: 'vagtplan' }).result as any[];
    expect(found[0].id).toBe('m-a-1');
    expect((runTool(e, 'read_mail', { mail_id: 'm-a-1' }).result as any).text).toContain('her er planen');
    const d = runTool(e, 'draft_reply', { mail_id: 'm-a-1', body: 'Tak, det passer fint.\n\nWillads' });
    expect((e.get('m-a-1') as any).draft).toContain('passer fint');
    expect(d.action?.open).toEqual({ screen: 'inbox', id: 'm-a-1' });
    expect(contextFor(e)).toContain('Netto HR: Ny vagtplan uge 45');
  });
});
