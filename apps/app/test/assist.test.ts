import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { occurrences, dayOccurrences, repeatLabel, type CalEvent } from '../src/calendar.ts';
import { runTool, applyUndo, contextFor } from '../src/ai/tools.ts';
import { ask, saveAiSettings } from '../src/ai/agent.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
const week = (e: SyncEngine, monday: string) => {
  const from = new Date(monday + 'T00:00'); const to = new Date(from); to.setDate(to.getDate() + 7);
  return occurrences(e.list('event') as unknown as CalEvent[], from, to);
};
const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
afterEach(() => vi.unstubAllGlobals());

describe('arbejdstid som faste aftaler', () => {
  it('Netto 06–16 tirsdag–fredag, torsdag til 15', async () => {
    const e = await engine();
    runTool(e, 'create_event', { title: 'Arbejde · Netto', date: '2026-10-27', start_time: '06:00', end_time: '16:00', repeat_days: ['tir', 'ons', 'fre'], calendar: 'Arbejde' });
    runTool(e, 'create_event', { title: 'Arbejde · Netto', date: '2026-10-29', start_time: '06:00', end_time: '15:00', repeat_days: ['tor'], calendar: 'Arbejde' });
    const w = week(e, '2026-11-02'); // mandag
    expect(w.map((x) => [new Date(x.start).getDay(), hm(x.start), hm(x.end)])).toEqual([[2, '06:00', '16:00'], [3, '06:00', '16:00'], [4, '06:00', '15:00'], [5, '06:00', '16:00']]);
    expect(dayOccurrences(e.list('event') as any, new Date('2026-11-02T12:00'))).toHaveLength(0);
    // nothing before the first day
    expect(week(e, '2026-10-19')).toHaveLength(0);
    expect(repeatLabel({ days: [5, 2, 3] })).toBe('hver tirsdag, onsdag og fredag');
  });

  it('aflys én dag, og fortryd', async () => {
    const e = await engine();
    const { result } = runTool(e, 'create_event', { title: 'Arbejde', date: '2026-10-27', start_time: '06:00', end_time: '16:00', repeat_days: ['tir'] }) as any;
    const r = runTool(e, 'delete_event', { event_id: `${result.id}@2026-11-03`, only_date: '2026-11-03' });
    expect(week(e, '2026-11-02')).toHaveLength(0);
    expect(week(e, '2026-11-09')).toHaveLength(1);
    applyUndo(e, r.action!.undo!);
    expect(week(e, '2026-11-02')).toHaveLength(1);
  });

  it('afvisning af dårlige datoer', async () => {
    const e = await engine();
    expect(() => runTool(e, 'create_event', { title: 'x', date: 'i morgen', start_time: '06:00', end_time: '07:00' })).toThrow(/Ugyldig dato/);
  });
});

describe('noter, hukommelse og mål', () => {
  it('note: opret, tilføj, fortryd', async () => {
    const e = await engine();
    const c = runTool(e, 'create_note', { title: 'Ideer', body: 'Første tanke' }) as any;
    const id = c.result.id;
    const a = runTool(e, 'append_to_note', { note_id: id, text: '- Anden tanke' });
    expect(e.doc(id).getText('body').toString()).toBe('Første tanke\n- Anden tanke');
    applyUndo(e, a.action!.undo!);
    expect(e.doc(id).getText('body').toString()).toBe('Første tanke');
    applyUndo(e, c.action.undo);
    expect(e.get(id)).toBeNull();
  });

  it('husk, glem og fortryd', async () => {
    const e = await engine();
    const r = runTool(e, 'remember', { kind: 'Arbejde', statement: 'Arbejder i Netto' }) as any;
    expect(contextFor(e)).toContain('Arbejder i Netto');
    const f = runTool(e, 'forget', { id: r.result.id });
    expect(e.list('memory')).toHaveLength(0);
    applyUndo(e, f.action!.undo!);
    expect((e.get(r.result.id) as any).statement).toBe('Arbejder i Netto');
  });

  it('mål og fremskridt', async () => {
    const e = await engine();
    const g = runTool(e, 'create_goal', { title: 'Løb 300 km', kind: 'measure', target: 300, unit: 'km' }) as any;
    runTool(e, 'log_goal_progress', { goal_id: g.result.id, amount: 5.2 });
    expect(contextFor(e)).toMatch(/Løb 300 km.*5,2 af 300 km/);
    const m = runTool(e, 'create_goal', { title: 'App', kind: 'milestones', steps: ['Design', 'Build'] }) as any;
    runTool(e, 'log_goal_progress', { goal_id: m.result.id, step_done: 'design' });
    expect((e.get(m.result.id) as any).steps).toEqual([['Design', true], ['Build', false]]);
  });
});

