/**
 * Assist's brain: Claude (Anthropic API) with tools, or a local model through Ollama on this Mac.
 *
 * Privacy: the API key is stored inside the encrypted CENTRA store (never in localStorage or code),
 * and requests go straight from this app to Anthropic, or to a model running on this computer.
 * Nothing passes through any other server.
 */
import type { SyncEngine } from '@centra/sync';
import { TOOLS, runTool, contextFor, setAttachments, type Action } from './tools.ts';
import { fetchedHtml } from '../mailText.ts';
import { recordUsage, routeModel, spentThisMonth, logUsage, addTokens, MODEL_NAMES, type Feature, type Usage } from './usage.ts';

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
export const CLAUDE_MODELS: [string, string][] = [['auto', 'Automatisk · altid den billigste (Haiku)'], ['claude-haiku-5-5', 'Haiku 5.5 · hurtigst og billigst'], ['claude-sonnet-5-5', 'Sonnet 5.5 · alsidig'], ['claude-opus-5-5', 'Opus 5.5 · klogest']];

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
  | { type: 'tool_result'; tool_use_id: string; content: string | Block[]; is_error?: boolean }
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
- Huskeliste: "husk mig på …", "mind mig om …", "jeg skal huske at …" → add_reminder med kort tekst (hvad der skal gøres, uden tidspunktet) og dato/klokkeslæt, hvis det er nævnt ("kl 12 i dag", "i morgen", "om en time" regnes om ud fra Nu i konteksten). Så får brugeren en notifikation på tidspunktet. Siger brugeren, at noget er gjort, så kryds det af med complete_reminder. Kalenderen er til aftaler; huskelisten er til ting, der skal gøres.
- Diktat eller tanker, brugeren vil gemme, bliver til en note med create_note. Ryd op i tegnsætning og afsnit, men behold brugerens ord.
- Notetekst er Markdown og vises formateret: "- [ ] " giver en tjekliste med afkrydsningsbokse (brug den til indkøbslister, pakkelister og to-dos; "- [x] " er afkrydset), "- " punkter, "1. " nummereret, "# " overskrift, **fed**, *kursiv*, ++understreget++, ~~gennemstreget~~.
- Noter: læg dem i en passende mappe (se Notemapper i konteksten; undermapper med "/"), og hold orden med organize_notes (lav mapper, flyt noter, tags, fastgør), når brugeren beder om det eller når noter tydeligt hører sammen.
- Mail-mapper: brugeren kan bede dig om at sortere indbakken. Lav mapper med create_mail_folder (med regler for afsender/emne/ord og en beskrivelse, så nye mails sorteres af sig selv, når de kommer), flyt eksisterende mails med search_mail + move_mails, og ret mapper med update_mail_folder.
- Mål: når brugeren fortæller om et mål, så sæt det op med create_goal og vælg den rigtige slags: noget der skal gøres én gang (once), et projekt med trin (milestones), noget der skal gøres et antal gange i en periode (count, fx "løbe 5 km 10 gange i år"), et tal der skal nås (measure) eller en ugentlig vane (habit). Find selv på et konkret næste skridt (next), og spørg kun, hvis noget afgørende mangler. Hold orden: fortæller brugeren, at de har gjort noget, så log det på det rigtige mål med log_goal_progress; ændrer de mening eller er færdige, så brug update_goal. Lav ikke dubletter.
- Personer: når brugeren nævner nogen med telefon, mail, sociale medier, eller fortæller hvem de er/hvad de laver, så gem eller opdatér dem med save_contact (noter tilføjes). Brug find_contact for at finde den rette person ("hvem kunne hjælpe med …").
- Udlæg: "jeg lagde X ud for …" → create_outlay med alle personer og varer (brug "mig" for brugeren, hvis de selv betaler en del). "Mads har betalt 100" → record_payment. "Jeg skylder Maria 150 for biografen" / "Mads betalte pizzaen" → create_outlay med paid_by. "Jeg har betalt Maria tilbage" → i_paid_back. "Hvem skylder mig?" / "Hvad skylder jeg?" → balances.
- Penge frem og tilbage med én person ("pantede flasker med Jonas for 440, købte mad for 315, han gav mig snus til 64") → create_tally. Sig resultatet i én sætning (hvem skylder hvem hvor meget), og nævn kort, hvad du antog (fx at brugeren fik pantpengene), så det kan rettes.
- Udgifter: faste betalinger og abonnementer → add_expense (interval month/year …). Spørg kort, hvis beløb eller interval mangler. list_expenses giver overblikket.
- Mail: find med search_mail (giver kun et kort uddrag), og læs ALTID mailen fuldt ud med read_mail, før du svarer på detaljer eller lægger noget i kalenderen ud fra den (tider, varighed, adresser, priser, bookingnumre, links). read_mail giver hele mailen; flere på én gang med mail_ids. Står noget kun som starten af et tidligere værktøjssvar, så læs mailen igen i stedet for at gætte eller sige, at den er forkortet. Svarudkast laves med draft_reply efter my_writing_style (de sendes aldrig automatisk; brugeren sender selv fra indbakken). "Hold øje med en mail …" → watch_mail med afsender og/eller ord fra emnet. Er der ingen mailkonti, så sig at de forbindes under Forbindelser.
- Du kan oprette, ændre og slette ALT i CENTRA: noter, aftaler, huskelisten, mål, kontakter, udlæg, regnestykker, betalinger, faste udgifter, hukommelse, billeder, mails, mapper, kalendertyper og forslag. Har du ikke et særligt værktøj til det, så brug de generelle: find_items (finder hvad som helst og giver id), get_item (alle detaljer), update_item (ret felter) og delete_items (slet en eller flere). Sig aldrig, at du ikke kan slette eller ændre noget; find det og gør det.
- Gør det, brugeren beder om, med det samme og bekræft kort, hvad du har gjort. Alt kan fortrydes med én knap, så du behøver ikke spørge om lov, heller ikke før du sletter. Spørg kun, hvis en nødvendig oplysning mangler, hvis det er uklart hvad der menes (fx flere regnestykker med samme person), eller før du sletter mere end 10 ting på én gang.
- Brug id'er fra konteksten herunder. Find aldrig på fakta om brugeren.
- Gemte billeder: brugeren gemmer billeder i CENTRA (Billeder) for at finde og bruge dem igen. "Find trøjen jeg tog billede af i forgårs" → search_photos med søgeord og datoer (regn "i går", "i forgårs", "i sidste uge" om til datoer), og se på de bedste med look_at_photos, før du svarer. "Gem informationerne fra billedet i går" → find det, læs det med look_at_photos, og lav fx en note eller aftale. Sender brugeren et billede og beder dig gemme det ("gem det her", "husk denne trøje"), så brug save_attached_photos med en god titel, beskrivelse, tags og al tekst fra billedet.
- Billeder (skærmbilleder, fotos, kvitteringer, invitationer, beskeder): læs dem grundigt, også småt tekst. Spørger brugeren om noget, så svar ud fra billedet. Viser billedet noget, der hører hjemme i CENTRA (en aftale, en person, en kvittering eller et udlæg, en opgave, en mail der skal svares på), så gør det relevante med dine tools og sig kort, hvad du gjorde. Sig ærligt, hvis noget ikke kan læses.
- Bliv klogere på brugeren: følg altid "Sådan vil brugeren have dine svar" i konteksten. Når brugeren retter dig eller siger, hvordan de vil have svar (kortere, uden lister, mere direkte, et andet sprog …), så gem det med remember (kind "Svarstil"). Siger de noget om, hvordan de selv skriver, så kind "Skrivestil".
- Skriv svar med enkel markdown: **fed** til det vigtigste, punktlister med "- ", links som [tekst](adresse). Ingen overskrifter i korte svar.
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
        if (b.type === 'tool_result') out.push({ role: 'tool', content: resultText(b.content) });
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
  let usd = 0, calls = 0, used: Usage = {};
  const call = async (sys: string, msgs: Msg[]) => {
    if (via === 'claude') {
      try { const r = await claude(s, sys, msgs, opts.signal, { model: route.model, e, feature: 'chat', cache: true, maxTokens: 4096 }); usd += r.usd ?? 0; calls++; used = addTokens(used, r.usage); return r; } catch (err) {
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
  // Repaired together with the new question (an unanswered tool call from last time is answered in
  // the same message, before the question).
  setAttachments(opts.images ?? []);
  const messages: Msg[] = repair([...trim(history).map(withoutThinking).filter((m) => m.content.length), { role: 'user', content: [...pics, { type: 'text', text }] }]);
  const fresh = messages.length - 1; // the question just asked: it carries today's context when sent
  // Today's context goes after any tool answers in that message (Claude wants those first).
  const withCtx = (m: Msg): Msg => { const n = m.content.filter((b) => b.type === 'tool_result').length; return { ...m, content: [...m.content.slice(0, n), { type: 'text', text: ctx } as Block, ...m.content.slice(n)] }; };
  const actions: Action[] = [];
  const outgoing = () => messages.map((m, i) => {
    let x = i === fresh ? withCtx(m) : m;
    // Cache points: end of the earlier conversation, and the newest message (tool rounds reuse it).
    if (i === fresh - 1 || i === messages.length - 1) x = cachePoint(x);
    return x;
  });
  for (let round = 0; round < 8; round++) {
    const res = await call(SYSTEM, via === 'claude' ? outgoing() : messages.map((m, i) => (i === fresh ? withCtx(m) : m)));
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!uses.length) break;
    // Cut off mid-way (too long an answer): the tool calls may be incomplete, so they are not run, but
    // each gets an answer, or the conversation can't continue.
    if (res.stop !== 'tool_use') { messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'Ikke udført: svaret blev afbrudt. Prøv igen kortere.', is_error: true }) as Block) }); continue; }
    await prepareTools(e, uses);
    const results: Block[] = uses.map((u) => {
      try {
        const r = runTool(e, u.name, u.input ?? {});
        if (r.action) { actions.push(r.action); opts.onAction?.(r.action); }
        // A tool can show Claude pictures too (saved photos): text first, then the images.
        const pics = (r.images ?? []).map(imageBlock).filter((b): b is Block => !!b);
        return { type: 'tool_result', tool_use_id: u.id, content: pics.length ? [{ type: 'text', text: JSON.stringify(r.result) } as Block, ...pics] : JSON.stringify(r.result) };
      } catch (err) {
        return { type: 'tool_result', tool_use_id: u.id, content: String((err as Error).message), is_error: true };
      }
    });
    messages.push({ role: 'user', content: results });
  }
  const last = messages[messages.length - 1];
  const reply = last.role === 'assistant' ? last.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim() : '';
  if (calls) logUsage(e, { feature: 'chat', model: route.model, label: text || 'Billede', detail: actions.map((a) => a.label).join(' · '), calls, usage: used, usd });
  return { messages: keepRecentImages(repair(trim(messages, 60))), reply: reply || (actions.length ? 'Klaret.' : ''), actions, via, model: via === 'claude' ? route.model : s.localModel, why: route.why, usd };
}

