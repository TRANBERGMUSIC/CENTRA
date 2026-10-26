import { NOW, user, accounts, events, people, mails, thread_m1, notes, suggestions, derived, fmt, goals, goalStats } from './data.js';
import { ic } from './icons.js';

const q = new URLSearchParams(location.search);
const dir = q.get('dir') || 'a';
const screen = q.get('screen') || 'home';
document.body.dataset.dir = dir;
document.body.dataset.screen = screen;
document.documentElement.dataset.theme = q.get('theme') || (dir === 'a' ? 'dark' : 'light');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const P = (id) => people[id];
const av = (p, cls = '') => `<span class="avatar ${cls}" style="--h:${p.hue}">${p.initials}</span>`;
const acct = (id) => accounts.find((a) => a.id === id);
const ev = (id) => events.find((e) => e.id === id);
const { next, minsToNext, needsReply } = derived;
const dark = document.documentElement.dataset.theme !== 'light';
const iconSrc = dark ? 'brand/app-icon-dark.png' : 'brand/app-icon-light.png';
const wordmark = `<svg class="brand__word" viewBox="-6 -6 1012 112" fill="none" stroke="currentColor" stroke-width="9" aria-label="CENTRA" role="img"><path d="M100,17 A58,45.5 0 1 0 100,83"/><path d="M268,4.5 H178.5 V95.5 H268 M178.5,50 H262"/><path d="M346.5,100 V8 L433.5,92 V0"/><path d="M498,4.5 H600 M549,4.5 V100"/><path d="M668.5,100 V4.5 H726 A24.75,24.75 0 0 1 726,54 H668.5 M716,54 L762,100"/><path d="M826,100 L878,6 L930,100"/></svg>`;
const brandEl = `<a class="brand" href="#" aria-label="CENTRA, I dag"><img class="brand__icon" src="${iconSrc}" alt="">${wordmark}</a>`;

/* ---------------- Shell ---------------- */
const navItems = [
  ['home', 'today', 'I dag', ''],
  ['note', 'notes', 'Noter', ''],
  ['cal', 'calendar', 'Kalender', ''],
  ['inbox', 'inbox', 'Indbakke', `<span class="count is-due num" aria-label="${needsReply.length} venter på svar">${needsReply.length}</span>`],
  ['goals', 'goals', 'Mål', `<span class="count num">${goals.length}</span>`],
  ['assist', 'assist', 'Assist', `<span class="count num">${suggestions.length}</span>`],
];
const GS = goals.map((g) => ({ ...g, s: goalStats(g) }));
const onTrack = GS.filter((g) => g.s.onTrack).length;
const dueGoal = GS.find((g) => !g.s.onTrack);
const kmFmt = (n) => n.toFixed(1).replace('.', ',');
const goalRows = () => `<ul class="rows">${GS.map((g) => `<li class="goalrow"><div class="row__body"><div class="strong ellipsis">${esc(g.title)}</div><div class="meta">${g.area}${g.dueLabel ? ' · frist ' + g.dueLabel : ' · vane'}</div></div><div class="goalrow__bar"><div class="prog prog--sm ${g.s.onTrack ? '' : 'is-focus'}" style="--r:${Math.min(1, g.s.ratio).toFixed(3)}"><i></i></div><span class="meta num">${g.s.label}</span></div><span class="status ${g.s.onTrack ? '' : 'is-due'}">${g.s.onTrack ? 'På sporet' : 'Kræver handling'}</span></li>`).join('')}</ul>`;
const goalsPanel = (cls) => `<section class="panel ${cls}" aria-labelledby="h-goals"><div class="panel__head"><h2 id="h-goals" class="panel__title">Mål</h2><span class="panel__count num">${onTrack} af ${goals.length} på sporet</span><a class="panel__link" href="#">Alle mål</a></div>${goalRows()}</section>`;
const sidebar = (withBrand = true) => `
<aside class="sidebar" aria-label="Navigation">
  ${withBrand ? brandEl : ''}
  ${dir !== 'c' ? `<button class="searchbtn">${ic('search')}<span>Søg eller spørg</span><span class="kbd">⌘K</span></button>` : ''}
  <nav>${navItems.map(([k, i, l, c]) => `<a href="#" class="nav-item ${k === screen ? 'is-active' : ''}">${ic(i)}<span>${l}</span>${c}</a>`).join('')}</nav>
  <div class="nav-group">Fastgjort</div>
  ${notes.filter((n) => n.pinned).map((n) => `<a href="#" class="nav-sub">${ic('pin', 'ic--sm')}<span>${esc(n.title)}</span></a>`).join('')}
  <div class="nav-group">Konti</div>
  ${accounts.map((a) => `<a href="#" class="nav-sub">${ic('inbox', 'ic--sm')}<span>${a.label}</span><span class="meta" style="margin-left:auto">${a.kind}</span></a>`).join('')}
  <div class="sidebar__foot">
    <div class="syncline"><span class="dot"></span>Synkroniseret ${NOW.time.replace(':', '.')} · 3 enheder</div>
    <a href="#" class="nav-sub">${ic('settings', 'ic--sm')}<span>Indstillinger</span></a>
    <div class="userrow"><span class="avatar" style="--h:205">${user.initials}</span><div>${user.name}<small>4 konti</small></div></div>
  </div>
</aside>`;

