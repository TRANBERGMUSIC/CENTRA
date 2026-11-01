import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { htmlToText, fullText, fetchedHtml } from '../src/mailText.ts';
import { runTool, contextFor } from '../src/ai/tools.ts';
import { blocks } from '../src/ui/Markdown.tsx';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}
const BOOKING = `<html><head><style>.x{color:red}</style><title>t</title></head><body>
<p>Hej Willads,</p><p>Tak for din booking hos <b>Copenhagen DJ School</b>.</p>
<table><tr><td>Dato</td><td>19. nov. 2026</td></tr><tr><td>Tid</td><td>10:00&nbsp;–&nbsp;12:00</td></tr><tr><td>Lektion</td><td>DJ-lektion</td></tr>
<tr><td>Dato</td><td>19. nov. 2026</td></tr><tr><td>Tid</td><td>14:00 – 16:30</td></tr><tr><td>Lektion</td><td>Ableton&#8209;lektion</td></tr></table>
<p><a href="https://booking.example.dk/b/4802892">Se din booking</a> &amp; <a href="https://example.dk">https://example.dk</a></p><!-- skjult --><script>alert(1)</script>
<img src="x.png" alt="Logo"></body></html>`;

describe('mails læses fuldt ud', () => {
  it('HTML bliver til læsbar tekst med tider og links', () => {
    const t = htmlToText(BOOKING);
    expect(t).toContain('19. nov. 2026');
    expect(t).toContain('14:00 – 16:30');
    expect(t).toContain('Ableton‑lektion');
    expect(t).toContain('Se din booking (https://booking.example.dk/b/4802892)');
    expect(t).toContain('& https://example.dk');
    expect(t).not.toMatch(/color:red|alert|skjult|<|&nbsp;/);
    expect(t).toContain('[Logo]');
  });
  it('bruger HTML-versionen, når tekstdelen kun er en stump', () => {
    expect(fullText({ body: 'Se denne mail i din browser', html: BOOKING })).toContain('14:00 – 16:30');
    expect(fullText({ body: 'Hej\n\nEn helt almindelig mail med masser af tekst her.', html: '<p>Hej</p>' })).toContain('almindelig');
  });
  it('read_mail giver hele teksten, også for flere mails på én gang', async () => {
    const e = await engine();
    const long = 'Linje med detaljer. '.repeat(800); // 16k tegn
    e.set('mail', 'm-1', { subject: 'Booking', fromName: 'DJ School', fromEmail: 'b@x.dk', body: 'Se i browser', html: BOOKING, at: '2026-10-30T10:00:00Z' });
    e.set('mail', 'm-2', { subject: 'Lang', fromName: 'A', fromEmail: 'a@x.dk', body: long + 'SLUTNINGEN', at: '2026-10-30T10:00:00Z' });
    e.set('mail', 'm-3', { subject: 'Stor', fromName: 'B', fromEmail: 'c@x.dk', body: '', html: '', htmlTooBig: true, at: '2026-10-30T10:00:00Z' });
    fetchedHtml.set('m-3', '<p>Afgang kl. 07:45 fra CPH</p>');
    expect((runTool(e, 'read_mail', { mail_id: 'm-1' }).result as any).text).toContain('14:00 – 16:30');
    const many = runTool(e, 'read_mail', { mail_ids: ['m-2', 'm-3', 'nope'] }).result as any[];
    expect(many[0].text.endsWith('SLUTNINGEN')).toBe(true);
    expect(many[1].text).toBe('Afgang kl. 07:45 fra CPH');
    expect(many[2].error).toBe('Ukendt mail');
  });
});

describe('Assist lærer, hvordan du vil have svar', () => {
  it('svarstil og feedback står øverst i konteksten; skrivestil og sendte mails til udkast', async () => {
    const e = await engine();
    runTool(e, 'remember', { kind: 'Svarstil', statement: 'Svar kort, højst tre linjer' });
    runTool(e, 'remember', { kind: 'Skrivestil', statement: 'Skriver "Hej X" og slutter med "Mvh Willads"' });
    e.create('feedback', { at: '2026-10-30T10:00:00Z', rating: 'up', question: 'Hvornår er DJ-lektionen?', reply: 'Torsdag 19. nov. kl. 10–12.' });
    const ctx = contextFor(e);
    const head = ctx.split('## Det ved du om brugeren')[0];
    expect(head).toContain('Svar kort, højst tre linjer');
    expect(head).toContain('Torsdag 19. nov. kl. 10–12.');
    e.set('mail', 's-1', { sent: true, to: ['sofie@x.dk'], subject: 'Re: Fredag', body: 'Hej Sofie\n\nJa, det passer!\n\nMvh Willads\n\nDen 30. okt. 2026 skrev Sofie:\n> Kan du fredag?', at: '2026-10-30T11:00:00Z' });
    e.set('mail', 's-2', { sent: true, to: ['mads@x.dk'], subject: 'Pizza', body: 'Hej Mads, kommer du?', at: '2026-10-30T12:00:00Z' });
    const st = runTool(e, 'my_writing_style', { to: 'sofie@x.dk' }).result as any;
    expect(st.what_the_user_said).toEqual(['Skriver "Hej X" og slutter med "Mvh Willads"']);
    expect(st.recent_sent[0].to).toBe('sofie@x.dk');
    expect(st.recent_sent[0].text).toBe('Hej Sofie\n\nJa, det passer!\n\nMvh Willads');
  });
});

describe('markdown i svar', () => {
  it('lister, afsnit og fed', () => {
    const b = blocks('Seks aftaler er lagt ind:\n\n- **19. nov.:** DJ 10–12\n- **4. dec.:** DJ 10–12\n  fortsat linje\n\n1. Første\n2. Anden\n\n## Overskrift');
    expect(b.map((x) => x.kind)).toEqual(['p', 'ul', 'ol', 'h']);
    expect(b[1].lines).toEqual(['**19. nov.:** DJ 10–12', '**4. dec.:** DJ 10–12 fortsat linje']);
  });
});
