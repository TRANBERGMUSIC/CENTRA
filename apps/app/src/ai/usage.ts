/**
 * What Claude costs: every API call is counted (tokens in, out, cache) and priced with Anthropic's
 * list prices. Stored per day, model and feature, so the history stays small and encrypted.
 * Prices: platform.claude.com/docs/en/about-claude/pricing (USD per million tokens, Oct 2026).
 */
import type { SyncEngine } from '@centra/sync';

export type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
export type Feature = 'chat' | 'kvittering' | 'mailsortering' | 'test' | 'andet';
export const FEATURES: Record<Feature, string> = { chat: 'Samtaler med Assist', kvittering: 'Kvitteringer', mailsortering: 'Mailsortering', test: 'Test af forbindelse', andet: 'Andet' };

type Price = { input: number; cacheWrite: number; cacheRead: number; output: number };
const PRICES: Record<string, Price | ((promptTokens: number) => Price)> = {
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  // Haiku is priced by prompt size: over 100k tokens the whole request costs five times as much.
  'claude-haiku-5-5': (p) => (p > 100_000 ? { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 } : { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 }),
};
export const MODEL_NAMES: Record<string, string> = { 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5' };
export const MODEL_ORDER = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

const tok = (u: Usage) => ({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 });
function priceFor(model: string, u: Usage): Price {
  const p = PRICES[model] ?? PRICES['claude-sonnet-5-5'];
  const t = tok(u);
  return typeof p === 'function' ? p(t.input + t.cacheWrite + t.cacheRead) : p;
}

/** USD for one call. */
export function costOf(model: string, u: Usage): number {
  const t = tok(u), p = priceFor(model, u);
  return (t.input * p.input + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead + t.output * p.output) / 1e6;
}
/** USD the same call would have cost on Sonnet without any cache: what routing and caching saved. */
export function baselineOf(u: Usage): number {
  const t = tok(u), p = PRICES['claude-sonnet-5-5'] as Price;
  return ((t.input + t.cacheWrite + t.cacheRead) * p.input + t.output * p.output) / 1e6;
}

const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type UsageRow = { id: string; day: string; model: string; feature: Feature; calls: number; input: number; output: number; cacheWrite: number; cacheRead: number; usd: number; baseline: number };

/** Adds one call to today's row for (model, feature). */
export function recordUsage(e: SyncEngine, model: string, feature: Feature, u: Usage): number {
  const id = `usage-${day()}-${model}-${feature}`;
  const cur = (e.get(id) as unknown as UsageRow | null);
  const t = tok(u), usd = costOf(model, u);
  e.set('usage', id, {
    day: day(), model, feature,
    calls: (cur?.calls ?? 0) + 1, input: (cur?.input ?? 0) + t.input, output: (cur?.output ?? 0) + t.output,
    cacheWrite: (cur?.cacheWrite ?? 0) + t.cacheWrite, cacheRead: (cur?.cacheRead ?? 0) + t.cacheRead,
    usd: (cur?.usd ?? 0) + usd, baseline: (cur?.baseline ?? 0) + baselineOf(u),
  });
  return usd;
}

export const usageRows = (e: SyncEngine) => e.list('usage') as unknown as UsageRow[];
export function spentThisMonth(e: SyncEngine, now = new Date()) {
  const m = day(now).slice(0, 7);
  return usageRows(e).filter((r) => r.day.startsWith(m)).reduce((s, r) => s + r.usd, 0);
}

/* ---------------------------------------------------------------- choosing the model */
export type Route = { model: string; why: string };
const SIMPLE = /^(husk|log|logg|gem|tilføj|slet|fjern|betalt|hvem skylder|hvad skylder|lav en note|note:|ny note|ny aftale|sæt|marker|markér|ja|nej|ok|okay|tak|super|perfekt|godt|fint|det er rigtigt|præcis)\b/i;
const HARD = /planlæg|plan for|strategi|analys|sammenlign|vurdér|vurder|gennemgå alle|gennemgå mine|budget|økonomi|prioritér|prioriter|hvorfor|forklar grundigt|tænk grundigt|skriv en lang|udkast til en|ansøgning|opsummér alle|find alle|hele måneden|hele året/i;

/**
 * Automatic choice, cheapest that will do the job:
 *  - Haiku 5.5 for quick commands and short replies (log, husk, betalt, ja/nej …)
 *  - Opus 5.5 for planning, analysis and long, many-step requests
 *  - Sonnet 5.5 for everything in between
 * Over the monthly budget everything goes to Haiku.
 */
export function routeModel(text: string, opts: { mode: string; budgetUsd?: number; spentUsd?: number; turns?: number }): Route {
  if (opts.mode !== 'auto') return { model: opts.mode, why: 'valgt fast i Indstillinger' };
  if (opts.budgetUsd && (opts.spentUsd ?? 0) >= opts.budgetUsd) return { model: 'claude-haiku-5-5', why: 'månedens budget er brugt' };
  const t = text.trim();
  const words = t.split(/\s+/).length;
  if (HARD.test(t) || t.length > 900 || (words > 60 && /\?.*\?/s.test(t))) return { model: 'claude-opus-5-5', why: 'kræver planlægning eller analyse' };
  if ((SIMPLE.test(t) && t.length < 160) || (words <= 6 && !/\?/.test(t))) return { model: 'claude-haiku-5-5', why: 'kort kommando' };
  return { model: 'claude-sonnet-5-5', why: 'almindelig opgave' };
}