/** Before Assist reads a mail: a mail too big to keep in full here is fetched again from the server. */
async function prepareTools(e: SyncEngine, uses: { name: string; input: any }[]) {
  const ids = uses.filter((u) => u.name === 'read_mail').flatMap((u) => [...(Array.isArray(u.input?.mail_ids) ? u.input.mail_ids : []), ...(u.input?.mail_id ? [u.input.mail_id] : [])]).map(String);
  if (!ids.length) return;
  const { mailBody, mailAvailable } = await import('../mail.ts');
  if (!mailAvailable()) return;
  await Promise.all(ids.slice(0, 10).map(async (id) => {
    const m = e.get(id) as any;
    if (!m || m.type !== 'mail' || m.source === 'lunchhub' || fetchedHtml.has(id) || (m.full && !m.htmlTooBig)) return;
    try { const b = await mailBody(e, m); if (b.html) fetchedHtml.set(id, b.html); } catch { /* read what is here */ }
  }));
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
const OLD_RESULT = 1200;
export const resultText = (c: string | Block[]) => (typeof c === 'string' ? c : c.map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[billede]' : '')).join('\n'));
const tooBig = (b: Block) => b.type === 'tool_result' && (typeof b.content !== 'string' || b.content.length > OLD_RESULT);
export const shortenOld = (m: Msg): Msg => (m.role === 'user' && m.content.some(tooBig)
  ? { ...m, content: m.content.map((b) => {
      if (b.type !== 'tool_result' || !tooBig(b)) return b;
      const text = resultText(b.content);
      const pics = typeof b.content === 'string' ? 0 : b.content.filter((x) => x.type === 'image').length;
      const note = pics ? ` [${pics === 1 ? 'Et billede' : pics + ' billeder'} blev vist tidligere. Brug look_at_photos for at se igen.]` : '';
      return { ...b, content: (text.length > OLD_RESULT ? text.slice(0, OLD_RESULT) + ' … [Kun starten er gemt fra et tidligere spørgsmål. Brug værktøjet igen (fx read_mail) for at se det hele.]' : text) + note };
    }) }
  : m);

/**
 * The conversation sent along: the last ~24 messages, cut at a plain user message so tool calls and
 * results stay paired. Every message is paid for again with each new question, so less is cheaper.
 */
function trim(h: Msg[], max = 24): Msg[] {
  let out = h;
  if (h.length > max) {
    let i = h.length - max;
    while (i < h.length && !(h[i].role === 'user' && h[i].content.some((b) => b.type === 'text') && !h[i].content.some((b) => b.type === 'tool_result'))) i++;
    out = h.slice(i);
  }
  return out.map(shortenOld);
}

/**
 * Makes a stored conversation valid for Claude again: every tool call followed by its answer, no
 * answer without its call, no two messages in a row from the same side, and it starts with you.
 * (A conversation cut off mid-way, e.g. by a stopped or too long answer, would otherwise fail with
 * "tool_use ids were found without tool_result blocks".)
 */
export function repair(h: Msg[]): Msg[] {
  const out: Msg[] = [];
  const toolIds = (m?: Msg) => (m?.role === 'assistant' ? m.content.filter((b) => b.type === 'tool_use').map((b: any) => b.id as string) : []);
  for (let i = 0; i < h.length; i++) {
    const m = h[i];
    const prev = out[out.length - 1];
    if (m.role === 'assistant') {
      if (prev?.role === 'assistant') prev.content = [...prev.content, ...m.content]; // two in a row: one turn
      else out.push({ role: 'assistant', content: [...m.content] });
      const cur = out[out.length - 1];
      const ids = toolIds(cur);
      if (!ids.length) continue;
      // The calls must be answered right after: take the answers that are there, fill in the rest.
      const next = h[i + 1];
      const nextUser = next?.role === 'user' ? next : null;
      const got = nextUser ? nextUser.content.filter((b) => b.type === 'tool_result' && ids.includes((b as any).tool_use_id)) : [];
      const missing = ids.filter((id) => !got.some((b: any) => b.tool_use_id === id)).map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'Ikke udført.', is_error: true }) as Block);
      const rest = nextUser ? nextUser.content.filter((b) => b.type !== 'tool_result') : [];
      out.push({ role: 'user', content: [...got, ...missing, ...rest] });
      if (nextUser) i++;
    } else {
      // An answer to a call that isn't right before it is dropped.
      const ids = toolIds(prev);
      const content = m.content.filter((b) => b.type !== 'tool_result' || ids.includes((b as any).tool_use_id));
      if (!content.length) continue;
      if (prev?.role === 'user') prev.content = [...prev.content, ...content];
      else out.push({ role: 'user', content });
    }
  }
  while (out.length && (out[0].role !== 'user' || out[0].content.some((b) => b.type === 'tool_result'))) out.shift();
  return out.filter((m) => m.content.length);
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
export async function askJson<T>(e: SyncEngine, sys: string, text: string, opts: { images?: string[]; fast?: boolean; smart?: boolean; maxTokens?: number; feature?: Feature; label?: string } = {}): Promise<T> {
  const s = aiSettings(e);
  const images = opts.images ?? [];
  let raw = '';
  if (s.provider === 'claude' && s.claudeKey) {
    const content: any[] = images.map((d) => { const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(d)!; return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }; });
    content.push({ type: 'text', text });
    // Haiku unless a caller really needs more (cheapest that can read receipts, mails and short texts).
    const model = opts.smart ? 'claude-sonnet-5-5' : 'claude-haiku-5-5';
    const r = await claude(s, sys, [{ role: 'user', content }], undefined, { tools: false, model, maxTokens: opts.maxTokens ?? 4096, e, feature: opts.feature ?? 'andet' });
    logUsage(e, { feature: opts.feature ?? 'andet', model, label: opts.label ?? text.slice(0, 120), calls: 1, usage: r.usage ?? {}, usd: r.usd ?? 0 });
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
