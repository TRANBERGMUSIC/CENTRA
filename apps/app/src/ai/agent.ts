/**
 * Assist's brain: Claude (Anthropic API) with tools, or a local model through Ollama on this Mac.
 *
 * Privacy: the API key is stored inside the encrypted CENTRA store (never in localStorage or code),
 * and requests go straight from this app to Anthropic, or to a model running on this computer.
 * Nothing passes through any other server.
 */
import type { SyncEngine } from '@centra/sync';
import { TOOLS, runTool, contextFor, type Action } from './tools.ts';
import { recordUsage, routeModel, spentThisMonth, MODEL_NAMES, type Feature, type Usage } from './usage.ts';

export type AiSettings = {
  provider: 'claude' | 'local';
  claudeKey?: string;
  claudeModel: string;
  localUrl: string;
  localModel: string;
  fallbackLocal: boolean;
  /** Sort new mail into important / noise with the fast model. */
  triage: boolean;
  /** 'auto' picks Haiku / Sonnet / Opus per question; otherwise one fixed model id. */
  modelMode: string;
  /** Monthly Claude budget in DKK (0 = none). Over it, auto mode uses only Haiku. */
  budgetDkk: number;
  /** Kroner per US dollar, for showing prices. */
  usdDkk: number;
};
export const DEFAULT_AI: AiSettings = { provider: 'claude', claudeModel: 'claude-sonnet-5-5', localUrl: 'http://localhost:11434', localModel: 'qwen3:8b', fallbackLocal: true, triage: true, modelMode: 'auto', budgetDkk: 0, usdDkk: 6.9 };
export const CLAUDE_MODELS: [string, string][] = [['auto', 'Automatisk · Haiku, Sonnet til det svære'], ['claude-haiku-5-5', 'Haiku 5.5 · hurtigst og billigst'], ['claude-sonnet-5-5', 'Sonnet 5.5 · alsidig'], ['claude-opus-5-5', 'Opus 5.5 · klogest']];

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
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
export type Msg = { role: 'user' | 'assistant'; content: Block[] };

/**
 * The instructions never change, so Claude caches them (with the tools) and later calls pay about
 * a twentieth for that part. Today's date and your data go in a separate block in the newest
 * message instead, so they don't break the cache.
 */
const SYSTEM = `Du er Assist i CENTRA, Willads' personlige hovedkvarter for hverdagen (noter, kalender, mail, mål, udlæg, udgifter, kontakter). Du taler dansk: kort, varmt og direkte, uden fyld. Dato, klokkeslæt og brugerens data står i <kontekst> i den nyeste besked.

Sådan arbejder du:
- Når brugeren fortæller noget om sig selv, der stadig er sandt senere (rutiner, arbejdstider, personer, vaner, præferencer, steder), så gem det med remember. Ét faktum pr. kald.
- Faste skemaer (arbejde, træning, undervisning) lægger du også i kalenderen med create_event og repeat_days. Er tiderne forskellige på nogle dage, laver du en aftale pr. tidsrum. Eksempel: "Netto 06–16 tirsdag–fredag, men fri 15 om torsdagen" → én aftale tir/ons/fre 06:00–16:00 og én tor 06:00–15:00, plus remember.
- Diktat eller tanker, brugeren vil gemme, bliver til en note med create_note. Ryd op i tegnsætning og afsnit, men behold brugerens ord.
- Mål og fremskridt: create_goal og log_goal_progress.
- Personer: når brugeren nævner nogen med telefon, mail, sociale medier, eller fortæller hvem de er/hvad de laver, så gem eller opdatér dem med save_contact (noter tilføjes). Brug find_contact for at finde den rette person ("hvem kunne hjælpe med …").
- Udlæg: "jeg lagde X ud for …" → create_outlay med alle personer og varer (brug "mig" for brugeren, hvis de selv betaler en del). "Mads har betalt 100" → record_payment. "Jeg skylder Maria 150 for biografen" / "Mads betalte pizzaen" → create_outlay med paid_by. "Jeg har betalt Maria tilbage" → i_paid_back. "Hvem skylder mig?" / "Hvad skylder jeg?" → balances.
- Udgifter: faste betalinger og abonnementer → add_expense (interval month/year …). Spørg kort, hvis beløb eller interval mangler. list_expenses giver overblikket.
- Mail: find med search_mail, læs med read_mail, og lav svarudkast med draft_reply (de sendes aldrig automatisk; brugeren sender selv fra indbakken). "Hold øje med en mail …" → watch_mail med afsender og/eller ord fra emnet. Er der ingen mailkonti, så sig at de forbindes under Forbindelser.
- Gør det, brugeren beder om, med det samme og bekræft kort, hvad du har gjort. Alt kan fortrydes med én knap, så du behøver ikke spørge om lov. Spørg kun, hvis en nødvendig oplysning mangler (fx hvilken dag).
- Brug id'er fra konteksten herunder. Find aldrig på fakta om brugeren.
- Billeder (skærmbilleder, fotos, kvitteringer, invitationer, beskeder): læs dem grundigt, også småt tekst. Spørger brugeren om noget, så svar ud fra billedet. Viser billedet noget, der hører hjemme i CENTRA (en aftale, en person, en kvittering eller et udlæg, en opgave, en mail der skal svares på), så gør det relevante med dine tools og sig kort, hvad du gjorde. Sig ærligt, hvis noget ikke kan læses.
- Når brugeren er ny og ikke ved, hvor de skal starte, så stil ét spørgsmål ad gangen om deres hverdag: arbejde, faste aftaler, træning, mål, vigtige personer.`;

