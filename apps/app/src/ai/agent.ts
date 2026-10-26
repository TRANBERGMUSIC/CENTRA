/**
 * Assist's brain: Claude (Anthropic API) with tools, or a local model through Ollama on this Mac.
 *
 * Privacy: the API key is stored inside the encrypted CENTRA store (never in localStorage or code),
 * and requests go straight from this app to Anthropic, or to a model running on this computer.
 * Nothing passes through any other server.
 */
import type { SyncEngine } from '@centra/sync';
import { TOOLS, runTool, contextFor, type Action } from './tools.ts';

export type AiSettings = {
  provider: 'claude' | 'local';
  claudeKey?: string;
  claudeModel: string;
  localUrl: string;
  localModel: string;
  fallbackLocal: boolean;
};
export const DEFAULT_AI: AiSettings = { provider: 'claude', claudeModel: 'claude-sonnet-5-5', localUrl: 'http://localhost:11434', localModel: 'qwen3:8b', fallbackLocal: true };
export const CLAUDE_MODELS: [string, string][] = [['claude-sonnet-5-5', 'Sonnet 5.5 · anbefalet'], ['claude-haiku-5-5', 'Haiku 5.5 · hurtigst'], ['claude-opus-5-5', 'Opus 5.5 · klogest']];

export function aiSettings(e: SyncEngine): AiSettings {
  const r = (e.get('setting-ai') ?? {}) as Partial<AiSettings>;
  return { ...DEFAULT_AI, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== undefined && k !== 'id' && k !== 'type')) } as AiSettings;
}
export const saveAiSettings = (e: SyncEngine, s: Partial<AiSettings>) => e.set('setting', 'setting-ai', s);
export const aiReady = (s: AiSettings) => (s.provider === 'claude' ? !!s.claudeKey : true);

/* ---------------------------------------------------------------- message format (Anthropic's) */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Msg = { role: 'user' | 'assistant'; content: Block[] };

function system(e: SyncEngine) {
  const now = new Date();
  const when = now.toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `Du er Assist i CENTRA, Willads' personlige hovedkvarter for hverdagen (noter, kalender, mail, mål). Du taler dansk: kort, varmt og direkte, uden fyld.

Nu: ${when} (dansk tid, ${now.toISOString().slice(0, 10)}).

Sådan arbejder du:
- Når brugeren fortæller noget om sig selv, der stadig er sandt senere (rutiner, arbejdstider, personer, vaner, præferencer, steder), så gem det med remember. Ét faktum pr. kald.
- Faste skemaer (arbejde, træning, undervisning) lægger du også i kalenderen med create_event og repeat_days. Er tiderne forskellige på nogle dage, laver du en aftale pr. tidsrum. Eksempel: "Netto 06–16 tirsdag–fredag, men fri 15 om torsdagen" → én aftale tir/ons/fre 06:00–16:00 og én tor 06:00–15:00, plus remember.
- Diktat eller tanker, brugeren vil gemme, bliver til en note med create_note. Ryd op i tegnsætning og afsnit, men behold brugerens ord.
- Mål og fremskridt: create_goal og log_goal_progress.
- "Hold øje med en mail …" → watch_mail. Mailkonti er ikke forbundet endnu, så sig at overvågningen starter, når de er.
- Gør det, brugeren beder om, med det samme og bekræft kort, hvad du har gjort. Alt kan fortrydes med én knap, så du behøver ikke spørge om lov. Spørg kun, hvis en nødvendig oplysning mangler (fx hvilken dag).
- Brug id'er fra konteksten herunder. Find aldrig på fakta om brugeren.
- Når brugeren er ny og ikke ved, hvor de skal starte, så stil ét spørgsmål ad gangen om deres hverdag: arbejde, faste aftaler, træning, mål, vigtige personer.

${contextFor(e)}`;
}

/* ---------------------------------------------------------------- providers */
async function claude(s: AiSettings, sys: string, messages: Msg[], signal?: AbortSignal): Promise<{ content: Block[]; stop: string }> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': s.claudeKey!, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: s.claudeModel, max_tokens: 2048, system: sys, tools: TOOLS, messages }),
  });
  if (!r.ok) {
    let msg = `Claude svarede ${r.status}`;
    try { const j = await r.json(); msg = j?.error?.message ?? msg; } catch { /* keep status */ }
    throw new AiError(r.status === 401 ? 'API-nøglen blev afvist. Tjek den under Indstillinger → Assist.' : r.status === 429 ? 'Claude har for travlt eller kvoten er brugt. Prøv igen om lidt.' : msg, r.status);
  }
  const j = await r.json();
  return { content: j.content as Block[], stop: j.stop_reason };
}

