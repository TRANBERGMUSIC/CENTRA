/**
 * Supabase relay adapter — the production backend. Same contract as WsRelay.
 * Requires the schema in services/supabase/migrations. Pass a `@supabase/supabase-js` client
 * that is already signed in (e-mail link or passkey); RLS limits every row to auth.uid().
 *
 * Not exercised by the test suite yet (needs a Supabase project) — see docs/ROADMAP.md.
 */
import type { Envelope, Relay } from './types.ts';

type Client = any; // SupabaseClient, kept loose so @centra/sync has no hard dependency on supabase-js

export class SupabaseRelay implements Relay {
  connected = false;
  private subs = new Set<(e: Envelope) => void>();
  private opens = new Set<() => void>();
  private channel: any;

  constructor(private sb: Client, private userId: string, private device: string) {
    this.channel = sb
      .channel(`changes:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'changes', filter: `user_id=eq.${userId}` }, (p: any) =>
        this.subs.forEach((s) => s(toEnv(p.new))),
      )
      .subscribe((status: string) => {
        this.connected = status === 'SUBSCRIBED';
        if (this.connected) this.opens.forEach((o) => o());
      });
  }

  async push(envs: Envelope[]) {
    const rows = envs.map((e) => ({ id: e.id, device: this.device, key_id: e.keyId, body: e.body }));
    const { error } = await this.sb.from('changes').upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true });
    if (error) throw error;
  }
  async pull(after: number) {
    const { data, error } = await this.sb.from('changes').select('*').gt('seq', after).order('seq').limit(5000);
    if (error) throw error;
    return (data ?? []).map(toEnv);
  }
  subscribe(cb: (e: Envelope) => void) { this.subs.add(cb); return () => this.subs.delete(cb); }
  onOpen(cb: () => void) { this.opens.add(cb); return () => this.opens.delete(cb); }
  close() { this.sb.removeChannel(this.channel); }
}

const toEnv = (r: any): Envelope => ({ id: r.id, seq: Number(r.seq), device: r.device, keyId: r.key_id, body: r.body });