const tabbar = () => `<nav class="tabbar" aria-label="Faner">${navItems.filter(([k]) => k !== 'assist').map(([k, i, l]) => `<a href="#" class="${k === screen ? 'is-active' : ''}">${ic(i, 'ic--tab')}${l}${k === 'inbox' ? `<span class="badge num">${needsReply.length}</span>` : ''}</a>`).join('')}</nav>`;

const topbarC = () => `<header class="topbar">${brandEl}<button class="topsearch">${ic('search')}<span>Søg i noter, mails og kalender, eller spørg Assist</span><span class="kbd">⌘K</span></button><div class="topright"><span class="meta presence"><span class="dot"></span>Synkroniseret ${NOW.time.replace(':', '.')}</span><span class="avatar" style="--h:205">${user.initials}</span></div></header>`;

/* ---------------- Shared blocks ---------------- */
const DAY0 = 7 * 60, DAY1 = 23 * 60, SPAN = DAY1 - DAY0;
const frac = (mins) => ((mins - DAY0) / SPAN).toFixed(4);
const evState = (e) => (e.end <= NOW.minutes ? 'is-past' : e.id === next.id ? 'is-next' : e.focus ? 'is-focusblock' : '');

const daystrip = () => `
<div class="daystrip" role="img" aria-label="Dagen fra 07 til 23 med ${events.length} aftaler. Nu er klokken ${NOW.time.replace(':', '.')}.">
  <div class="daystrip__track">
    <div class="daystrip__callout num" style="--at:${frac(next.start)}">${esc(next.title)} · ${fmt.hm(next.start)}</div>
    ${events.map((e) => `<div class="daystrip__ev ${evState(e)} ${e.end - e.start < 60 ? 'is-narrow' : ''}" style="--start:${frac(e.start)};--len:${((e.end - e.start) / SPAN).toFixed(4)}"><b>${esc(e.title)}</b><span class="num">${fmt.hm(e.start)}${e.place ? ' · ' + esc(e.place) : ''}</span></div>`).join('')}
    <div class="daystrip__now" style="--at:${frac(NOW.minutes)}"></div>
  </div>
  <div class="daystrip__ticks meta num">${[7, 9, 11, 13, 15, 17, 19, 21, 23].map((h) => `<span style="--at:${frac(h * 60)}">${String(h).padStart(2, '0')}</span>`).join('')}</div>
</div>`;

const replyRows = (limit = 3, actions = true) => `<ul class="rows">${needsReply.slice(0, limit).map((x) => {
  const p = P(x.from);
  return `<li class="row">${av(p)}<div class="row__body"><div class="row__line"><span class="strong ellipsis">${p.name}</span><span class="meta num row__trail">${x.ago}</span></div><div class="row__line"><span class="ellipsis">${esc(x.subject)}</span></div><div class="row__line meta"><span>${acct(x.acct).label}</span>${x.id === 'm1' ? '<span class="pill pill--calm">' + ic('assist', 'ic--sm') + 'Udkast klar</span>' : ''}${actions ? '<span class="row__trail"><button class="btn btn--text btn--sm">' + ic('reply', 'ic--sm') + 'Svar</button></span>' : ''}</div></div></li>`;
}).join('')}</ul>`;

const suggRows = (limit = 3) => `<ul class="rows">${suggestions.slice(0, limit).map((s) => `
  <li class="sugg"><div class="strong">${esc(s.title)}</div>
  <div class="sugg__actions"><button class="btn btn--secondary btn--sm">${ic('check', 'ic--sm')}Godkend</button><button class="btn btn--text btn--sm" aria-label="Afvis">${ic('x', 'ic--sm')}</button></div>
  <div class="meta"><span class="muted">${esc(s.detail)}</span> · ${esc(s.source)}</div></li>`).join('')}</ul>`;

const noteRows = (limit = 4) => `<ul class="rows">${notes.slice(0, limit).map((n) => `<li class="row">${ic(n.auto ? 'calendar' : 'notes')}<div class="row__body"><div class="row__line"><span class="strong ellipsis">${esc(n.title)}</span><span class="meta num row__trail">${n.edited}</span></div><div class="row__line meta"><span class="ellipsis">${esc(n.folder)}${n.auto ? ' · oprettet til mødet 14.00' : ''}</span></div></div></li>`).join('')}</ul>`;

const phoneHead = (title, right = '') => `<div class="phonehead"><span class="strong">${title}</span><span style="margin-left:auto;display:flex;gap:8px">${right}</span></div>`;

/* ---------------- HOME ---------------- */
const finding = `Mads venter på lysplanen, og I ses kl. ${fmt.hm(next.start)}.`;

