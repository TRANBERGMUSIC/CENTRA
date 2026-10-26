import { useRef } from 'react';
import { useEngine, useList, useRoute } from '../state.tsx';
import { Btn, Panel, Pill } from '../ui/primitives.tsx';
import { useToast } from '../ui/Shell.tsx';
import { collapseOut, useScreenEnter } from '../motion.ts';
import ClickSpark from '../bits/ClickSpark.jsx';

/**
 * Assist never acts on its own: every suggestion waits for Godkend / Afvis.
 * Approving runs exactly the action in the suggestion's payload, and can be undone.
 */
export function SuggestionRows({ limit }: { limit?: number }) {
  const e = useEngine();
  const { go } = useRoute();
  const toast = useToast();
  const list = useList('suggestion').filter((s: any) => s.status === 'pending') as any[];
  const spark = useRef<{ spark: (x: number, y: number) => void }>(null);
  const shown = limit ? list.slice(0, limit) : list;

  function approve(s: any, row: HTMLElement, ev: React.MouseEvent) {
    const box = row.closest('.sparkhost')!.getBoundingClientRect();
    spark.current?.spark(ev.clientX - box.left, ev.clientY - box.top);
    collapseOut(row, () => {
      let undo: () => void = () => {};
      if (s.kind === 'goal') {
        const id = e.create('goalUpdate', { goal: s.payload.goal, at: new Date().toISOString(), delta: s.payload.delta, text: s.payload.text, src: 'Fra Løbetur i kalenderen · godkendt af dig' });
        undo = () => e.remove('goalUpdate', id);
      } else if (s.kind === 'calendar') {
        const id = e.create('event', { title: s.payload.title, start: new Date(s.payload.start).toISOString(), end: new Date(new Date(s.payload.start).getTime() + 15 * 60000).toISOString(), cal: 'Påmindelser' });
        undo = () => e.remove('event', id);
      } else if (s.kind === 'rule') {
        const id = e.create('rule', { rule: s.payload.rule, title: s.title.replace('?', ''), active: true });
        undo = () => e.remove('rule', id);
      } else if (s.kind === 'draft') {
        go({ screen: 'inbox', id: s.payload.mail });
      }
      e.set('suggestion', s.id, { status: 'approved', decidedAt: new Date().toISOString() });
      toast({ text: s.kind === 'draft' ? 'Udkastet er åbnet i indbakken' : 'Godkendt', action: s.kind === 'draft' ? undefined : { label: 'Fortryd', run: () => { undo(); e.set('suggestion', s.id, { status: 'pending' }); } } });
    });
  }
  function decline(s: any, row: HTMLElement) {
    collapseOut(row, () => {
      e.set('suggestion', s.id, { status: 'declined', decidedAt: new Date().toISOString() });
      toast({ text: 'Afvist. Assist lærer af det.', action: { label: 'Fortryd', run: () => e.set('suggestion', s.id, { status: 'pending' }) } });
    });
  }

  if (!shown.length) return <p className="muted">Ingen forslag lige nu. Assist foreslår kun noget, når den har et konkret grundlag.</p>;
  return (
    <div className="sparkhost">
      <ClickSpark ref={spark} sparkColor="#C9683A" sparkCount={9} sparkRadius={22} sparkSize={9} duration={420} layer="front">
        <ul className="rows">
          {shown.map((s) => (
            <li key={s.id} className="sugg">
              <div className="strong">{s.title}</div>
              <div className="sugg__actions">
                <Btn size="sm" icon="check" onClick={(ev) => approve(s, (ev.currentTarget as HTMLElement).closest('li')!, ev)}>Godkend</Btn>
                <Btn size="sm" variant="text" icon="x" aria-label="Afvis" onClick={(ev) => decline(s, (ev.currentTarget as HTMLElement).closest('li')!)} />
              </div>
              <div className="meta"><span className="muted">{s.detail}</span> · {s.source}</div>
            </li>
          ))}
        </ul>
      </ClickSpark>
    </div>
  );
}

export function Assist() {
  const e = useEngine();
  const ref = useRef<HTMLElement>(null);
  useScreenEnter(ref, 'assist');
  const memory = useList('memory') as any[];
  const rules = useList('rule') as any[];
  const decided = useList('suggestion').filter((s: any) => s.status !== 'pending') as any[];
  return (
    <main className="canvas" ref={ref}>
      <div className="titlerow" data-enter><div><h1>Assist</h1><p>Forslag venter altid på dit ja. Alt, Assist har lært, står her og kan rettes eller slettes.</p></div></div>
      <div className="grid12">
        <Panel title="Forslag" className="span-7" count={undefined}><SuggestionRows /></Panel>
        <Panel title="Aktive regler" className="span-5" count={rules.length}>
          {rules.length ? <ul className="rows">{rules.map((r) => (
            <li key={r.id} className="row"><span className="row__body"><span className="row__line"><span className="ellipsis">{r.title}</span></span><span className="row__line meta">Slået til af dig</span></span><Btn size="sm" variant="text" onClick={() => e.remove('rule', r.id)}>Slå fra</Btn></li>
          ))}</ul> : <p className="muted">Ingen automatik er slået til. Assist arkiverer, sender og sletter aldrig noget uden en regel, du selv har godkendt.</p>}
        </Panel>
        <Panel title="Det ved CENTRA om dig" className="span-12" count={memory.length}>
          <ul className="rows">{memory.map((m) => (
            <li key={m.id} className="memrow">
              <Pill tone="calm">{m.kind}</Pill>
              <span className="row__body"><span className="row__line"><span>{m.statement}</span></span><span className="row__line meta">{m.evidence} · {m.source}</span></span>
              <Btn size="sm" variant="text" onClick={() => { const v = prompt('Ret det, CENTRA ved', m.statement); if (v) e.set('memory', m.id, { statement: v, source: 'Rettet af dig' }); }}>Ret</Btn>
              <Btn size="sm" variant="text" icon="x" aria-label="Slet" onClick={() => e.remove('memory', m.id)} />
            </li>
          ))}</ul>
        </Panel>
        <Panel title="Seneste beslutninger" className="span-12" count={decided.length}>
          {decided.length ? <ul className="rows">{decided.map((s) => (
            <li key={s.id} className="row"><span className="row__body"><span className="row__line"><span className="ellipsis">{s.title}</span><span className={`status ${s.status === 'approved' ? '' : 'is-off'} row__trail`}>{s.status === 'approved' ? 'Godkendt' : 'Afvist'}</span></span></span></li>
          ))}</ul> : <p className="muted">Ingen endnu.</p>}
        </Panel>
      </div>
    </main>
  );
}