function contextBlock(e: SyncEngine) {
  const now = new Date();
  const when = now.toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `<kontekst>\nNu: ${when} (dansk tid, ${now.toISOString().slice(0, 10)}).\n\n${contextFor(e)}\n</kontekst>`;
}

/* ---------------------------------------------------------------- providers */
type CallOpts = { tools?: boolean; model?: string; maxTokens?: number; e?: SyncEngine; feature?: Feature; cache?: boolean };
type CallResult = { content: Block[]; stop: string; usage?: Usage; model?: string; usd?: number };

async function claude(s: AiSettings, sys: string, messages: Msg[], signal?: AbortSignal, o: CallOpts = {}): Promise<CallResult> {
  const model = o.model ?? (s.modelMode && s.modelMode !== 'auto' ? s.modelMode : 'claude-sonnet-5-5');
  const tools = o.tools === false ? undefined : TOOLS.map((t, i) => (i === TOOLS.length - 1 && o.cache ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const system = o.cache ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }] : sys;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': s.claudeKey!, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: o.maxTokens ?? 2048, system, ...(tools ? { tools } : {}), messages }),
  });
  if (!r.ok) {
    let msg = `Claude svarede ${r.status}`;
    try { const j = await r.json(); msg = j?.error?.message ?? msg; } catch { /* keep status */ }
    if (r.status === 400 && /thinking|signature/i.test(msg)) msg = 'Samtalen kunne ikke fortsættes. Start en ny samtale, og prøv igen.';
    throw new AiError(r.status === 401 ? 'API-nøglen blev afvist. Tjek den under Indstillinger → Assist.' : r.status === 429 ? 'Claude har for travlt eller kvoten er brugt. Prøv igen om lidt.' : msg, r.status);
  }
  const j = await r.json();
  const usd = o.e && j.usage ? recordUsage(o.e, model, o.feature ?? 'andet', j.usage) : undefined;
  return { content: j.content as Block[], stop: j.stop_reason, usage: j.usage, model, usd };
}

/** Marks the end of a message as a cache point without touching the stored conversation. */
function cachePoint(m: Msg): Msg {
  const c = [...m.content];
  const i = c.length - 1;
  if (i >= 0 && !c[i].type.includes('thinking')) c[i] = { ...c[i], cache_control: { type: 'ephemeral' } } as unknown as Block;
  return { ...m, content: c };
}