function homeA() {
  return `<div class="app">${sidebar()}<main class="canvas">
  <div class="pull" aria-hidden="true">${ic('search', 'ic--sm')}Træk ned for at søge</div>
  <div class="titlerow"><div><h1>God morgen, ${user.name}</h1><p>${NOW.label}. ${finding}</p></div>
    <div class="actions"><button class="btn btn--secondary">${ic('calendar')}Find tid</button><button class="btn btn--secondary">${ic('plus')}Ny note<span class="kbd">⌘N</span></button></div></div>
  <div class="grid12">
    <section class="panel span-12" aria-labelledby="h-day"><div class="panel__head"><h2 id="h-day" class="panel__title">Din dag</h2><span class="panel__count num">${events.length} aftaler · ${fmt.dur(derived.focusMins)} fokustid</span><a class="panel__link" href="#">Åbn kalender</a></div>${daystrip()}</section>
    <section class="panel span-5 focuscard" aria-labelledby="h-next">
      <div class="panel__head"><h2 id="h-next" class="panel__title">Næste</h2><span class="pill pill--focus num">om ${minsToNext} min</span></div>
      <div class="nextname">${esc(next.title)}</div>
      <div class="muted num">${fmt.hm(next.start)}–${fmt.hm(next.end)} · ${next.place} · ${next.with}</div>
      <ul class="rows" style="margin:16px 0">
        <li class="row">${ic('notes')}<div class="row__body"><div class="row__line"><span class="ellipsis">${esc(notes[0].title)}</span><span class="meta row__trail num">${notes[0].editedLabel}</span></div></div></li>
        <li class="row">${ic('inbox')}<div class="row__body"><div class="row__line"><span class="ellipsis">${P('mads').name}: ${esc(mails[0].subject)}</span><span class="meta row__trail num">${mails[0].when}</span></div></div></li>
      </ul>
      <button class="btn btn--primary">${ic('video')}Deltag i Teams</button>
    </section>
    <section class="panel span-7" aria-labelledby="h-reply"><div class="panel__head"><h2 id="h-reply" class="panel__title">Venter på dit svar</h2><span class="panel__count num">${needsReply.length}</span><a class="panel__link" href="#">Åbn indbakke</a></div>${replyRows()}</section>
    <section class="panel span-7" aria-labelledby="h-sugg"><div class="panel__head"><h2 id="h-sugg" class="panel__title">Forslag fra Assist</h2><span class="panel__count num">${suggestions.length}</span><a class="panel__link" href="#">Det ved CENTRA om dig</a></div>${suggRows()}</section>
    <section class="panel span-5" aria-labelledby="h-notes"><div class="panel__head"><h2 id="h-notes" class="panel__title">Seneste noter</h2><a class="panel__link" href="#">Alle noter</a></div>${noteRows(4)}</section>
    ${goalsPanel('span-12')}
  </div></main>${tabbar()}</div>`;
}

function homeB() {
  const agenda = events.map((e) => {
    const nowBefore = e.start > NOW.minutes && events.filter((x) => x.start <= NOW.minutes && x.id !== e.id).length && e.id === next.id;
    return `${nowBefore ? `<li class="nowline" aria-hidden="true"><span class="num">Nu ${NOW.time.replace(':', '.')}</span></li>` : ''}<li class="${evState(e)}"><span class="t num">${fmt.hm(e.start)}<span class="t-end">–${fmt.hm(e.end)}</span></span><span><span class="${e.id === next.id ? 'strong' : ''}">${esc(e.title)}</span>${e.place ? `<span class="meta"> · ${esc(e.place)}</span>` : ''}</span><span class="meta">${e.id === next.id ? `<span class="pill pill--focus">om ${minsToNext} min</span>` : e.note ? 'Note koblet på' : e.focus ? 'Fokusblok' : e.cal}</span></li>`;
  }).join('');
  return `<div class="app">${sidebar()}<main class="canvas"><div class="column">
  <div class="pull" aria-hidden="true">${ic('search', 'ic--sm')}Træk ned for at søge</div>
  <h1 class="greet">God morgen, ${user.name}.</h1>
  <p class="greet-sub">${NOW.label}. ${finding}</p>
  <div class="grid12" style="margin-top:40px">
    <div class="tile span-3"><span class="muted">Aftaler i dag</span><span class="tile__value num">${events.length}</span><span class="tile__cap num">Næste ${fmt.hm(next.start)}, om ${minsToNext} min</span></div>
    <div class="tile span-3 is-focus"><span class="muted">Venter på dit svar</span><span class="tile__value num">${needsReply.length}</span><span class="tile__cap">Ældste fra i går 16.42</span></div>
    <div class="tile span-3"><span class="muted">Forslag fra Assist</span><span class="tile__value num">${suggestions.length}</span><span class="tile__cap">Intet sker uden dit ja</span></div>
    <div class="tile span-3"><span class="muted">Mål på sporet</span><span class="tile__value num">${onTrack} af ${goals.length}</span><span class="tile__cap">${esc(dueGoal.title)} ${dueGoal.dueLabel}</span></div>
    <section class="panel panel--white span-9" aria-labelledby="h-ag"><div class="panel__head"><h2 id="h-ag" class="panel__title">Dagens program</h2><span class="panel__count num">${events.length} aftaler</span><a class="panel__link" href="#">Åbn kalender</a></div><ul class="agenda">${agenda}</ul></section>
    <section class="panel span-3" aria-labelledby="h-n"><div class="panel__head"><h2 id="h-n" class="panel__title">Seneste noter</h2></div>${noteRows(4).replace(/<svg[^>]*>.*?<\/svg>/g, '')}</section>
    <section class="panel span-6" aria-labelledby="h-r"><div class="panel__head"><h2 id="h-r" class="panel__title">Venter på dit svar</h2><span class="panel__count num">${needsReply.length}</span><a class="panel__link" href="#">Åbn indbakke</a></div>${replyRows()}</section>
    <section class="panel span-6" aria-labelledby="h-s"><div class="panel__head"><h2 id="h-s" class="panel__title">Forslag fra Assist</h2><span class="panel__count num">${suggestions.length}</span><a class="panel__link" href="#">Det ved CENTRA om dig</a></div>${suggRows()}</section>
    ${goalsPanel('span-12')}
  </div></div></main>${tabbar()}</div>`;
}

