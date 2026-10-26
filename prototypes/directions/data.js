// Sample data for the three design directions. Every count shown on screen is computed from these rows.
// Sample content (names, mails, notes) is invented for the mockups and listed in the README.
export const NOW = { date: '2026-10-26', time: '09:12', minutes: 9 * 60 + 12, weekday: 'Mandag', label: 'Mandag 26. oktober' };
export const user = { name: 'Willads', initials: 'WT' };

export const accounts = [
  { id: 'gmail', label: 'Gmail', kind: 'Privat' },
  { id: 'outlook', label: 'Outlook', kind: 'Arbejde' },
  { id: 'onecom', label: 'one.com', kind: 'tranberg.dk' },
  { id: 'icloud', label: 'iCloud', kind: 'Familie' },
];

const m = (h, mm) => h * 60 + mm;
export const events = [
  { id: 'e1', title: 'Løbetur', place: 'Fælledparken', start: m(7, 30), end: m(8, 15), cal: 'Privat' },
  { id: 'e2', title: 'Lysplan til julekoncert', with: 'Mads Holm', place: 'Teams', start: m(9, 30), end: m(10, 15), cal: 'Arbejde', note: 'n1', mail: 'm1', link: true },
  { id: 'e3', title: 'Fokusblok: SmartLink DMX-mapping', start: m(10, 30), end: m(12, 0), cal: 'CENTRA', focus: true },
  { id: 'e4', title: 'Frokost med Sofie', place: 'Torvehallerne', start: m(12, 30), end: m(13, 15), cal: 'Familie' },
  { id: 'e5', title: 'Wolfmix-test i øvelokalet', place: 'Lydhuset', start: m(14, 0), end: m(15, 30), cal: 'Arbejde', note: 'n5' },
  { id: 'e6', title: 'Koncert', place: 'Vega', start: m(19, 0), end: m(22, 30), cal: 'Privat', mail: 'm5' },
];

export const people = {
  mads: { name: 'Mads Holm', email: 'mads@lydhuset.dk', initials: 'MH', hue: 150, org: 'Lydhuset' },
  sofie: { name: 'Sofie Lund', email: 'sofie.lund@icloud.com', initials: 'SL', hue: 30 },
  laser: { name: 'Laserworld Support', email: 'support@laserworld.com', initials: 'LW', hue: 205 },
  nordlyd: { name: 'Nordlyd ApS', email: 'faktura@nordlyd.dk', initials: 'NA', hue: 90 },
  vega: { name: 'Vega', email: 'billet@vega.dk', initials: 'VE', hue: 340 },
  ape: { name: 'Ape Labs', email: 'news@apelabs.com', initials: 'AL', hue: 205 },
  politiken: { name: 'Politiken Morgen', email: 'morgen@pol.dk', initials: 'PM', hue: 90 },
  github: { name: 'GitHub', email: 'notifications@github.com', initials: 'GH', hue: 150 },
  gcal: { name: 'Google Kalender', email: 'calendar@google.com', initials: 'GK', hue: 30 },
};

