/**
 * Sample content written once, when a new account is created, so every screen can be seen at full density.
 * Everything here is invented (people, mails, notes) and is removed by Indstillinger → "Fjern eksempeldata".
 * Real mail and calendars arrive in steps 4 and 5.
 */
import type { SyncEngine } from '@centra/sync';

const at = (h: number, m: number, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const ago = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();
const SAMPLE = { sample: true };

export function seedSampleData(e: SyncEngine) {
  const p = (id: string, f: Record<string, unknown>) => e.set('person', id, { ...f, ...SAMPLE });
  p('mads', { name: 'Mads Holm', email: 'mads@lydhuset.dk', initials: 'MH', hue: 150, org: 'Lydhuset' });
  p('sofie', { name: 'Sofie Lund', email: 'sofie.lund@icloud.com', initials: 'SL', hue: 30 });
  p('laser', { name: 'Laserworld Support', email: 'support@laserworld.com', initials: 'LW', hue: 205 });
  p('nordlyd', { name: 'Nordlyd ApS', email: 'faktura@nordlyd.dk', initials: 'NA', hue: 90 });
  p('vega', { name: 'Vega', email: 'billet@vega.dk', initials: 'VE', hue: 340 });
  p('gcal', { name: 'Google Kalender', email: 'calendar@google.com', initials: 'GK', hue: 30 });

  const ev = (id: string, f: Record<string, unknown>) => e.set('event', id, { ...f, ...SAMPLE });
  ev('e1', { title: 'Løbetur', place: 'Fælledparken', start: at(7, 30), end: at(8, 15), cal: 'Privat', recurring: 'man, ons og lør 07.30' });
  ev('e2', { title: 'Lysplan til julekoncert', with: 'Mads Holm', place: 'Teams', start: at(9, 30), end: at(10, 15), cal: 'Arbejde', note: 'n1', mail: 'm1', link: 'https://teams.microsoft.com' });
  ev('e3', { title: 'Fokusblok: SmartLink DMX-mapping', start: at(10, 30), end: at(12, 0), cal: 'CENTRA', focus: true });
  ev('e4', { title: 'Frokost med Sofie', place: 'Torvehallerne', start: at(12, 30), end: at(13, 15), cal: 'Familie' });
  ev('e5', { title: 'Wolfmix-test i øvelokalet', place: 'Lydhuset', start: at(14, 0), end: at(15, 30), cal: 'Arbejde', note: 'n5' });
  ev('e6', { title: 'Koncert', place: 'Vega', start: at(19, 0), end: at(22, 30), cal: 'Privat', mail: 'm5' });
  ev('e7', { title: 'Produktionsmøde Julekoncert', place: 'Koncerthuset, Studie 2', start: at(10, 0, 3), end: at(11, 0, 3), cal: 'Arbejde' });

  const m = (id: string, f: Record<string, unknown>) => e.set('mail', id, { archived: false, ...f, ...SAMPLE });
  m('m1', { from: 'mads', acct: 'one.com', at: ago(9), subject: 'Lysplan til julekoncerten — kan du nå torsdag?', preview: 'Hej Willads, vi har fået bekræftet scenen i Koncerthuset. Kan du sende et første udkast til lysplanen torsdag, så vi kan nå at bestille hazer og ekstra truss?', cat: 'Vigtigt', unread: true, needsReply: true, thread: 4, event: 'e2',
    summary: ['Lydhuset har julekoncerten i Koncerthuset 19. december og vil have dig på lyset.', 'Mads beder om et første udkast til lysplanen torsdag.', 'Rig: 6 movingheads og din laser. Hazer og truss bestilles efter dit udkast.'],
    body: 'Hej Willads\n\nVi har fået bekræftet scenen i Koncerthuset. Kan du sende et første udkast til lysplanen torsdag, så vi kan nå at bestille hazer og ekstra truss?\n\nVi regner med 6 movingheads og din laser fra sidst. Sig til, hvis du mangler mål.\n\nHilsen\nMads',
    draft: 'Hej Mads\n\nTorsdag passer fint, du får udkastet inden kl. 12. Kan du sende mål på truss og højden til loftet i Studie 1?\n\nBedste\nWillads' });
  m('m2', { from: 'sofie', acct: 'iCloud', at: ago(42), subject: 'Frokost i dag?', preview: 'Er Torvehallerne kl. 12.30 stadig okay? Toget er forsinket, så jeg er der måske først 12.35.', cat: 'Personer', unread: true, needsReply: true, thread: 1, body: 'Er Torvehallerne kl. 12.30 stadig okay? Toget er forsinket, så jeg er der måske først 12.35.\n\nSofie' });
  m('m3', { from: 'laser', acct: 'Outlook', at: ago(60 * 17), subject: 'RE: DS-3000RGB MK5 — firmware 1.4.2', preview: 'Thanks for the logs. Could you confirm whether the ILDA output stays stable after the update when the unit runs on DMX?', cat: 'Vigtigt', unread: false, needsReply: true, thread: 6, body: 'Hi Willads,\n\nThanks for the logs. Could you confirm whether the ILDA output stays stable after the update when the unit runs on DMX?\n\nBest regards\nLaserworld Support' });
  m('m9', { from: 'gcal', acct: 'Gmail', at: ago(75), subject: 'Invitation: Produktionsmøde Julekoncert · tor 10.00', preview: 'Mads Holm har inviteret dig. Koncerthuset, Studie 2.', cat: 'Invitationer', unread: true, needsReply: false, thread: 1, body: 'Mads Holm har inviteret dig til Produktionsmøde Julekoncert.\nKoncerthuset, Studie 2.' });
  m('m4', { from: 'nordlyd', acct: 'one.com', at: ago(60 * 22), subject: 'Faktura 2026-118', preview: 'Vedhæftet faktura for leje af lydudstyr 14.–16. oktober. Beløb 4.375,00 kr. Betalingsfrist 2. november.', cat: 'Kvitteringer', unread: false, needsReply: false, thread: 1, attachment: 'Faktura-2026-118.pdf', body: 'Vedhæftet faktura for leje af lydudstyr 14.–16. oktober.\nBeløb 4.375,00 kr. Betalingsfrist 2. november.\n\nNordlyd ApS' });
  m('m5', { from: 'vega', acct: 'Gmail', at: ago(60 * 72), subject: 'Dine billetter: Koncert i aften', preview: '2 billetter · Store Vega · Dørene åbner 19.00. Vis billetten ved indgangen.', cat: 'Kvitteringer', unread: false, needsReply: false, thread: 1, attachment: 'Billetter.pdf', event: 'e6', body: '2 billetter · Store Vega · Dørene åbner 19.00.' });

  const note = (id: string, f: Record<string, unknown>, body: string) => {
    e.set('note', id, { ...f, ...SAMPLE });
    e.doc(id).getText('body').insert(0, body);
  };
  note('n1', { title: 'Lysplan — julekoncert', folder: 'Projekter / Julekoncert', tags: ['lys', 'julekoncert'], pinned: true, event: 'e2', mail: 'm1', editedAt: ago(14) },
    'Koncerthuset, Studie 1, lørdag 19. december. Mads har bekræftet scenen; vi skal have et første udkast klar torsdag, så hazer og ekstra truss kan nå at blive bestilt.\n\nRig\n[x] 6 movingheads fra Lydhuset bekræftet\n[x] DS-3000RGB MK5 med firmware 1.4.2\n[ ] Mål på truss fra Mads\n[ ] Neon Tube PIX langs scenekanten, 8 stk.\n\nCues\nIndgang · movingheads, varm hvid · Q1 · 4 min\nFørste sæt · Neon Tube PIX, langsomt fade · Q2–Q7 · 38 min\nFinale · laser, tunnel over publikum · Q8 · 6 min\n\nTil Mads torsdag\nSend cue-listen og en skitse. DMX-adresserne følger [[SmartLink — DMX-mapping v2]], så Wolfmix kan styre det hele fra ét univers.');
  note('n2', { title: 'SmartLink — DMX-mapping v2', folder: 'Projekter / SmartLink', tags: ['smartlink'], pinned: true, editedAt: ago(60 * 11) },
    'Kanal 1–16 til DS-3000, 17–48 Wolfmix-scener, Neon Tube PIX på univers 2.');
  note('n5', { title: 'Mødenote: Wolfmix-test', folder: 'Møder', tags: ['møde'], auto: true, event: 'e5', editedAt: at(7, 0) },
    'Dagsorden\n\nDeltagere\n\nHandlinger');
  note('n4', { title: 'Ideer til CENTRA', folder: 'Privat', tags: ['ideer'], editedAt: ago(60 * 48) }, 'Hurtignote fra låseskærmen, ugentligt resumé af arkiveret støj.');
  note('n3', { title: 'Indkøb', folder: 'Privat', tags: [], editedAt: ago(60 * 50) }, 'Kaffebønner, gaffatape 50 mm, AA-batterier.');

  const g = (id: string, f: Record<string, unknown>) => e.set('goal', id, { ...f, ...SAMPLE });
  g('g1', { title: 'Løb 500 km i 2026', area: 'Sundhed', kind: 'measure', unit: 'km', target: 500, start: '2026-01-01', due: '2026-12-31', event: 'e1', order: 1 });
  g('g2', { title: 'SmartLink 1.0 udgivet', area: 'Projekter', kind: 'milestones', due: '2026-12-01', order: 2,
    steps: [['DMX-mapping v2', true], ['Wolfmix-integration', true], ['Neon Tube PIX via CONNECT', true], ['Stabil ILDA-udgang på DS-3000', false], ['Beta til 3 testere', false], ['Udgivelse via GitHub releases', false]] });
  g('g3', { title: 'Lysplan til julekoncert leveret', area: 'Arbejde', kind: 'milestones', due: '2026-10-29', order: 3,
    steps: [['Rig bekræftet', true], ['Laser opdateret', true], ['Cue-liste', false], ['Skitse af scenen', false], ['Sendt til Mads', false]] });
  g('g4', { title: 'Læs 12 bøger i 2026', area: 'Privat', kind: 'measure', unit: 'bøger', target: 12, due: '2026-12-31', order: 4 });
  g('g5', { title: 'Styrketræning 2 gange om ugen', area: 'Sundhed', kind: 'habit', perWeek: 2, order: 5 });

  const u = (goal: string, when: string, delta: number, text = '', src = 'Skrevet af dig') => e.create('goalUpdate', { goal, at: when, delta, text, src, ...SAMPLE });
  const months = [38, 35, 44, 46, 48, 40, 32, 45, 42];
  months.forEach((km, i) => u('g1', new Date(2026, i, 28, 20).toISOString(), km, '', 'Månedstotal fra import'));
  u('g1', new Date(2026, 9, 3, 8).toISOString(), 10.2, '', 'Fra Løbetur i kalenderen · godkendt af dig');
  u('g1', new Date(2026, 9, 10, 8).toISOString(), 12.2, '', 'Fra Løbetur i kalenderen · godkendt af dig');
  u('g1', new Date(2026, 9, 21, 8).toISOString(), 6.4, '', 'Fra Løbetur i kalenderen · godkendt af dig');
  u('g1', new Date(2026, 9, 24, 9).toISOString(), 8.0, 'Langtur langs søerne. Knæet holdt fint.');
  u('g4', new Date(2026, 8, 30).toISOString(), 8, '', 'Import');
  u('g4', new Date(2026, 9, 18).toISOString(), 1, 'Færdig med "Lyset i mørket".');
  [[8, 29], [9, 1], [9, 6], [9, 9], [9, 14], [9, 21]].forEach(([mo, d]) => u('g5', new Date(2026, mo, d, 18).toISOString(), 1));
  u('g5', new Date(2026, 9, 23, 18).toISOString(), 1, 'Uge 43 klaret.');

  const s = (id: string, f: Record<string, unknown>) => e.set('suggestion', id, { status: 'pending', ...f, ...SAMPLE });
  s('s4', { kind: 'goal', title: 'Log 5,2 km på Løb 500 km i 2026?', detail: 'Fra Løbetur i morges 07.30–08.15.', source: 'Lært: du logger altid dine løbeture', payload: { goal: 'g1', delta: 5.2, text: 'Fælledparken, rolig tur.' } });
  s('s1', { kind: 'calendar', title: 'Påmindelse: betal faktura 2026-118', detail: 'Nordlyd ApS · 4.375,00 kr · forfalder 2. nov.', source: 'Fra mail i går', payload: { title: 'Betal faktura 2026-118 · Nordlyd', start: '2026-11-02T09:00' } });
  s('s2', { kind: 'draft', title: 'Svarudkast til Mads er klar', detail: '4 linjer i din tone: bekræfter torsdag, beder om mål på truss.', source: 'Fra mail', payload: { mail: 'm1' } });
  s('s3', { kind: 'rule', title: 'Arkivér altid Politiken Morgen?', detail: 'Du har arkiveret de sidste 12 uden at åbne dem.', source: 'Lært af dine handlinger', payload: { rule: 'archive-from:morgen@pol.dk' } });

  const mem = (id: string, f: Record<string, unknown>) => e.set('memory', id, { ...f, ...SAMPLE });
  mem('r1', { kind: 'Rutine', statement: 'Løber mandag, onsdag og lørdag kl. 07.30', evidence: '14 af de sidste 15 løbeture', source: 'Lært af dine handlinger' });
  mem('r2', { kind: 'Skrivestil', statement: 'Svarer kort, starter med "Hej" og slutter med "Bedste"', evidence: '38 sendte mails', source: 'Lært af dine handlinger' });
  mem('r3', { kind: 'Person', statement: 'Mads Holm er vigtig, svar typisk inden for 2 timer', evidence: '11 tråde i 2026', source: 'Lært af dine handlinger' });
  mem('r4', { kind: 'Mål', statement: 'Opdaterer mål søndag aften', evidence: '6 af de sidste 7 søndage', source: 'Lært af dine handlinger' });
}