function homeC() {
  const hours = [7, 9, 11, 13, 15, 17, 19, 21, 23];
  const queue = [
    ...needsReply.map((x) => ({ icon: av(P(x.from)), t: `${P(x.from).name} · ${x.subject}`, d: x.id === 'm1' ? 'Svarudkast klar i din tone' : x.preview, meta: x.ago, act: `<span class="kbd">R</span> Svar` })),
    ...suggestions.map((s) => ({ icon: `<span class="qicon">${ic('assist')}</span>`, t: s.title, d: `${s.detail} · ${s.source}`, meta: '', act: `<button class="btn btn--secondary btn--sm">Godkend</button><button class="btn btn--text btn--sm" aria-label="Afvis">${ic('x', 'ic--sm')}</button>` })),
    { icon: `<span class="qicon">${ic('notes')}</span>`, t: notes[2].title, d: 'Oprettet automatisk til mødet 14.00. Dagsorden mangler.', meta: '07.00', act: '<span class="kbd">↵</span> Åbn' },
  ];
  return `<div class="app">${topbarC()}${sidebar(false)}<main class="sheet"><div class="sheet__pad">
  <div class="pull" aria-hidden="true">${ic('search', 'ic--sm')}Træk ned for at søge</div>
  <div class="titlerow"><div><h1>I dag</h1><p class="muted">${NOW.label} · næste: ${esc(next.title)} om ${minsToNext} min</p></div><div class="actions"><button class="btn btn--secondary">${ic('calendar')}Find tid</button><button class="btn btn--primary">${ic('plus')}Ny note</button></div></div>
  <div class="kpis"><div><span class="meta">Aftaler i dag</span><div class="v num">${events.length}</div></div><div class="is-focus"><span class="meta">Venter på dit svar</span><div class="v num">${needsReply.length}</div></div><div><span class="meta">Forslag fra Assist</span><div class="v num">${suggestions.length}</div></div><div><span class="meta">Mål på sporet</span><div class="v num">${onTrack} af ${goals.length}</div></div></div>
  <div class="work">
    <section class="box" aria-labelledby="h-cal"><div class="box__head"><h2 id="h-cal" class="panel__title">Kalender</h2><span class="panel__count">Mandag</span></div><div style="padding:16px 0">
      <div class="timegrid">${hours.map((h) => `<div class="timegrid__h num" style="--at:${frac(h * 60)}"><span>${String(h).padStart(2, '0')}.00</span></div>`).join('')}
      ${events.map((e) => `<div class="timegrid__ev ${evState(e)}" style="--start:${frac(e.start)};--len:${((e.end - e.start) / SPAN).toFixed(4)}"><b>${esc(e.title)}</b>${e.end - e.start >= 60 ? `<div class="meta num">${fmt.hm(e.start)}–${fmt.hm(e.end)}${e.place ? ' · ' + esc(e.place) : ''}</div>` : ''}</div>`).join('')}
      <div class="timegrid__now" style="--at:${frac(NOW.minutes)}"></div></div></div></section>
    <section class="box" aria-labelledby="h-q"><div class="box__head"><h2 id="h-q" class="panel__title">Din kø</h2><span class="panel__count num">${queue.length}</span><div style="margin-left:auto" class="tabs" role="tablist"></div><span class="meta" style="margin-left:auto">Mails ${needsReply.length} · Forslag ${suggestions.length} · Noter 1</span></div>
      <ul class="queue">${queue.map((r, i) => `<li class="${i === 0 ? 'is-selected' : ''}">${r.icon}<div class="row__body"><div class="row__line"><span class="strong ellipsis">${esc(r.t)}</span></div><div class="row__line meta"><span class="ellipsis">${esc(r.d)}</span></div></div><div style="display:flex;gap:8px;align-items:center" class="meta">${r.meta ? `<span class="num">${r.meta}</span>` : ''}${r.act}</div></li>`).join('')}</ul>
      <div class="keys meta"><span><span class="kbd">J</span><span class="kbd">K</span>flyt</span><span><span class="kbd">↵</span>åbn</span><span><span class="kbd">E</span>arkivér</span><span><span class="kbd">R</span>svar</span><span><span class="kbd">Y</span>godkend</span></div>
    </section>
  </div></div></main>${tabbar()}</div>`;
}