export const mails = [
  { id: 'm1', from: 'mads', acct: 'onecom', when: '09.03', ago: '9 min', subject: 'Lysplan til julekoncerten — kan du nå torsdag?', preview: 'Hej Willads, vi har fået bekræftet scenen i Koncerthuset. Kan du sende et første udkast til lysplanen torsdag, så vi kan nå at bestille hazer og ekstra truss?', cat: 'Vigtigt', unread: true, needsReply: true, thread: 4, event: 'e2' },
  { id: 'm2', from: 'sofie', acct: 'icloud', when: '08.30', ago: '42 min', subject: 'Frokost i dag?', preview: 'Er Torvehallerne kl. 12.30 stadig okay? Toget er forsinket, så jeg er der måske først 12.35.', cat: 'Personer', unread: true, needsReply: true, thread: 1, event: 'e4' },
  { id: 'm3', from: 'laser', acct: 'outlook', when: 'I går', ago: 'I går 16.42', subject: 'RE: DS-3000RGB MK5 — firmware 1.4.2', preview: 'Thanks for the logs. Could you confirm whether the ILDA output stays stable after the update when the unit runs on DMX?', cat: 'Vigtigt', unread: false, needsReply: true, thread: 6 },
  { id: 'm9', from: 'gcal', acct: 'gmail', when: '07.58', ago: '1 t', subject: 'Invitation: Produktionsmøde Julekoncert · tor 29. okt 10.00', preview: 'Mads Holm har inviteret dig. Koncerthuset, Studie 2. Ja · Måske · Nej', cat: 'Invitationer', unread: true, needsReply: false, thread: 1 },
  { id: 'm8', from: 'github', acct: 'gmail', when: '07.55', ago: '1 t', subject: '[smartlink] CI passed on main', preview: 'All checks have passed: build, test, lint. Commit 4f2a9c1 by willads.', cat: 'Notifikationer', unread: true, needsReply: false, thread: 1 },
  { id: 'm7', from: 'politiken', acct: 'gmail', when: '06.00', ago: '3 t', subject: 'Det skal du vide i dag', preview: 'Regeringen fremlægger klimaplan · Storm over Vestjylland · Dagens kryds', cat: 'Nyhedsbreve', unread: true, needsReply: false, thread: 1 },
  { id: 'm4', from: 'nordlyd', acct: 'onecom', when: 'I går', ago: 'I går 11.05', subject: 'Faktura 2026-118', preview: 'Vedhæftet faktura for leje af lydudstyr 14.–16. oktober. Beløb 4.375,00 kr. Betalingsfrist 2. november.', cat: 'Kvitteringer', unread: false, needsReply: false, thread: 1, attachment: 'Faktura-2026-118.pdf' },
  { id: 'm5', from: 'vega', acct: 'gmail', when: 'Fre', ago: 'Fre 23. okt', subject: 'Dine billetter: Koncert mandag 26. oktober', preview: '2 billetter · Store Vega · Dørene åbner 19.00. Vis billetten ved indgangen.', cat: 'Kvitteringer', unread: false, needsReply: false, thread: 1, attachment: 'Billetter.pdf', event: 'e6' },
  { id: 'm6', from: 'ape', acct: 'gmail', when: 'Lør', ago: 'Lør 24. okt', subject: 'CONNECT 2.0: new firmware for Neon Tube PIX', preview: 'Pixel mapping is now up to 4× faster. Update from the Ape Labs app.', cat: 'Nyhedsbreve', unread: false, needsReply: false, thread: 1 },
];

export const thread_m1 = [
  { from: 'mads', when: 'Tor 22. okt 14.10', body: 'Hej Willads\n\nLydhuset har fået julekoncerten i Koncerthuset den 19. december, og vi vil gerne have dig på lyset igen. Har du tid til et møde mandag morgen?' },
  { from: 'me', when: 'Tor 22. okt 15.02', body: 'Hej Mads\n\nDet lyder godt. Mandag 9.30 passer fint, send gerne en invitation.\n\nBedste\nWillads' },
  { from: 'mads', when: 'Fre 23. okt 08.40', body: 'Super, invitation sendt. Jeg vedhæfter scenetegningen.' },
  { from: 'mads', when: 'I dag 09.03', body: 'Hej Willads\n\nVi har fået bekræftet scenen i Koncerthuset. Kan du sende et første udkast til lysplanen torsdag, så vi kan nå at bestille hazer og ekstra truss?\n\nVi regner med 6 movingheads og din laser fra sidst. Sig til, hvis du mangler mål.\n\nHilsen\nMads' },
];

