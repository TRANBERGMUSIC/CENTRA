import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { judge, screenMail, clearDanger, SAFETY_FOLDERS } from '../src/mailSafety.ts';

beforeAll(ready);
async function engine() {
  const e = new SyncEngine({ device: 'mac', keys: new KeyRing('k1', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
  await e.start();
  return e;
}

describe('scam and phishing', () => {
  it('catches a fake MitID mail', () => {
    const v = judge({ fromName: 'MitID', fromEmail: 'no-reply@mitid-sikkerhed.com', subject: 'Din MitID udløber i dag', body: 'Bekræft din identitet inden 24 timer: https://mitid-dk.secure-login.ru/login', auth: 'spf=softfail dkim=none dmarc=fail' });
    expect(v.danger).toBe('phishing');
    expect(v.why.join(' ')).toMatch(/kalder sig MitID/);
  });
  it('catches a parcel toll mail with a lying link', () => {
    const v = judge({ fromName: 'PostNord', fromEmail: 'info@pn-levering.top', subject: 'Din pakke venter', body: 'Betal told på 19 kr.', html: '<p>Betal told: <a href="http://185.22.10.4/pay">www.postnord.dk/betal</a></p>' });
    expect(v.danger).toBe('phishing');
    expect(v.why.some((w) => w.includes('fører til 185.22.10.4'))).toBe(true);
  });
  it('catches sextortion and lottery as svindel', () => {
    expect(judge({ fromName: 'Hacker', fromEmail: 'x@mail.ru', subject: 'Your account', body: 'I have access to your device and recorded you. Pay 1200 USD in bitcoin to this BTC wallet within 48 hours.' }).danger).toBe('scam');
    expect(judge({ fromName: 'Euro Lottery', fromEmail: 'claims@lotto-intl.info', subject: 'Congratulations, you have won 1.500.000 EUR', body: 'You have been selected. Send your details.' }).danger).toBe('scam');
    expect(judge({ fromName: 'Ukendt', fromEmail: 'a@b.example', subject: 'Hej', body: 'hej', spam: true, auth: 'spf=fail dkim=none' }).danger).toBe('scam');
  });
  it('leaves real mail alone', () => {
    expect(judge({ fromName: 'Danske Bank', fromEmail: 'noreply@danskebank.dk', subject: 'Log ind og se din nye kontoudskrift', body: 'Log ind her: https://danskebank.dk', auth: 'spf=pass dkim=pass dmarc=pass' }).danger).toBeNull();
    expect(judge({ list: true, fromName: 'Netto', fromEmail: 'nyhedsbrev@netto.dk', subject: 'Ugens tilbud – kun i dag', html: '<a href="https://click.mailer.example/abc">www.netto.dk</a>', auth: 'spf=pass dkim=pass dmarc=pass' }).danger).toBeNull();
    expect(judge({ fromName: 'Max Hansen', fromEmail: 'max.hansen@gmail.com', subject: 'Frokost i morgen?', body: 'Skal vi spise kl. 12?' }).danger).toBeNull();
    expect(judge({ fromName: 'Sigge', fromEmail: 'sigge@gmail.com', subject: 'Faktura for lyd', body: 'Her er fakturaen. Betal inden fredag.', attachments: ['Faktura.pdf'] }).danger).toBeNull();
    expect(judge({ fromName: 'Netflix', fromEmail: 'info@account.netflix.com', subject: 'Betalingen blev afvist', body: 'Opdater din betaling', auth: 'dmarc=pass' }).danger).toBeNull();
  });
  it('catches a program pretending to be a PDF', () => {
    expect(judge({ fromName: 'Regnskab', fromEmail: 'billing@firma-x.example', subject: 'Faktura 2211', body: 'Se vedhæftet faktura. Betal straks.', attachments: ['Faktura_2211.pdf.exe'], replyTo: 'pay@other.example' }).danger).toBe('phishing');
  });

  it('moves hits to their folder; contacts and cleared senders are never flagged', async () => {
    const e = await engine();
    e.set('person', 'p1', { name: 'Postnord-ven', email: 'ven@pn-levering.top' });
    const fake = { fromName: 'PostNord', fromEmail: 'info@pn-levering.top', subject: 'Din pakke venter', body: 'Betal told inden 24 timer', html: '<a href="http://185.22.10.4/pay">www.postnord.dk</a>', at: new Date().toISOString() };
    e.set('mail', 'm1', { ...fake, fromEmail: 'svindel@pn-levering.top' });
    e.set('mail', 'm2', { ...fake, fromEmail: 'ven@pn-levering.top' });
    e.set('mail', 'm3', { fromName: 'Mor', fromEmail: 'mor@example.dk', subject: 'Søndag', body: 'Kommer du?', at: new Date().toISOString() });
    expect(screenMail(e)).toEqual(['m1']);
    const m1 = e.get('m1') as any;
    expect(m1.danger).toBe('phishing');
    expect(m1.mbox).toBe(SAFETY_FOLDERS.phishing.id);
    expect((e.get(SAFETY_FOLDERS.phishing.id) as any).name).toBe('Phishing');
    expect((e.get('m2') as any).danger).toBeFalsy();
    // Already looked over: not again.
    expect(screenMail(e)).toEqual([]);
    const undo = clearDanger(e, m1);
    expect((e.get('m1') as any).mbox).toBe('');
    e.set('mail', 'm4', { ...fake, fromEmail: 'svindel@pn-levering.top' });
    expect(screenMail(e, ['m4'])).toEqual([]);
    undo();
    expect((e.get('m1') as any).danger).toBe('phishing');
  });
});