/* ---------------- NOTE ---------------- */
const n1 = notes[0];
const docBody = (withSlash) => `
  <h1>${esc(n1.title)}</h1>
  <div class="docmeta"><span class="linkchip">${ic('calendar')}Møde i dag ${fmt.hm(ev('e2').start)} · ${P('mads').name}</span><span class="linkchip">${ic('inbox')}Mail fra Mads · 09.03</span><span class="tag">#lys</span><span class="tag">#julekoncert</span></div>
  <p>Koncerthuset, Studie 1, lørdag 19. december. Mads har bekræftet scenen; vi skal have et første udkast klar torsdag, så hazer og ekstra truss kan nå at blive bestilt.</p>
  <h2>Rig</h2>
  <div class="check is-done"><span class="check__box">${ic('check', 'ic--sm')}</span><span class="check__label">6 movingheads fra Lydhuset bekræftet</span></div>
  <div class="check is-done"><span class="check__box">${ic('check', 'ic--sm')}</span><span class="check__label">DS-3000RGB MK5 med firmware 1.4.2</span></div>
  <div class="check"><span class="check__box"></span><span class="check__label">Mål på truss fra Mads</span></div>
  <div class="check"><span class="check__box"></span><span class="check__label">Neon Tube PIX langs scenekanten, 8 stk.</span></div>
  <h2>Cues</h2>
  <table class="doctable"><thead><tr><th>Scene</th><th>Fixtures</th><th>Cue</th><th class="num">Varighed</th></tr></thead><tbody>
    <tr><td>Indgang</td><td>Movingheads, varm hvid</td><td>Q1</td><td class="num">4 min</td></tr>
    <tr><td>Første sæt</td><td>Neon Tube PIX, langsomt fade</td><td>Q2–Q7</td><td class="num">38 min</td></tr>
    <tr><td>Finale</td><td>Laser, tunnel over publikum</td><td>Q8</td><td class="num">6 min</td></tr>
  </tbody></table>
  <h2>Til Mads torsdag</h2>
  <p>Send cue-listen og en skitse. DMX-adresserne følger <span class="wl">SmartLink — DMX-mapping v2</span>, så Wolfmix kan styre det hele fra ét univers.</p>
  <p class="muted" style="position:relative">${withSlash ? '/<span class="caret"></span>' : ''}</p>
  ${withSlash ? `<ul class="slash" role="listbox" aria-label="Indsæt blok" style="left:0;margin-top:-4px">
    <li class="is-active">${ic('check')}Tjekliste<span class="meta">[]</span></li><li>${ic('hash')}Overskrift<span class="meta">#</span></li><li>${ic('menu')}Tabel</li><li>${ic('edit')}Kode<span class="meta">\`\`\`</span></li><li>${ic('paperclip')}Billede eller fil</li><li>${ic('mic')}Lydnote</li><li>${ic('link')}Link med forhåndsvisning</li><li>${ic('assist')}Spørg Assist</li></ul>` : ''}