export const notes = [
  { id: 'n1', title: 'Lysplan — julekoncert', folder: 'Projekter / Julekoncert', edited: '08.58', editedLabel: 'I dag 08.58', tags: ['lys', 'julekoncert'], pinned: true, event: 'e2', mail: 'm1', excerpt: '6 movingheads, laser fra sidst, hazer. Første udkast til Mads torsdag.' },
  { id: 'n2', title: 'SmartLink — DMX-mapping v2', folder: 'Projekter / SmartLink', edited: 'I går', editedLabel: 'I går 22.14', tags: ['smartlink'], pinned: true, excerpt: 'Kanal 1–16 til DS-3000, 17–48 Wolfmix-scener, Neon Tube PIX på univers 2.' },
  { id: 'n5', title: 'Mødenote: Wolfmix-test', folder: 'Møder', edited: '07.00', editedLabel: 'Oprettet automatisk 07.00', tags: ['møde'], auto: true, event: 'e5', excerpt: 'Oprettet til mødet 14.00. Dagsorden, deltagere og handlinger.' },
  { id: 'n4', title: 'Ideer til CENTRA', folder: 'Privat', edited: 'Lør', editedLabel: 'Lør 24. okt', tags: ['ideer'], excerpt: 'Hurtignote fra låseskærmen, ugentligt resumé af arkiveret støj.' },
  { id: 'n3', title: 'Indkøb', folder: 'Privat', edited: 'Lør', editedLabel: 'Lør 24. okt', tags: [], excerpt: 'Kaffebønner, gaffatape 50 mm, AA-batterier.' },
];

export const suggestions = [
  { id: 's1', kind: 'calendar', title: 'Påmindelse: betal faktura 2026-118', detail: 'Nordlyd ApS · 4.375,00 kr · forfalder man. 2. nov.', source: 'Fra mail i går 11.05', action: 'Opret påmindelse' },
  { id: 's2', kind: 'draft', title: 'Svarudkast til Mads er klar', detail: '4 linjer i din tone: bekræfter torsdag, beder om mål på truss.', source: 'Fra mail 09.03', action: 'Åbn udkast' },
  { id: 's3', kind: 'rule', title: 'Arkivér altid Politiken Morgen?', detail: 'Du har arkiveret de sidste 12 uden at åbne dem.', source: 'Lært af dine handlinger', action: 'Slå regel til' },
];

// Derived figures — the screen shows only these.
export const derived = (() => {
  const needsReply = mails.filter((x) => x.needsReply);
  const unread = mails.filter((x) => x.unread);
  const upcoming = events.filter((e) => e.end > NOW.minutes);
  const next = upcoming.find((e) => e.start > NOW.minutes);
  const minsToNext = next.start - NOW.minutes;
  const notesToday = notes.filter((n) => /^\d\d\.\d\d$/.test(n.edited));
  const focusMins = events.filter((e) => e.focus).reduce((s, e) => s + (e.end - e.start), 0);
  return { needsReply, unread, upcoming, next, minsToNext, notesToday, focusMins, eventCount: events.length };
})();

console.assert(derived.needsReply.length === 3, 'needs reply = 3');
console.assert(derived.next.id === 'e2' && derived.minsToNext === 18, 'next is e2 in 18 min');
console.assert(derived.unread.length === 5, 'unread = 5');
console.assert(derived.focusMins === 90, 'focus 90 min');

