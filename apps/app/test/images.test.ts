import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { ask, saveAiSettings, imageBlock, keepRecentImages, type Msg } from '../src/ai/agent.ts';

beforeAll(ready);
afterEach(() => vi.unstubAllGlobals());
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('billeder til Assist', () => {
  it('sender billedet til Claude før teksten, og et billede vælger mindst Sonnet', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'claude', claudeKey: 'sk-ant-test-0000000000000000', modelMode: 'auto' });
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Det er en invitation til fredag kl. 18.' }], stop_reason: 'end_turn' })); }));
    const t = await ask(e, [], 'Gem det', { images: [PNG, 'data:text/html;base64,PGI+'] });
    const user = sent[0].messages.at(-1).content;
    expect(user.filter((b: any) => b.type === 'image')).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }]);
    expect(user.at(-1).text).toBe('Gem det');
    expect(sent[0].model).toBe('claude-sonnet-5-5');
    expect(t.why).toBe('der er et billede med');
    expect(t.messages[0].content[0].type).toBe('image'); // kept for follow-up questions
  });

  it('kun de to nyeste billed-spørgsmål beholder billedet', () => {
    const img = imageBlock(PNG)!;
    const q = (n: number, pics = 1): Msg => ({ role: 'user', content: [...Array(pics).fill(img), { type: 'text', text: `q${n}` }] });
    const a: Msg = { role: 'assistant', content: [{ type: 'text', text: 'svar' }] };
    const out = keepRecentImages([q(1, 2), a, q(2), a, q(3), a, { role: 'user', content: [{ type: 'text', text: 'uden' }] }]);
    expect(out[0].content).toEqual([{ type: 'text', text: '[2 billeder vist tidligere i samtalen]' }, { type: 'text', text: 'q1' }]);
    expect(out[2].content[0].type).toBe('image');
    expect(out[4].content[0].type).toBe('image');
    expect(imageBlock('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
  });

  it('en lokal model får billedet med på den sidste tekst', async () => {
    const e = await engine();
    saveAiSettings(e, { provider: 'local', localUrl: 'http://127.0.0.1:11434', localModel: 'qwen2.5vl' });
    let body: any;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ message: { content: 'Ok' } })); }));
    await ask(e, [], 'Læs det her', { images: [PNG] });
    const users = body.messages.filter((m: any) => m.role === 'user');
    expect(users.at(-1)).toMatchObject({ content: 'Læs det her', images: ['iVBORw0KGgo='] });
    expect(users.slice(0, -1).every((m: any) => !m.images)).toBe(true);
  });
});