`;

function noteA() {
  return `<div class="app">${sidebar()}<main class="notes2">
  <div class="nlist"><h1>Noter</h1><div class="tabs" style="padding:0 8px"><a class="tab is-active">Alle <span class="meta num">${notes.length}</span></a><a class="tab">Fastgjort <span class="meta num">2</span></a><a class="tab">Møder</a></div>
    <div style="margin-top:8px">${notes.map((n, i) => `<a href="#" class="nrow ${i === 0 ? 'is-selected' : ''}"><div class="nrow__t"><span class="ellipsis">${esc(n.title)}</span>${n.pinned ? `<span style="margin-left:auto;color:var(--c-faint)">${ic('pin', 'ic--sm')}</span>` : ''}</div><div class="nrow__x">${esc(n.excerpt)}</div><div class="meta num" style="margin-top:4px">${n.editedLabel}</div></a>`).join('')}</div></div>
  <div class="editor">
    ${phoneHead(`${ic('chevron-left')}Noter`, ic('more'))}
    <div class="editor__bar"><span>${esc(n1.folder)}</span><span class="right"><span class="presence"><span class="dot"></span>Også åben på iPad</span><span class="num">Redigeret ${n1.edited}</span><button class="btn btn--text btn--sm">${ic('clock', 'ic--sm')}Historik</button><button class="btn btn--text btn--sm" aria-label="Mere">${ic('more', 'ic--sm')}</button></span></div>
    <article class="doc">${docBody(true)}</article>
  </div></main>${tabbar()}</div>`;
}

function noteB() {
  return `<div class="app">${sidebar()}<main class="notesB">
  <div class="editor">
    ${phoneHead(`${ic('chevron-left')}Noter`, ic('more'))}
    <div class="editor__bar"><span>${esc(n1.folder)}</span><span class="right"><span class="presence"><span class="dot"></span>Også åben på iPad</span><span class="num">Redigeret ${n1.edited}</span></span></div>
    <article class="doc">${docBody(true)}</article>
  </div>
  <aside class="rail" aria-label="Detaljer">
    <div class="dsec"><div class="dsec__title">Koblet til</div>
      <div class="row">${ic('calendar')}<div class="row__body"><div>${esc(ev('e2').title)}</div><div class="meta num">I dag ${fmt.hm(ev('e2').start)}–${fmt.hm(ev('e2').end)} · Teams</div></div></div>
      <div class="row">${ic('inbox')}<div class="row__body"><div>${P('mads').name}</div><div class="meta">Lysplan til julekoncerten · 09.03</div></div></div></div>
    <div class="dsec"><div class="dsec__title">Linket fra</div><div class="row">${ic('notes')}<div class="row__body"><div>${esc(notes[1].title)}</div><div class="meta">${notes[1].editedLabel}</div></div></div></div>
    <div class="dsec"><div class="dsec__title">Historik</div>
      ${[['I dag 08.58', 'iPhone'], ['I dag 08.41', 'MacBook'], ['I går 23.10', 'MacBook'], ['Fre 23. okt 09.15', 'Oprettet fra mail']].map(([t, d]) => `<div class="kv"><span class="num">${t}</span><span class="meta">${d}</span></div>`).join('')}</div>
    <div class="dsec"><div class="dsec__title">Assist</div><p class="muted">Lav en cue-liste ud fra noten, eller opsummér den til Mads.</p><button class="btn btn--secondary btn--sm" style="margin-top:8px">${ic('assist', 'ic--sm')}Opsummér</button></div>
  </aside></main>${tabbar()}</div>`;
}

function noteC() {
  return `<div class="app">${topbarC()}${sidebar(false)}<main class="sheet"><div class="notes3">
  <div class="nlist"><h1>Noter</h1><div class="tabs" style="padding:0 8px"><a class="tab is-active">Alle <span class="meta num">${notes.length}</span></a><a class="tab">Projekter</a><a class="tab">Møder</a></div>
    <div style="margin-top:8px">${notes.map((n, i) => `<a href="#" class="nrow ${i === 0 ? 'is-selected' : ''}"><div class="nrow__t"><span class="ellipsis">${esc(n.title)}</span><span class="meta num" style="margin-left:auto;font-weight:400">${n.edited}</span></div><div class="nrow__x">${esc(n.excerpt)}</div></a>`).join('')}</div></div>
  <div class="editor">
    ${phoneHead(`${ic('chevron-left')}Noter`, ic('more'))}
    <div class="editor__bar"><span>Noter / ${esc(n1.folder)}</span><span class="right"><span class="presence"><span class="dot"></span>Også åben på iPad</span><button class="btn btn--text btn--sm">${ic('clock', 'ic--sm')}Historik</button></span></div>
    <article class="doc"><h1>${esc(n1.title)}</h1>
      <div class="props"><div class="meta">Møde</div><div>${ic('calendar', 'ic--sm')}${esc(ev('e2').title)} · i dag ${fmt.hm(ev('e2').start)}</div><div class="meta">Mail</div><div>${ic('inbox', 'ic--sm')}${P('mads').name} · 09.03</div><div class="meta">Tags</div><div><span class="tag">#lys</span><span class="tag">#julekoncert</span></div><div class="meta">Redigeret</div><div class="num">I dag 08.58 på iPhone</div></div>
      ${docBody(true).replace(/<h1>.*?<\/h1>\s*<div class="docmeta">.*?<\/div>/s, '')}</article>
  </div></div></main>${tabbar()}</div>`;
}

/* ---------------- INBOX ---------------- */
const inboxInner = () => {
  const m1 = mails[0];
  const rows = mails.filter((x) => !['Nyhedsbreve', 'Notifikationer'].includes(x.cat));
  const tabs = [['Indbakke', rows.length, true], ['Venter på svar', needsReply.length], ['Kvitteringer', mails.filter((x) => x.cat === 'Kvitteringer').length]];
  return `<div class="inbox">
  <div class="mlist">
    
    <div class="mlist__head"><div style="display:flex;align-items:center;gap:8px"><h1>Indbakke</h1><span class="meta">Alle 4 konti</span><button class="btn btn--text btn--sm" style="margin-left:auto" aria-label="Skriv ny mail">${ic('edit', 'ic--sm')}</button></div>
      <div class="tabs" role="tablist">${tabs.map(([l, c, a]) => `<a class="tab ${a ? 'is-active' : ''}" role="tab">${l} <span class="meta num">${c}</span></a>`).join('')}</div></div>
    <div class="mrows">${rows.map((x, i) => {
      const p = P(x.from);
      return `<a href="#" class="mrow ${x.unread ? 'is-unread' : ''} ${i === 0 ? 'is-selected' : ''}">${x.unread ? '<span class="unread-dot" aria-label="Ulæst"></span>' : ''}${av(p)}<div class="mrow__body"><div class="mrow__who"><b class="ellipsis">${p.name}</b><span class="meta num mrow__time">${x.when}</span></div><div class="mrow__subj ellipsis">${esc(x.subject)}</div><div class="mrow__mark meta"><span>${acct(x.acct).label}</span>${x.needsReply ? '<span class="pill pill--focus">Venter på svar</span>' : x.cat === 'Kvitteringer' ? `<span>${ic('paperclip', 'ic--sm')}</span><span>Kvittering</span>` : x.cat === 'Invitationer' ? '<span>Invitation</span>' : ''}</div></div></a>`;
    }).join('')}
      <div class="meta" style="padding:12px 8px">Arkiveret automatisk i dag: 1 nyhedsbrev og 1 notifikation. <a href="#" class="muted">Vis</a></div></div>
  </div>
  <div class="reader">
    <h2>${esc(m1.subject)}</h2>
    <div class="meta" style="margin-top:4px">${m1.thread} beskeder · ${acct(m1.acct).label} · ${acct(m1.acct).kind}</div>
    <div class="summary"><div class="summary__head">${ic('assist')}Resumé fra Assist</div><ul>
      <li>Lydhuset har julekoncerten i Koncerthuset 19. december og vil have dig på lyset.</li>
      <li>Mads beder om et første udkast til lysplanen torsdag 29. oktober.</li>
      <li>Rig: 6 movingheads og din laser. Hazer og truss bestilles efter dit udkast.</li></ul>
      <div class="meta" style="margin-top:8px">Kilder: 4 mails i tråden</div></div>
    ${thread_m1.slice(0, 3).map((t) => `<div class="msg-collapsed">${t.from === 'me' ? `<span class="avatar" style="--h:205">${user.initials}</span>` : av(P(t.from))}<span class="strong">${t.from === 'me' ? 'Dig' : P(t.from).name}</span><span class="ellipsis muted" style="flex:1">${esc(t.body.replace(/\n+/g, ' '))}</span><span class="meta num">${t.when}</span></div>`).join('')}
    <div class="msg"><div class="msg__head">${av(P('mads'), 'avatar--lg')}<div><div class="strong">${P('mads').name}</div><div class="meta">${P('mads').email} · til dig</div></div><span class="meta num" style="margin-left:auto">${thread_m1[3].when}</span></div><div class="msg__body">${esc(thread_m1[3].body)}</div></div>
    <div class="composer"><div class="composer__ai">${ic('assist', 'ic--sm')}Udkast fra Assist i din tone · ret frit, intet sendes uden dig</div>
      <div class="composer__body">Hej Mads