async function ollama(s: AiSettings, sys: string, messages: Msg[], signal?: AbortSignal): Promise<{ content: Block[]; stop: string }> {
  const out: any[] = [{ role: 'system', content: sys }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n'),
        tool_calls: m.content.filter((b) => b.type === 'tool_use').map((b: any) => ({ function: { name: b.name, arguments: b.input } })) });
    } else {
      for (const b of m.content) {
        if (b.type === 'text') out.push({ role: 'user', content: b.text });
        if (b.type === 'tool_result') out.push({ role: 'tool', content: b.content });
      }
    }
  }
  let r: Response;
  try {
    r = await fetch(`${s.localUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: s.localModel, stream: false, messages: out, tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
    });
  } catch {
    throw new AiError('Den lokale model svarer ikke. Er Ollama startet på denne Mac?', 0);
  }
  if (!r.ok) throw new AiError(r.status === 404 ? `Modellen "${s.localModel}" findes ikke lokalt. Hent den med: ollama pull ${s.localModel}` : `Lokal model svarede ${r.status}`, r.status);
  const j = await r.json();
  const content: Block[] = [];
  const text = String(j.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (text) content.push({ type: 'text', text });
  for (const c of j.message?.tool_calls ?? []) {
    let input = c.function?.arguments ?? {};
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
    content.push({ type: 'tool_use', id: 'l' + Math.random().toString(36).slice(2, 10), name: c.function?.name, input });
  }
  return { content, stop: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
}

export class AiError extends Error { constructor(m: string, public status: number) { super(m); } }

/* ---------------------------------------------------------------- the loop */
export type Turn = { messages: Msg[]; reply: string; actions: Action[]; via: 'claude' | 'local' };

/**
 * Sends the conversation, runs the tools Assist asks for, and repeats until it answers.
 * `history` is the stored conversation; the returned `messages` replace it.
 */
export async function ask(e: SyncEngine, history: Msg[], text: string, opts: { signal?: AbortSignal; onAction?: (a: Action) => void } = {}): Promise<Turn> {
  const s = aiSettings(e);
  let via: 'claude' | 'local' = s.provider === 'claude' && s.claudeKey ? 'claude' : 'local';
  const call = async (sys: string, msgs: Msg[]) => {
    if (via === 'claude') {
      try { return await claude(s, sys, msgs, opts.signal); } catch (err) {
        // No internet or Claude down: carry on with the local model if that's allowed.
        if (s.fallbackLocal && !(err instanceof AiError && (err.status === 401 || err.status === 400)) && !opts.signal?.aborted) { via = 'local'; return ollama(s, sys, msgs, opts.signal); }
        throw err;
      }
    }
    return ollama(s, sys, msgs, opts.signal);
  };

  const messages: Msg[] = [...trim(history), { role: 'user', content: [{ type: 'text', text }] }];
  const actions: Action[] = [];
  for (let round = 0; round < 8; round++) {
    const res = await call(system(e), messages);
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (res.stop !== 'tool_use' || !uses.length) break;
    const results: Block[] = uses.map((u) => {
      try {
        const r = runTool(e, u.name, u.input ?? {});
        if (r.action) { actions.push(r.action); opts.onAction?.(r.action); }
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.result) };
      } catch (err) {
        return { type: 'tool_result', tool_use_id: u.id, content: String((err as Error).message), is_error: true };
      }
    });
    messages.push({ role: 'user', content: results });
  }
  const last = messages[messages.length - 1];
  const reply = last.role === 'assistant' ? last.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim() : '';
  return { messages, reply: reply || (actions.length ? 'Klaret.' : ''), actions, via };
}

/** Keeps the last ~40 messages, cut at a plain user message so tool calls and results stay paired. */
function trim(h: Msg[]): Msg[] {
  if (h.length <= 40) return h;
  let i = h.length - 40;
  while (i < h.length && !(h[i].role === 'user' && h[i].content.some((b) => b.type === 'text'))) i++;
  return h.slice(i);
}

/** A quick round-trip to check the key or the local model from Settings. */
export async function testAi(s: AiSettings): Promise<string> {
  const r = s.provider === 'claude'
    ? await claude(s, 'Svar kun med ordet: klar', [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }])
    : await ollama(s, 'Svar kun med ordet: klar', [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }]);
  return r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join(' ').trim() || 'klar';
}
