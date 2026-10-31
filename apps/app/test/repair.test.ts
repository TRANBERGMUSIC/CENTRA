import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { ask, repair, saveAiSettings, askJson, type Msg } from '../src/ai/agent.ts';
import { usageLog } from '../src/ai/usage.ts';

beforeAll(ready);
afterEach(() => vi.unstubAllGlobals());
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
const t = (text: string) => ({ type: 'text', text }) as const;
const use = (id: string) => ({ type: 'tool_use', id, name: 'create_event', input: {} }) as const;
const res = (id: string) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' }) as const;

/** Every tool_use is answered in the very next message, and no answer is without its call. */
function valid(ms: Msg[]) {
  if (ms[0]?.role !== 'user') return false;
  for (let i = 0; i < ms.length; i++) {
    if (i && ms[i].role === ms[i - 1].role) return false;
    const ids = ms[i].content.filter((b) => b.type === 'tool_use').map((b: any) => b.id);
    const next = ms[i + 1]?.content.filter((b) => b.type === 'tool_result').map((b: any) => b.tool_use_id) ?? [];
    if (ids.some((id) => !next.includes(id))) return false;
    const answers = ms[i].content.filter((b) => b.type === 'tool_result').map((b: any) => b.tool_use_id);
    const asked = ms[i - 1]?.content.filter((b) => b.type === 'tool_use').map((b: any) => b.id) ?? [];
    if (answers.some((id) => !asked.includes(id))) return false;
  }
  return true;
}

describe('ødelagte samtaler bliver repareret', () => {
  it('et værktøjskald uden svar (afbrudt) får et svar, så samtalen kan fortsætte', () => {
    const broken: Msg[] = [{ role: 'user', content: [t('Læg tandlæge i kalenderen')] }, { role: 'assistant', content: [t('Gør det'), use('a')] }, { role: 'user', content: [t('Har du lagt det i kalenderen?')] }];
    const r = repair(broken);
    expect(valid(r)).toBe(true);
    expect(r[2].content.map((b) => b.type)).toEqual(['tool_result', 'text']);
  });
  it('svar uden kald, to beskeder i træk og en start midt i værktøjer', () => {
    const broken: Msg[] = [
      { role: 'user', content: [res('x')] }, { role: 'assistant', content: [t('svar')] },
      { role: 'user', content: [t('hej')] }, { role: 'user', content: [t('igen')] },
      { role: 'assistant', content: [use('b'), use('c')] }, { role: 'user', content: [res('c'), res('zz')] },
      { role: 'assistant', content: [t('klar')] }, { role: 'assistant', content: [t('også')] },
    ];
    const r = repair(broken);
    expect(valid(r)).toBe(true);
    expect(r[0].content).toEqual([t('hej'), t('igen')]);
    expect(r.at(-1)!.content).toEqual([t('klar'), t('også')]);
  });
  it('Assist svarer igen i en samtale, der var gået i stykker, og bruger Haiku', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000', modelMode: 'auto' });
    let body: any;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Ja, den ligger der.' }], stop_reason: 'end_turn', usage: { input_tokens: 900, cache_read_input_tokens: 7000, output_tokens: 30 } })); }));
    const history: Msg[] = [{ role: 'user', content: [t('Læg tandlæge torsdag kl. 9 i kalenderen, jeg skal tjekke ind når det er')] }, { role: 'assistant', content: [use('toolu_01')] }];
    const turn = await ask(e, history, 'Har du lagt det i kalenderen?');
    expect(valid(body.messages)).toBe(true);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(turn.reply).toBe('Ja, den ligger der.');
    expect(valid(turn.messages)).toBe(true);
    const log = usageLog(e);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ feature: 'chat', model: 'claude-haiku-5-5', label: 'Har du lagt det i kalenderen?', calls: 1, input: 900, cacheRead: 7000, output: 30 });
    expect(log[0].usd * 6.9).toBeLessThan(0.01); // under 1 øre
  });
  it('et svar afbrudt midt i et værktøjskald køres ikke, men samtalen fortsætter', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000' });
    const replies = [
      { content: [{ type: 'tool_use', id: 't1', name: 'create_event', input: { title: 'Tand' } }], stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: 4096 } },
      { content: [{ type: 'text', text: 'Prøver igen kort.' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(replies.shift()))));
    const turn = await ask(e, [], 'Læg tandlæge i kalenderen');
    expect(e.list('event')).toHaveLength(0);
    expect(valid(turn.messages)).toBe(true);
    expect(usageLog(e)[0].calls).toBe(2);
  });
  it('kvitteringer og andet JSON bruger Haiku og kommer i loggen', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000' });
    let model = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { model = JSON.parse(init.body).model; return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 50 } })); }));
    await askJson(e, 'sys', 'Læs denne kvittering.', { feature: 'kvittering', label: 'Læste en kvittering' });
    expect(model).toBe('claude-haiku-5-5');
    expect(usageLog(e)[0]).toMatchObject({ feature: 'kvittering', label: 'Læste en kvittering', model: 'claude-haiku-5-5' });
  });
});
