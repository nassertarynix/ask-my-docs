import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from './Chart';
import { emptyState, exampleState, forecastCsv, readState, type State } from './domain/data';
import { isIso, localToday } from './domain/dates';
import { forecast, type Every, type Item } from './domain/forecast';
import { centsToInput, formatMoney, parseMoney } from './domain/money';

const KEY = 'runway.state.v1';
const EVERY_LABEL: Record<Every, string> = { once: 'One time', week: 'Every week', month: 'Every month', year: 'Every year' };

function load(): { state: State; example: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: unknown; example?: boolean };
      const state = readState(parsed.state);
      if (state) return { state, example: parsed.example === true };
    }
  } catch { /* storage unavailable: start fresh */ }
  return { state: exampleState(), example: true };
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function monthName(key: string): string {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [initial] = useState(load);
  const [state, setState] = useState<State>(initial.state);
  const [example, setExample] = useState(initial.example);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ state, example })); } catch { /* private mode: keep working in memory */ }
  }, [state, example]);

  const result = useMemo(() => forecast(state.items, state.settings), [state]);
  const { settings } = state;
  const change = (next: State | ((prev: State) => State)) => { setState(next); setExample(false); };
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 3500); };

  const status = result.runsOutOn
    ? { tone: 'bad', title: `Money runs out on ${longDate(result.runsOutOn)}`, sub: `The balance first drops below zero then, and bottoms out at ${formatMoney(result.lowest.balance)} on ${longDate(result.lowest.date)}.` }
    : state.items.some((i) => i.enabled)
      ? { tone: 'good', title: `Stays above zero through ${longDate(result.end)}`, sub: `The lowest point is ${formatMoney(result.lowest.balance)} on ${longDate(result.lowest.date)}.` }
      : { tone: 'idle', title: 'Add what comes in and goes out', sub: 'Then you will see how the balance moves and when the money runs out.' };

  const net = result.closing - settings.opening;

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const imported = readState(JSON.parse(await file.text()));
      if (!imported) throw new Error('not a Runway file');
      change(imported);
      flash(`Loaded ${imported.items.length} items from ${file.name}.`);
    } catch {
      flash('That file is not a Runway export, so nothing was changed.');
    }
  }

  return (
    <div className="page">
      <header className="top">
        <h1>Runway</h1>
        <p className="muted">Cash-flow forecast. It runs in your browser and nothing is uploaded.</p>
      </header>

      {example && (
        <div className="note" role="note">
          This is example data for a small shop, so you can see how it works. <button className="link" onClick={() => { change(emptyState()); flash('Cleared. Add your own items below.'); }}>Clear it and start your own</button>
        </div>
      )}

      <section className={`hero ${status.tone}`} aria-live="polite">
        <div className="eyebrow">{longDate(settings.start)} to {longDate(result.end)}</div>
        <h2>{status.title}</h2>
        <p>{status.sub}</p>
        <dl className="stats">
          <div><dt>Opening</dt><dd className="num">{formatMoney(settings.opening)}</dd></div>
          <div><dt>Closing</dt><dd className={`num ${result.closing < 0 ? 'neg' : ''}`}>{formatMoney(result.closing)}</dd></div>
          <div><dt>Net change</dt><dd className={`num ${net < 0 ? 'neg' : 'pos'}`}>{formatMoney(net, { sign: true })}</dd></div>
        </dl>
      </section>

      <section className="card" aria-label="Balance chart">
        <Chart forecast={result} settings={settings} />
      </section>

      <section className="card" aria-labelledby="set-h">
        <h2 id="set-h">Starting point</h2>
        <div className="fields">
          <OpeningField cents={settings.opening} onCommit={(c) => change((p) => ({ ...p, settings: { ...p.settings, opening: c } }))} />
          <label>Start date
            <input id="start" type="date" value={settings.start} onChange={(e) => { const v = e.target.value; if (isIso(v)) change((p) => ({ ...p, settings: { ...p.settings, start: v } })); }} />
          </label>
          <label>Look ahead
            <select id="months" value={settings.months} onChange={(e) => { const m = Number(e.target.value); change((p) => ({ ...p, settings: { ...p.settings, months: m } })); }}>
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} months</option>)}
            </select>
          </label>
        </div>
      </section>

      <section aria-labelledby="items-h">
        <div className="row-head">
          <h2 id="items-h">What comes in and goes out</h2>
          <button className="btn primary" onClick={() => setEditing('new')}>Add item</button>
        </div>
        {state.items.length === 0 && <p className="empty">Nothing here yet. Add your income and your regular costs, such as rent, salaries or a loan payment.</p>}
        <ul className="items">
          {state.items.map((item) => (
            <li key={item.id} className={item.enabled ? '' : 'off'}>
              <label className="switch" title={item.enabled ? 'Included in the forecast' : 'Left out of the forecast'}>
                <input type="checkbox" checked={item.enabled} aria-label={`Include ${item.name}`} onChange={() => change((p) => ({ ...p, items: p.items.map((i) => (i.id === item.id ? { ...i, enabled: !i.enabled } : i)) }))} />
                <span />
              </label>
              <button className="item-main" onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`}>
                <span className="item-name">{item.name}</span>
                <span className="muted small">{EVERY_LABEL[item.every]} from {shortDate(item.start)}{item.end ? ` to ${shortDate(item.end)}` : ''}</span>
              </button>
              <span className={`num amount ${item.kind === 'in' ? 'pos' : 'neg'}`}>{formatMoney(item.kind === 'in' ? item.amountCents : -item.amountCents, { sign: true })}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="m-h">
        <h2 id="m-h">Month by month</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Month</th><th className="r">In</th><th className="r">Out</th><th className="r">Balance</th></tr></thead>
            <tbody>
              {result.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthName(m.month)}</td>
                  <td className="r num pos">{formatMoney(m.in, { whole: true })}</td>
                  <td className="r num">{formatMoney(m.out, { whole: true })}</td>
                  <td className={`r num strong ${m.closing < 0 ? 'neg' : ''}`}>{formatMoney(m.closing, { whole: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="d-h">
        <h2 id="d-h">Your data</h2>
        <p className="muted small">Saved in this browser only. Download a copy to keep it or move it to another device.</p>
        <div className="buttons">
          <button className="btn" onClick={() => download(`runway-${localToday()}.json`, JSON.stringify(state, null, 2), 'application/json')}>Download backup</button>
          <button className="btn" onClick={() => fileInput.current?.click()}>Load backup</button>
          <button className="btn" onClick={() => download(`runway-forecast-${localToday()}.csv`, forecastCsv(result.events.map((e) => ({ date: e.date, name: e.item.name, cents: e.cents, balance: e.balance }))), 'text/csv')}>Download forecast (CSV)</button>
          <button className="btn" onClick={() => { change(exampleState()); flash('Example data loaded.'); setExample(true); }}>Load the example</button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Load backup" onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
      </section>

      {message && <div className="toast" role="status">{message}</div>}
      {editing && (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            change((p) => ({ ...p, items: p.items.some((i) => i.id === item.id) ? p.items.map((i) => (i.id === item.id ? item : i)) : [...p.items, item] }));
            setEditing(null);
          }}
          onDelete={(id) => { change((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) })); setEditing(null); flash('Item deleted.'); }}
          today={settings.start}
        />
      )}
    </div>
  );
}

function ItemDialog({ item, today, onSave, onDelete, onClose }: { item: Item | null; today: string; onSave: (i: Item) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<'in' | 'out'>(item?.kind ?? 'out');
  const [amount, setAmount] = useState(item ? centsToInput(item.amountCents) : '');
  const [every, setEvery] = useState<Every>(item?.every ?? 'month');
  const [start, setStart] = useState(item?.start ?? today);
  const [end, setEnd] = useState(item?.end ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const cents = parseMoney(amount);
    if (!name.trim()) next.name = 'Give it a name.';
    if (cents === null || cents <= 0) next.amount = 'Enter an amount above zero, such as 1250 or 1,250.50.';
    if (!isIso(start)) next.start = 'Choose a start date.';
    if (end && !isIso(end)) next.end = 'Choose a valid end date or leave it empty.';
    if (end && isIso(start) && isIso(end) && end < start) next.end = 'The end date is before the start date.';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave({ id: item?.id ?? `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), kind, amountCents: cents as number, every, start, end: every === 'once' ? '' : end, enabled: item?.enabled ?? true });
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="dlg-h">
      <form onSubmit={submit} noValidate>
        <h2 id="dlg-h">{item ? 'Edit item' : 'Add item'}</h2>
        <div className="seg" role="radiogroup" aria-label="Type">
          <label className={kind === 'in' ? 'on in' : ''}><input type="radio" name="kind" checked={kind === 'in'} onChange={() => setKind('in')} />Money in</label>
          <label className={kind === 'out' ? 'on out' : ''}><input type="radio" name="kind" checked={kind === 'out'} onChange={() => setKind('out')} />Money out</label>
        </div>
        <label>Name
          <input id="f-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-invalid={!!errors.name} />
          {errors.name && <span className="err">{errors.name}</span>}
        </label>
        <label>Amount
          <input id="f-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-invalid={!!errors.amount} />
          {errors.amount && <span className="err">{errors.amount}</span>}
        </label>
        <label>Repeats
          <select id="f-every" value={every} onChange={(e) => setEvery(e.target.value as Every)}>
            {(Object.keys(EVERY_LABEL) as Every[]).map((k) => <option key={k} value={k}>{EVERY_LABEL[k]}</option>)}
          </select>
        </label>
        <label>{every === 'once' ? 'Date' : 'First date'}
          <input id="f-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!errors.start} />
          {errors.start && <span className="err">{errors.start}</span>}
        </label>
        {every !== 'once' && (
          <label>Last date <span className="muted">(optional)</span>
            <input id="f-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!errors.end} />
            {errors.end && <span className="err">{errors.end}</span>}
          </label>
        )}
        <div className="buttons end">
          {item && <button type="button" className="btn danger" onClick={() => onDelete(item.id)}>Delete</button>}
          <span className="grow" />
          <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </dialog>
  );
}

/** Keeps what is being typed apart from the saved number. Every valid keystroke is saved at once; if the saved value changes from outside (a backup was loaded), the text follows it. */
function OpeningField({ cents, onCommit }: { cents: number; onCommit: (c: number) => void }) {
  const [text, setText] = useState(centsToInput(cents));
  const [seen, setSeen] = useState(cents);
  if (cents !== seen) {
    setSeen(cents);
    if (parseMoney(text) !== cents) setText(centsToInput(cents));
  }
  const parsed = parseMoney(text);
  return (
    <label>Balance on the start date
      <input id="opening" inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); const c = parseMoney(e.target.value); if (c !== null) onCommit(c); }} onBlur={() => { if (parsed === null) setText(centsToInput(cents)); }} aria-invalid={parsed === null} />
    </label>
  );
}