async function ollama(s: AiSettings, sys: string, messages: Msg[], signal?: AbortSignal): Promise<CallResult> {
  const out: any[] = [{ role: 'system', content: sys }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n'),
        tool_calls: m.content.filter((b) => b.type === 'tool_use').map((b: any) => ({ function: { name: b.name, arguments: b.input } })) });
    } else {
      const images = m.content.filter((b) => b.type === 'image').map((b: any) => b.source.data);
      const lastText = m.content.map((b) => b.type).lastIndexOf('text');
      for (const [i, b] of m.content.entries()) {
        if (b.type === 'text') out.push({ role: 'user', content: b.text, ...(images.length && i === lastText ? { images } : {}) });
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
export type Turn = { messages: Msg[]; reply: string; actions: Action[]; via: 'claude' | 'local'; model?: string; why?: string; usd?: number };

/**
 * Sends the conversation, runs the tools Assist asks for, and repeats until it answers.
 * `history` is the stored conversation; the returned `messages` replace it.
 */
export async function ask(e: SyncEngine, history: Msg[], text: string, opts: { signal?: AbortSignal; onAction?: (a: Action) => void; images?: string[]; model?: string } = {}): Promise<Turn> {
  const s = aiSettings(e);
  let via: 'claude' | 'local' = s.provider === 'claude' && s.claudeKey ? 'claude' : 'local';
  const pics = (opts.images ?? []).map(imageBlock).filter((b): b is Block => !!b);
  // One model for the whole question (thinking is tied to the model that made it). "Svar grundigere" asks for one.
  const route = opts.model ? { model: opts.model, why: 'du bad om et grundigere svar' }
    : routeModel(text, { mode: s.modelMode || 'auto', budgetUsd: s.budgetDkk ? s.budgetDkk / (s.usdDkk || 6.9) : 0, spentUsd: spentThisMonth(e), turns: history.length });
  let usd = 0;
  const call = async (sys: string, msgs: Msg[]) => {
    if (via === 'claude') {
      try { const r = await claude(s, sys, msgs, opts.signal, { model: route.model, e, feature: 'chat', cache: true }); usd += r.usd ?? 0; return r; } catch (err) {
        // No internet or Claude down: carry on with the local model if that's allowed.
        if (s.fallbackLocal && !(err instanceof AiError && (err.status === 401 || err.status === 400)) && !opts.signal?.aborted) { via = 'local'; return ollama(s, sys, msgs, opts.signal); }
        throw err;
      }
    }
    return ollama(s, sys, msgs, opts.signal);
  };

  // Claude's thinking is signed against the exact system prompt it was made with. The prompt carries
  // the time and a fresh picture of your data, so it is built once per question (stable through the
  // tool rounds) and thinking from earlier questions is left out of the history.
  const ctx = contextBlock(e);
  const messages: Msg[] = [...trim(history).map(withoutThinking).filter((m) => m.content.length), { role: 'user', content: [...pics, { type: 'text', text }] }];
  const fresh = messages.length - 1; // the question just asked: it carries today's context when sent
  const actions: Action[] = [];
  const outgoing = () => messages.map((m, i) => {
    let x = i === fresh ? { ...m, content: [{ type: 'text', text: ctx } as Block, ...m.content] } : m;
    // Cache points: end of the earlier conversation, and the newest message (tool rounds reuse it).
    if (i === fresh - 1 || i === messages.length - 1) x = cachePoint(x);
    return x;
  });
  for (let round = 0; round < 8; round++) {
    const res = await call(SYSTEM, via === 'claude' ? outgoing() : messages.map((m, i) => (i === fresh ? { ...m, content: [{ type: 'text', text: ctx } as Block, ...m.content] } : m)));
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
  return { messages: keepRecentImages(messages.slice(-60)), reply: reply || (actions.length ? 'Klaret.' : ''), actions, via, model: via === 'claude' ? route.model : s.localModel, why: route.why, usd };
}

/** data:image/…;base64,… → an image block Claude (and a local model that can see) understands. */
export function imageBlock(url: string): Block | null {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s.exec(url);
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

/**
 * Pictures stay in the conversation for the two newest questions that had one, so you can ask
 * follow-ups ("hvad stod der nederst?"). Older ones become a short note: they would otherwise be paid
 * for again in every message and make the encrypted store heavy.
 */
export function keepRecentImages(msgs: Msg[], keep = 2): Msg[] {
  let seen = 0;
  const out = [...msgs];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== 'user' || !m.content.some((b) => b.type === 'image')) continue;
    if (++seen <= keep) continue;
    const n = m.content.filter((b) => b.type === 'image').length;
    out[i] = { ...m, content: [{ type: 'text', text: `[${n === 1 ? 'Et billede' : `${n} billeder`} vist tidligere i samtalen]` }, ...m.content.filter((b) => b.type !== 'image')] };
  }
  return out;
}

const withoutThinking = (m: Msg): Msg => (m.role === 'assistant' ? { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m);

/** What tools answered in earlier questions (a whole mail, 80 contacts) is shortened: it was used then. */
const OLD_RESULT = 500;
export const shortenOld = (m: Msg): Msg => (m.role === 'user' && m.content.some((b) => b.type === 'tool_result' && b.content.length > OLD_RESULT)
  ? { ...m, content: m.content.map((b) => (b.type === 'tool_result' && b.content.length > OLD_RESULT ? { ...b, content: b.content.slice(0, OLD_RESULT) + ' … (forkortet)' } : b)) }
  : m);

/**
 * The conversation sent along: the last ~24 messages, cut at a plain user message so tool calls and
 * results stay paired. Every message is paid for again with each new question, so less is cheaper.
 */
function trim(h: Msg[]): Msg[] {
  const MAX = 24;
  let out = h;
  if (h.length > MAX) {
    let i = h.length - MAX;
    while (i < h.length && !(h[i].role === 'user' && h[i].content.some((b) => b.type === 'text'))) i++;
    out = h.slice(i);
  }
  return out.map(shortenOld);
}

/** A quick round-trip to check the key or the local model from Settings. */
export async function testAi(s: AiSettings): Promise<string> {
  const r = s.provider === 'claude'
    ? await claude(s, 'Svar kun med ordet: klar', [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }], undefined, { model: 'claude-haiku-5-5', tools: false, maxTokens: 50 })
    : await ollama(s, 'Svar kun med ordet: klar', [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }]);
  return r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join(' ').trim() || 'klar';
}

/**
 * One question that must come back as JSON (reading a receipt, sorting mail). `images` are data
 * URLs; Claude reads them directly, a local model only if it can see (e.g. qwen2.5vl, llava).
 */
export async function askJson<T>(e: SyncEngine, sys: string, text: string, opts: { images?: string[]; fast?: boolean; maxTokens?: number; feature?: Feature } = {}): Promise<T> {
  const s = aiSettings(e);
  const images = opts.images ?? [];
  let raw = '';
  if (s.provider === 'claude' && s.claudeKey) {
    const content: any[] = images.map((d) => { const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(d)!; return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }; });
    content.push({ type: 'text', text });
    const r = await claude(s, sys, [{ role: 'user', content }], undefined, { tools: false, model: opts.fast ? 'claude-haiku-5-5' : 'claude-sonnet-5-5', maxTokens: opts.maxTokens ?? 4096, e, feature: opts.feature ?? 'andet' });
    raw = r.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('');
  } else {
    let r: Response;
    try {
      r = await fetch(`${s.localUrl.replace(/\/$/, '')}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: s.localModel, stream: false, format: 'json', messages: [{ role: 'system', content: sys }, { role: 'user', content: text, images: images.map((d) => d.split(',')[1]) }] }) });
    } catch { throw new AiError('Assist er ikke forbundet. Indsæt en Claude-nøgle under Indstillinger, eller start Ollama.', 0); }
    if (!r.ok) throw new AiError(`Lokal model svarede ${r.status}`, r.status);
    raw = String((await r.json()).message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  }
  const json = raw.slice(raw.search(/[[{]/), Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']')) + 1);
  try { return JSON.parse(json) as T; } catch { throw new AiError('Svaret kunne ikke læses. Prøv igen.', 0); }
}

export { MODEL_NAMES };