Torsdag passer fint, du får udkastet inden kl. 12. Kan du sende mål på truss og højden til loftet i Studie 1?

Bedste
Willads</div>
      <div class="composer__bar"><button class="btn btn--primary">${ic('send', 'ic--sm')}Send</button><button class="btn btn--secondary">Send og arkivér</button><button class="btn btn--text">Planlæg</button><button class="btn btn--text" style="margin-left:auto">Afvis udkast</button></div></div>
  </div>
  <aside class="details" aria-label="Kontakt">
    <div style="display:flex;gap:12px;align-items:center">${av(P('mads'), 'avatar--lg')}<div><div class="strong">${P('mads').name}</div><div class="meta">${P('mads').org} · ${P('mads').email}</div></div></div>
    <div class="dsec" style="margin-top:24px"><div class="dsec__title">Næste møde</div><div class="row" style="padding-left:0">${ic('calendar')}<div class="row__body"><div>${esc(ev('e2').title)}</div><div class="meta num">I dag ${fmt.hm(ev('e2').start)}, om ${minsToNext} min</div></div></div></div>
    <div class="dsec"><div class="dsec__title">Noter</div><div class="row" style="padding-left:0">${ic('notes')}<div class="row__body"><div>${esc(n1.title)}</div><div class="meta">${n1.editedLabel}</div></div></div></div>
    <div class="dsec"><div class="dsec__title">Seneste korrespondance</div>
      ${[['Lysplan til julekoncerten', 'I dag'], ['Invitation: Produktionsmøde', 'I dag'], ['Lyd til sommerfesten', '14. aug']].map(([s, d]) => `<div class="kv"><span class="ellipsis">${s}</span><span class="meta num">${d}</span></div>`).join('')}</div>
    <div class="dsec"><div class="dsec__title">CENTRA ved</div><p class="muted" style="font-size:12px;line-height:18px">Du svarer typisk Mads inden for 2 timer og skriver kort. <a href="#" class="tag">Ret</a></p></div>
  </aside></div>`;
};

function inboxA() { return `<div class="app">${sidebar()}<main>${inboxInner()}</main>${tabbar()}</div>`; }
function inboxB() { return inboxA(); }
function inboxC() { return `<div class="app">${topbarC()}${sidebar(false)}<main class="sheet">${inboxInner()}</main>${tabbar()}</div>`; }

/* ---------------- GOALS ---------------- */
const goalsInner = () => {
  const g = GS[0], s = g.s;
  const max = 60, W = 640, H = 180, bw = 36, gap = (W - 12 * bw) / 11;
  const months = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
  const y = (v) => H - (v / max) * H;
  const ref = 500 / 12;
  const svg = `<svg viewBox="-28 -12 ${W + 40} ${H + 36}" role="img" aria-label="Km pr. måned, januar til oktober, mod tempoet for 500 km">
    ${[0, 20, 40, 60].map((v) => `<line class="grid" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="-8" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${months.map((m, i) => { const d = g.monthly[i]; const x = i * (bw + gap); return `${d ? `<rect class="bar ${i === 9 ? 'is-now' : ''}" x="${x}" y="${y(d[1])}" width="${bw}" height="${H - y(d[1])}"/>` : ''}<text x="${x + bw / 2}" y="${H + 20}" text-anchor="middle">${m}</text>`; }).join('')}
    <line class="ref" x1="0" x2="${W}" y1="${y(ref)}" y2="${y(ref)}"/><text x="${W}" y="${y(ref) - 6}" text-anchor="end">41,7 km/md giver 500 km</text>
  </svg>`;
  const section = (title, list) => `<div class="gsec">${title}</div>${list.map((x) => `<a href="#" class="gitem ${x.id === g.id ? 'is-selected' : ''}"><div class="gitem__t"><span class="strong ellipsis">${esc(x.title)}</span><span class="meta num">${x.dueLabel || 'vane'}</span></div><div class="prog prog--sm ${x.s.onTrack ? '' : 'is-focus'}" style="--r:${Math.min(1, x.s.ratio).toFixed(3)}"><i></i></div><div class="meta num" style="margin-top:6px">${x.s.label}</div></a>`).join('')}`;
  return `<div class="goals">
  <div class="glist"><h1>Mål <span class="meta num">${goals.length}</span><button class="btn btn--secondary btn--sm">${ic('plus', 'ic--sm')}Nyt mål</button></h1>
    ${section('Kræver handling', GS.filter((x) => !x.s.onTrack))}${section('På sporet', GS.filter((x) => x.s.onTrack))}</div>
  <div class="gdetail">
    ${phoneHead(`${ic('chevron-left')}Mål`, ic('more'))}
    <div class="meta">${g.area} · tal-mål · frist ${g.dueLabel}</div>
    <h2>${esc(g.title)}</h2>
    <div class="gfig"><b class="num">${s.value}</b><span class="muted num">af ${g.target} ${g.unit}</span><span class="status" style="margin-left:auto">På sporet</span></div>
    <div class="prog" style="--r:${s.ratio.toFixed(3)}"><i></i></div><div class="prog__ends meta num"><span>0</span><span>${g.target} ${g.unit}</span></div>
    <p class="gfinding"><span class="strong num">${s.left} km tilbage på ${s.daysLeft} dage</span> kræver ${kmFmt(s.needPerWeek)} km om ugen. Du har løbet ${kmFmt(s.pacePerWeek)} km om ugen i snit i år.</p>
    <div class="gupdate"><span class="field">+ <b class="num">5,2</b> km</span><span class="field">Skriv hvad der skete …</span><button class="btn btn--primary">Log opdatering</button></div>
    <div class="gchart"><div class="panel__head"><h3 class="panel__title">Km pr. måned</h3><span class="panel__count">2026</span></div>${svg}</div>
    <div class="glog"><div class="panel__head"><h3 class="panel__title">Opdateringer</h3><span class="panel__count num">${g.updates.length} seneste</span></div>
      <ul>${g.updates.map((u) => `<li><span class="meta num">${u.when}</span><span class="strong num">${u.delta}</span><span>${u.text ? esc(u.text) + '<br>' : ''}<span class="meta">${esc(u.src)}</span></span></li>`).join('')}</ul></div>
  </div>
  <aside class="details" aria-label="Detaljer">
    <div class="dsec"><div class="dsec__title">Forslag fra Assist</div><div class="strong">Log 5,2 km fra i morges?</div><div class="meta">Løbetur 07.30–08.15 i kalenderen</div><div style="display:flex;gap:4px;margin-top:8px"><button class="btn btn--secondary btn--sm">${ic('check', 'ic--sm')}Godkend</button><button class="btn btn--text btn--sm">Afvis</button></div></div>
    <div class="dsec"><div class="dsec__title">Koblet til</div><div class="row" style="padding-left:0">${ic('calendar')}<div class="row__body"><div>Løbetur</div><div class="meta">Gentages man, ons og lør 07.30</div></div></div></div>
    <div class="dsec"><div class="dsec__title">Milepæle på dine andre mål</div><ul class="steps">${GS[2].steps.map(([t, d]) => `<li><span class="check__box" style="${d ? '' : ''}">${d ? ic('check', 'ic--sm') : ''}</span><span class="${d ? 'meta' : ''}">${esc(t)}</span></li>`).join('')}</ul><div class="meta" style="margin-top:4px">${esc(GS[2].title)} · ${GS[2].dueLabel}</div></div>
    <div class="dsec"><div class="dsec__title">CENTRA ved</div><p class="muted" style="font-size:12px;line-height:18px">Du logger altid dine løbeture, og du opdaterer dine mål søndag aften. <a href="#" class="tag">Ret</a></p></div>
  </aside></div>`;
};
function goalsA() { return `<div class="app">${sidebar()}<main>${goalsInner()}</main>${tabbar()}</div>`; }
function goalsC() { return `<div class="app">${topbarC()}${sidebar(false)}<main class="sheet">${goalsInner()}</main>${tabbar()}</div>`; }

const screens = { home: { a: homeA, b: homeB, c: homeC }, note: { a: noteA, b: noteB, c: noteC }, goals: { a: goalsA, b: goalsA, c: goalsC }, inbox: { a: inboxA, b: inboxB, c: inboxC } };
document.getElementById('root').innerHTML = screens[screen][dir]();
document.title = `CENTRA · ${{ a: 'Mørkekammer', b: 'Morgenavis', c: 'Værktøj' }[dir]} · ${{ home: 'I dag', note: 'Note', inbox: 'Indbakke', goals: 'Mål' }[screen]}`;