export const fmt = {
  hm: (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}.${String(mins % 60).padStart(2, '0')}`,
  dur: (mins) => (mins >= 60 ? `${Math.floor(mins / 60)} t${mins % 60 ? ' ' + (mins % 60) + ' m' : ''}` : `${mins} min`),
};

// ---------- Goals ----------
// kind: 'measure' (value toward a target), 'milestones' (steps), 'habit' (times per week)
export const goals = [
  { id: 'g1', title: 'Løb 500 km i 2026', area: 'Sundhed', kind: 'measure', unit: 'km', start: '2026-01-01', due: '2026-12-31', dueLabel: '31. dec',
    monthly: [['jan', 38], ['feb', 35], ['mar', 44], ['apr', 46], ['maj', 48], ['jun', 40], ['jul', 32], ['aug', 45], ['sep', 42], ['okt', 42]], target: 500,
    updates: [
      { when: 'I dag 08.15', delta: '+5,2 km', text: 'Fælledparken, rolig tur.', src: 'Fra Løbetur i kalenderen · godkendt af dig' },
      { when: 'Lør 24. okt', delta: '+8,0 km', text: 'Langtur langs søerne. Knæet holdt fint.', src: 'Skrevet af dig' },
      { when: 'Ons 21. okt', delta: '+6,4 km', text: '', src: 'Fra Løbetur i kalenderen · godkendt af dig' },
    ], links: ['Løbetur · man, ons, lør 07.30'] },
  { id: 'g2', title: 'SmartLink 1.0 udgivet', area: 'Projekter', kind: 'milestones', due: '2026-12-01', dueLabel: '1. dec',
    steps: [['DMX-mapping v2', true], ['Wolfmix-integration', true], ['Neon Tube PIX via CONNECT', true], ['Stabil ILDA-udgang på DS-3000', false], ['Beta til 3 testere', false], ['Udgivelse via GitHub releases', false]],
    updates: [{ when: 'I går 22.14', delta: '3 af 6', text: 'Neon Tube PIX kører på univers 2.', src: 'Fra noten SmartLink — DMX-mapping v2' }] },
  { id: 'g3', title: 'Lysplan til julekoncert leveret', area: 'Arbejde', kind: 'milestones', due: '2026-10-29', dueLabel: 'tor 29. okt',
    steps: [['Rig bekræftet', true], ['Laser opdateret', true], ['Cue-liste', false], ['Skitse af scenen', false], ['Sendt til Mads', false]],
    updates: [{ when: 'I dag 08.58', delta: '2 af 5', text: 'Rig og laser på plads.', src: 'Fra noten Lysplan — julekoncert' }] },
  { id: 'g4', title: 'Læs 12 bøger i 2026', area: 'Privat', kind: 'measure', unit: 'bøger', due: '2026-12-31', dueLabel: '31. dec', value: 9, target: 12,
    updates: [{ when: 'Søn 18. okt', delta: '+1 bog', text: 'Færdig med "Lyset i mørket".', src: 'Skrevet af dig' }] },
  { id: 'g5', title: 'Styrketræning 2 gange om ugen', area: 'Sundhed', kind: 'habit', perWeek: 2, thisWeek: 0, last4: [2, 2, 1, 2],
    updates: [{ when: 'Fre 23. okt', delta: '2 af 2', text: 'Uge 43 klaret.', src: 'Skrevet af dig' }] },
];

const DAY = 86400000;
const today = new Date('2026-10-26T12:00:00');
export const goalStats = (g) => {
  if (g.kind === 'measure') {
    const value = g.monthly ? g.monthly.reduce((s, [, v]) => s + v, 0) : g.value;
    const left = g.target - value;
    const daysLeft = Math.round((new Date(g.due + 'T12:00:00') - today) / DAY);
    const daysGone = g.start ? Math.round((today - new Date(g.start + 'T12:00:00')) / DAY) : null;
    const needPerWeek = (left / daysLeft) * 7;
    const pacePerWeek = daysGone ? (value / daysGone) * 7 : null;
    const onTrack = pacePerWeek == null ? true : pacePerWeek >= needPerWeek;
    return { value, ratio: value / g.target, left, daysLeft, needPerWeek, pacePerWeek, onTrack, label: `${value} af ${g.target} ${g.unit}` };
  }
  if (g.kind === 'milestones') {
    const done = g.steps.filter(([, d]) => d).length;
    const daysLeft = Math.round((new Date(g.due + 'T12:00:00') - today) / DAY);
    const onTrack = daysLeft > 7 || done / g.steps.length >= 0.8;
    return { value: done, ratio: done / g.steps.length, daysLeft, onTrack, label: `${done} af ${g.steps.length} trin` };
  }
  const recent = g.last4.reduce((s, v) => s + v, 0);
  return { value: g.thisWeek, ratio: g.thisWeek / g.perWeek, onTrack: recent >= g.perWeek * 4 * 0.75, label: `${g.thisWeek} af ${g.perWeek} denne uge`, recent };
};
const gs = goals.map(goalStats);
console.assert(gs[0].value === 412 && gs[0].left === 88 && gs[0].daysLeft === 66, 'run goal 412/500, 66 days');
console.assert(gs[0].needPerWeek.toFixed(1) === '9.3' && gs[0].pacePerWeek.toFixed(1) === '9.7', 'pace');
console.assert(gs[2].onTrack === false, 'lysplan needs action');

suggestions.push({ id: 's4', kind: 'goal', title: 'Log 5,2 km på Løb 500 km i 2026?', detail: 'Fra Løbetur i morges 07.30–08.15.', source: 'Lært: du logger altid dine løbeture', action: 'Log' });