describe('Assist-løkken', () => {
  it('Claude kalder værktøjer og svarer; nøglen sendes kun til Anthropic', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000' });
    const calls: { url: string; init: any }[] = [];
    const replies = [
      { content: [{ type: 'tool_use', id: 't1', name: 'remember', input: { kind: 'Arbejde', statement: 'Arbejder i Netto tirsdag–fredag' } },
        { type: 'tool_use', id: 't2', name: 'create_event', input: { title: 'Netto', date: '2026-10-27', start_time: '06:00', end_time: '16:00', repeat_days: ['tir', 'ons', 'fre'] } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Gemt og lagt i kalenderen.' }], stop_reason: 'end_turn' },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(replies.shift())); }));
    const t = await ask(e, [], 'Jeg arbejder i Netto 06–16 tirsdag til fredag');
    expect(t.reply).toBe('Gemt og lagt i kalenderen.');
    expect(t.actions.map((a) => a.label)).toEqual(['Husker: Arbejder i Netto tirsdag–fredag', 'I kalenderen: Netto, hver tirsdag, onsdag og fredag 06:00–16:00']);
    expect(calls.every((c) => c.url === 'https://api.anthropic.com/v1/messages')).toBe(true);
    const body = JSON.parse(calls[1].init.body);
    expect(body.messages.at(-1).content[0].type).toBe('tool_result');
    expect(body.system).toEqual(JSON.parse(calls[0].init.body).system); // same cached instructions every call
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    // today's context rides along in the newest question, and is not stored in the history
    expect(body.messages[0].content[0].text).toMatch(/^<kontekst>/);
    expect(JSON.stringify(t.messages)).not.toContain('<kontekst>');
    expect(t.model).toBe('claude-haiku-5-5');
    expect(t.messages).toHaveLength(4);
  });

  it('tænkning fra tidligere spørgsmål sendes ikke med igen', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000' });
    let sent: any;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Ok' }], stop_reason: 'end_turn' })); }));
    const history: any = [
      { role: 'user', content: [{ type: 'text', text: 'Hej' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '…', signature: 'sig' }, { type: 'text', text: 'Hej!' }] },
    ];
    await ask(e, history, 'Jeg vil sige op i morgen');
    expect(JSON.stringify(sent.messages)).not.toContain('thinking');
    expect(sent.messages[1].content).toEqual([{ type: 'text', text: 'Hej!', cache_control: { type: 'ephemeral' } }]);
  });

  it('falder tilbage til den lokale model uden internet', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000', fallbackLocal: true });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('anthropic')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ message: { content: '<think>hm</think>Hej! Hvad laver du til daglig?' } }));
    }));
    const t = await ask(e, [], 'Hej');
    expect(t.via).toBe('local');
    expect(t.reply).toBe('Hej! Hvad laver du til daglig?');
  });

  it('forkert nøgle giver en dansk fejl og ingen reserve', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-wrong-000000000000000' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })));
    await expect(ask(e, [], 'Hej')).rejects.toThrow(/API-nøglen blev afvist/);
  });
});

import { routeModel, costOf, recordUsage, spentThisMonth } from '../src/ai/usage.ts';
describe('modelvalg og forbrug', () => {
  it('vælger den billigste model, der kan klare opgaven', () => {
    const r = (t: string, o: any = {}) => routeModel(t, { mode: 'auto', ...o }).model;
    expect(r('Mads har betalt 100')).toBe('claude-haiku-5-5');
    expect(r('husk at jeg løber om tirsdagen')).toBe('claude-haiku-5-5');
    expect(r('ja')).toBe('claude-haiku-5-5');
    expect(r('Hvad har jeg i kalenderen på fredag, og hvem skal jeg møde?')).toBe('claude-haiku-5-5');
    expect(r('Hvorfor skylder Mads mig penge? Hvad er mit budget?')).toBe('claude-haiku-5-5'); // everyday words
    expect(r('Planlæg min uge med træning, arbejde og tid til SmartLink')).toBe('claude-sonnet-5-5');
    expect(r('x'.repeat(1600))).toBe('claude-sonnet-5-5');
    expect(['claude-haiku-5-5', 'claude-sonnet-5-5']).toContain(r('Lav en strategi og analysér hele året grundigt '.repeat(30))); // never Opus by itself
    expect(r('Planlæg min uge', { budgetUsd: 1, spentUsd: 1.2 })).toBe('claude-haiku-5-5');
    expect(routeModel('Planlæg', { mode: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5');
  });
  it('regner prisen ud efter Anthropics priser, også Haikus store prompts', async () => {
    expect(costOf('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6 })).toBe(12);
    expect(costOf('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 })).toBeCloseTo(0.1);
    expect(costOf('claude-haiku-5-5', { input_tokens: 50_000, output_tokens: 1000 })).toBeCloseTo(0.0055);
    expect(costOf('claude-haiku-5-5', { input_tokens: 150_000 })).toBeCloseTo(0.075);
    const e = await engine();
    recordUsage(e, 'claude-haiku-5-5', 'chat', { input_tokens: 2000, output_tokens: 200 });
    recordUsage(e, 'claude-haiku-5-5', 'chat', { input_tokens: 2000, output_tokens: 200 });
    expect(e.list('usage')).toHaveLength(1);
    expect((e.list('usage')[0] as any).calls).toBe(2);
    expect(spentThisMonth(e)).toBeCloseTo(0.0006);
  });
  it('Assist registrerer forbruget for hvert kald', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000' });
    let model = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { model = JSON.parse(init.body).model; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Noteret.' }], stop_reason: 'end_turn', usage: { input_tokens: 800, cache_read_input_tokens: 5000, output_tokens: 40 } })); }));
    const t = await ask(e, [], 'husk at jeg drikker kaffe sort');
    expect(model).toBe('claude-haiku-5-5');
    expect(t.usd).toBeCloseTo((800 * 0.1 + 5000 * 0.01 + 40 * 0.5) / 1e6);
    expect((e.list('usage')[0] as any).feature).toBe('chat');
  });
});
