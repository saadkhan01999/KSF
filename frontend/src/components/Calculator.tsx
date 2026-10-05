/* ==========================================================================
   The calculator in the top bar
   --------------------------------------------------------------------------
   Sits beside the bell and opens in place, like the notification and message
   panels: a cashier halfway through a sale can work out a discount or the
   change without leaving the till, and the basket is still there afterwards.

   Two modes:
     Calculator      a standard keypad with operator precedence, percent the
                     way a shop calculator does it, memory, a history tape and
                     copy-to-clipboard. Fully keyboard-operable.
     Pharmacy tools  the five sums a counter does all day: discount, GST
                     (adding it or taking it out), margin and markup, change
                     to give, and the price of loose tablets from a strip.

   The arithmetic is in utils/calculator.ts and is exact decimal arithmetic,
   not floating point, so 0.1 + 0.2 is 0.3 and money never drifts by a paisa.
   What is being worked on survives closing the panel; history and memory
   survive a reload, in this browser only.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Calculator as CalculatorIcon, Copy, Check, History, Delete, Percent, ReceiptText,
  TrendingUp, Banknote, Tablets, Trash2, CornerDownLeft
} from 'lucide-react';
import { Menu, Segmented } from './ui';
import {
  type CalcState, type Dec, type HistoryEntry, type Operator, initialCalc, press, keyAction,
  displayValue, expressionText, currentValue, clearLabel, recall, memoryAdd, memoryClear,
  memoryRecall, parseDec, toPlain, formatDec, formatRupees, formatPercent, ZERO, isNegative, isZero,
  discountTool, taxTool, marginTool, changeTool, unitTool
} from '../utils/calculator';

type Mode = 'basic' | 'tools';
type Tool = 'discount' | 'gst' | 'margin' | 'change' | 'unit';

const HISTORY_KEY = 'ksf-calc-history';
const MEMORY_KEY = 'ksf-calc-memory';
const MODE_KEY = 'ksf-calc-mode';
const TOOL_KEY = 'ksf-calc-tool';
const HISTORY_LIMIT = 12;

/* Browser storage is a convenience here, never a requirement: a private
   window or blocked storage simply starts empty. */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/* =============================== trigger =============================== */

export function CalculatorMenu() {
  const [calc, setCalc] = useState<CalcState>(() => ({ ...initialCalc, memory: readStored<string | null>(MEMORY_KEY, null) }));
  const [history, setHistory] = useState<HistoryEntry[]>(() => readStored<HistoryEntry[]>(HISTORY_KEY, []));
  const [mode, setMode] = useState<Mode>(() => readStored<Mode>(MODE_KEY, 'basic'));
  const [tool, setTool] = useState<Tool>(() => readStored<Tool>(TOOL_KEY, 'discount'));
  const [fields, setFields] = useState<Record<string, string>>({ gstRate: '18', discountQty: '1', unitQty: '1' });

  useEffect(() => { writeStored(HISTORY_KEY, history); }, [history]);
  useEffect(() => { writeStored(MEMORY_KEY, calc.memory); }, [calc.memory]);
  useEffect(() => { writeStored(MODE_KEY, mode); }, [mode]);
  useEffect(() => { writeStored(TOOL_KEY, tool); }, [tool]);

  return (
    <Menu
      panel
      label="Calculator"
      trigger={({ toggle, props }) => (
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={calc.memory ? 'Calculator, a value is in memory' : 'Calculator'}
          title="Calculator"
          {...props}
        >
          <CalculatorIcon />
          {calc.memory && <span className="calc-trigger-memory" aria-hidden="true">M</span>}
        </button>
      )}
    >
      {() => (
        <CalculatorPanel
          calc={calc} setCalc={setCalc}
          history={history} setHistory={setHistory}
          mode={mode} setMode={setMode}
          tool={tool} setTool={setTool}
          fields={fields} setFields={setFields}
        />
      )}
    </Menu>
  );
}

/* ================================ panel ================================ */

interface PanelProps {
  calc: CalcState; setCalc: React.Dispatch<React.SetStateAction<CalcState>>;
  history: HistoryEntry[]; setHistory: React.Dispatch<React.SetStateAction<HistoryEntry[]>>;
  mode: Mode; setMode: (mode: Mode) => void;
  tool: Tool; setTool: (tool: Tool) => void;
  fields: Record<string, string>; setFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

function CalculatorPanel({ calc, setCalc, history, setHistory, mode, setMode, tool, setTool, fields, setFields }: PanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);

  /* Keys typed straight after opening reach the calculator. */
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  /* The latest state, read when a key is pressed. The history is written
     here rather than inside a state updater: React may run an updater twice
     (it does on purpose in development), and a side effect in one would
     record every sum twice. */
  const latest = useRef(calc);
  latest.current = calc;

  const apply = useCallback((action: string) => {
    const outcome = press(latest.current, action);
    latest.current = outcome.state;
    setCalc(outcome.state);
    if (outcome.history) {
      const entry = outcome.history;
      setHistory((list) => [entry, ...list].slice(0, HISTORY_LIMIT));
    }
  }, [setCalc, setHistory]);

  const flash = (action: string) => {
    setPressed(action);
    window.setTimeout(() => setPressed((current) => (current === action ? null : current)), 140);
  };

  const copy = async (value: Dec) => {
    try {
      await navigator.clipboard.writeText(toPlain(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* Clipboard refused (an insecure origin, or permission): nothing to do. */
    }
  };

  const takeValue = (value: Dec) => {
    setCalc((state) => recall(state, value));
    setMode('basic');
    setShowHistory(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    /* Escape belongs to the panel: it closes and returns focus. */
    if (event.key === 'Escape') return;
    /* Everything else stays inside the calculator. The surrounding menu moves
       focus on the arrow, Home and End keys, and the page treats "/" as
       "search" — neither is what someone typing a sum means. */
    event.stopPropagation();
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    if (mode !== 'basic') return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      if (!window.getSelection()?.toString()) { event.preventDefault(); void copy(currentValue(calc)); }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const action = keyAction(event.key);
    if (!action) return;
    event.preventDefault();
    apply(action);
    flash(action);
  };

  const value = currentValue(calc);

  return (
    <div className="calc" ref={root} tabIndex={-1} onKeyDown={onKeyDown} role="group" aria-label="Calculator">
      <header className="panel-head calc-head">
        <h3><CalculatorIcon size={17} aria-hidden="true" /> Calculator</h3>
        <span className="calc-head-actions">
          <button
            type="button" className="calc-tool-btn"
            onClick={() => { void copy(value); }}
            aria-label={copied ? 'Copied' : 'Copy the result'} title="Copy the result (Ctrl+C)"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button
            type="button" className={`calc-tool-btn ${showHistory ? 'is-on' : ''}`}
            onClick={() => setShowHistory((open) => !open)}
            aria-label={showHistory ? 'Hide history' : 'Show history'} aria-pressed={showHistory} title="History"
          >
            <History size={16} />
          </button>
        </span>
      </header>

      <div className="calc-modes">
        <Segmented
          label="Calculator mode"
          value={mode}
          onChange={(next) => { setMode(next); setShowHistory(false); }}
          options={[{ value: 'basic', label: 'Calculator' }, { value: 'tools', label: 'Pharmacy tools' }]}
        />
      </div>

      {showHistory
        ? <HistoryList history={history} onPick={(entry) => takeValue(parseDec(entry.result) ?? ZERO)} onClear={() => setHistory([])} />
        : mode === 'basic'
          ? <Keypad calc={calc} pressed={pressed} apply={apply} setCalc={setCalc} />
          : <Tools tool={tool} setTool={setTool} fields={fields} setFields={setFields} onUse={takeValue} />}

      <p className="calc-hint">
        {mode === 'basic'
          ? 'Type on the keyboard: digits, + − * /, % and Enter. Backspace corrects, Delete clears.'
          : 'Exact to the paisa. "Use in calculator" carries a result across.'}
      </p>
    </div>
  );
}

/* =============================== keypad =============================== */

const OPERATOR_NAMES: Record<Operator, string> = { '+': 'Plus', '−': 'Minus', '×': 'Multiply', '÷': 'Divide' };

function Keypad({ calc, pressed, apply, setCalc }: {
  calc: CalcState; pressed: string | null; apply: (action: string) => void;
  setCalc: React.Dispatch<React.SetStateAction<CalcState>>;
}) {
  const display = displayValue(calc);
  const expression = expressionText(calc);
  const pendingOperator = !calc.entry && calc.result === null ? calc.tokens[calc.tokens.length - 1] : undefined;
  const size = display.length > 16 ? 'is-longer' : display.length > 11 ? 'is-long' : '';

  const key = (action: string, label: React.ReactNode, tone: 'digit' | 'op' | 'fn' | 'clear' | 'equals', name?: string) => (
    <button
      type="button"
      className={`calc-key is-${tone} ${pressed === action ? 'is-pressed' : ''} ${pendingOperator === action ? 'is-active' : ''}`}
      onClick={() => apply(action)}
      aria-label={name}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="calc-screen">
        <div className="calc-expression" aria-hidden="true">{expression || ' '}</div>
        <output className={`calc-display ${size} ${calc.error ? 'is-error' : ''}`} aria-live="polite" aria-label="Result">
          {display}
        </output>
        {calc.memory && (
          <span className="calc-memory" title={`In memory: ${formatDec(parseDec(calc.memory) ?? ZERO)}`}>
            M {formatDec(parseDec(calc.memory) ?? ZERO)}
          </span>
        )}
      </div>

      <div className="calc-memory-row" role="group" aria-label="Memory">
        <button type="button" className="calc-mem" onClick={() => setCalc(memoryClear)} disabled={!calc.memory} aria-label="Memory clear">MC</button>
        <button type="button" className="calc-mem" onClick={() => setCalc(memoryRecall)} disabled={!calc.memory} aria-label="Memory recall">MR</button>
        <button type="button" className="calc-mem" onClick={() => setCalc((s) => memoryAdd(s, 1))} aria-label="Add to memory">M+</button>
        <button type="button" className="calc-mem" onClick={() => setCalc((s) => memoryAdd(s, -1))} aria-label="Subtract from memory">M−</button>
      </div>

      <div className="calc-keys">
        {key('clear', clearLabel(calc), 'clear', clearLabel(calc) === 'C' ? 'Clear entry' : 'All clear')}
        {key('back', <Delete size={19} aria-hidden="true" />, 'fn', 'Delete last digit')}
        {key('%', <Percent size={17} aria-hidden="true" />, 'fn', 'Percent')}
        {key('÷', '÷', 'op', OPERATOR_NAMES['÷'])}

        {key('7', '7', 'digit')}{key('8', '8', 'digit')}{key('9', '9', 'digit')}
        {key('×', '×', 'op', OPERATOR_NAMES['×'])}

        {key('4', '4', 'digit')}{key('5', '5', 'digit')}{key('6', '6', 'digit')}
        {key('−', '−', 'op', OPERATOR_NAMES['−'])}

        {key('1', '1', 'digit')}{key('2', '2', 'digit')}{key('3', '3', 'digit')}
        {key('+', '+', 'op', OPERATOR_NAMES['+'])}

        {key('sign', '±', 'fn', 'Change sign')}
        {key('0', '0', 'digit')}
        {key('.', '.', 'digit', 'Decimal point')}
        {key('=', '=', 'equals', 'Equals')}
      </div>
    </>
  );
}

/* =============================== history =============================== */

function HistoryList({ history, onPick, onClear }: {
  history: HistoryEntry[]; onPick: (entry: HistoryEntry) => void; onClear: () => void;
}) {
  if (history.length === 0) {
    return (
      <div className="calc-history-empty">
        <History size={20} aria-hidden="true" />
        <p>No calculations yet. Results appear here after you press =.</p>
      </div>
    );
  }
  return (
    <div className="calc-history">
      <ul>
        {history.map((entry, index) => (
          <li key={`${entry.expression}-${index}`}>
            <button type="button" onClick={() => onPick(entry)} title="Use this result">
              <span className="calc-history-sum">{entry.expression} =</span>
              <strong>{formatDec(parseDec(entry.result) ?? ZERO)}</strong>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="calc-link" onClick={onClear}>
        <Trash2 size={14} aria-hidden="true" /> Clear history
      </button>
    </div>
  );
}

/* ================================ tools ================================ */

const TOOLS: { value: Tool; label: string; icon: React.ReactNode }[] = [
  { value: 'discount', label: 'Discount', icon: <Percent size={15} aria-hidden="true" /> },
  { value: 'gst', label: 'GST', icon: <ReceiptText size={15} aria-hidden="true" /> },
  { value: 'margin', label: 'Margin', icon: <TrendingUp size={15} aria-hidden="true" /> },
  { value: 'change', label: 'Change', icon: <Banknote size={15} aria-hidden="true" /> },
  { value: 'unit', label: 'Per tablet', icon: <Tablets size={15} aria-hidden="true" /> }
];

/** Keeps a typed amount to digits and one decimal point. */
const cleanNumber = (text: string) => {
  const kept = text.replace(/[^\d.]/g, '');
  const at = kept.indexOf('.');
  return at < 0 ? kept : `${kept.slice(0, at + 1)}${kept.slice(at + 1).replace(/\./g, '')}`;
};

function Field({ id, label, value, onChange, prefix, suffix, placeholder }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  prefix?: string; suffix?: string; placeholder?: string;
}) {
  return (
    <div className="calc-field">
      <label htmlFor={id}>{label}</label>
      <div className="calc-input">
        {prefix && <span className="calc-affix" aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder ?? '0'}
          onChange={(event) => onChange(cleanNumber(event.target.value))}
        />
        {suffix && <span className="calc-affix" aria-hidden="true">{suffix}</span>}
      </div>
    </div>
  );
}

function Chips({ label, options, onPick }: { label: string; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  return (
    <div className="calc-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="calc-chip" onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface Row { label: string; value: string; strong?: boolean; tone?: 'ok' | 'danger' }

function Results({ rows, primary, onUse }: { rows: Row[] | null; primary: Dec | null; onUse: (value: Dec) => void }) {
  if (!rows) return <p className="calc-results-empty">Fill in the amounts to see the result.</p>;
  return (
    <>
      <dl className="calc-results">
        {rows.map((row) => (
          <div key={row.label} className={`calc-result ${row.strong ? 'is-strong' : ''} ${row.tone ? `tone-${row.tone}` : ''}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {primary && (
        <button type="button" className="calc-use" onClick={() => onUse(primary)}>
          <CornerDownLeft size={15} aria-hidden="true" /> Use in calculator
        </button>
      )}
    </>
  );
}

function Tools({ tool, setTool, fields, setFields, onUse }: {
  tool: Tool; setTool: (tool: Tool) => void;
  fields: Record<string, string>; setFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onUse: (value: Dec) => void;
}) {
  const f = (name: string) => fields[name] ?? '';
  const set = (name: string) => (value: string) => setFields((current) => ({ ...current, [name]: value }));

  const view = ((): { form: React.ReactNode; rows: Row[] | null; primary: Dec | null } => {
    switch (tool) {
      case 'discount': {
        const r = discountTool(f('discountPrice'), f('discountRate'), f('discountQty'));
        return {
          form: (
            <>
              <div className="calc-field-row">
                <Field id="calc-discount-price" label="Price per pack" prefix="Rs" value={f('discountPrice')} onChange={set('discountPrice')} />
                <Field id="calc-discount-qty" label="Quantity" value={f('discountQty')} onChange={set('discountQty')} placeholder="1" />
              </div>
              <Field id="calc-discount-rate" label="Discount" suffix="%" value={f('discountRate')} onChange={set('discountRate')} />
              <Chips label="Common discounts" onPick={set('discountRate')} options={['5', '10', '15', '20'].map((v) => ({ value: v, label: `${v}%` }))} />
            </>
          ),
          rows: r && [
            { label: 'Total before discount', value: formatRupees(r.gross) },
            { label: 'Discount', value: formatRupees(r.discount), tone: 'ok' },
            { label: 'Customer pays', value: formatRupees(r.payable), strong: true }
          ],
          primary: r ? r.payable : null
        };
      }
      case 'gst': {
        const inclusive = f('gstMode') === 'inclusive';
        const r = taxTool(f('gstAmount'), f('gstRate'), inclusive);
        return {
          form: (
            <>
              <Segmented
                label="Is GST already in the amount?"
                value={inclusive ? 'inclusive' : 'exclusive'}
                onChange={set('gstMode')}
                options={[{ value: 'exclusive', label: 'Add GST' }, { value: 'inclusive', label: 'Remove GST' }]}
              />
              <div className="calc-field-row">
                <Field id="calc-gst-amount" label={inclusive ? 'Amount including GST' : 'Amount before GST'} prefix="Rs" value={f('gstAmount')} onChange={set('gstAmount')} />
                <Field id="calc-gst-rate" label="Rate" suffix="%" value={f('gstRate')} onChange={set('gstRate')} />
              </div>
              <Chips label="Common rates" onPick={set('gstRate')} options={['18', '17', '5', '1'].map((v) => ({ value: v, label: `${v}%` }))} />
            </>
          ),
          rows: r && [
            { label: 'Amount before GST', value: formatRupees(r.net) },
            { label: `GST at ${formatDec(parseDec(f('gstRate') || '0') ?? ZERO, 2)}%`, value: formatRupees(r.tax) },
            { label: 'Amount including GST', value: formatRupees(r.gross), strong: true }
          ],
          primary: r ? (inclusive ? r.net : r.gross) : null
        };
      }
      case 'margin': {
        const r = marginTool(f('marginCost'), f('marginPrice'));
        const loss = r ? isNegative(r.profit) : false;
        return {
          form: (
            <div className="calc-field-row">
              <Field id="calc-margin-cost" label="Cost price" prefix="Rs" value={f('marginCost')} onChange={set('marginCost')} />
              <Field id="calc-margin-price" label="Selling price" prefix="Rs" value={f('marginPrice')} onChange={set('marginPrice')} />
            </div>
          ),
          rows: r && [
            { label: loss ? 'Loss per pack' : 'Profit per pack', value: formatRupees(r.profit), strong: true, tone: loss ? 'danger' : 'ok' },
            { label: 'Margin (on selling price)', value: r.margin ? formatPercent(r.margin) : '—' },
            { label: 'Markup (on cost)', value: r.markup ? formatPercent(r.markup) : '—' }
          ],
          primary: r ? r.profit : null
        };
      }
      case 'change': {
        const r = changeTool(f('changeDue'), f('changeReceived'));
        const short = r ? !isZero(r.short) : false;
        return {
          form: (
            <>
              <div className="calc-field-row">
                <Field id="calc-change-due" label="Total due" prefix="Rs" value={f('changeDue')} onChange={set('changeDue')} />
                <Field id="calc-change-received" label="Cash received" prefix="Rs" value={f('changeReceived')} onChange={set('changeReceived')} />
              </div>
              <Chips
                label="Notes handed over"
                onPick={set('changeReceived')}
                options={[
                  { value: f('changeDue'), label: 'Exact' },
                  { value: '500', label: 'Rs 500' },
                  { value: '1000', label: 'Rs 1,000' },
                  { value: '5000', label: 'Rs 5,000' }
                ].filter((option) => option.value !== '')}
              />
            </>
          ),
          rows: r && [
            short
              ? { label: 'Still to collect', value: formatRupees(r.short), strong: true, tone: 'danger' }
              : { label: 'Change to give back', value: formatRupees(r.change), strong: true, tone: 'ok' }
          ],
          primary: r ? (short ? r.short : r.change) : null
        };
      }
      case 'unit': {
        const r = unitTool(f('unitPack'), f('unitPerPack'), f('unitQty'));
        return {
          form: (
            <>
              <div className="calc-field-row">
                <Field id="calc-unit-pack" label="Strip or pack price" prefix="Rs" value={f('unitPack')} onChange={set('unitPack')} />
                <Field id="calc-unit-per" label="Tablets in it" value={f('unitPerPack')} onChange={set('unitPerPack')} placeholder="10" />
              </div>
              <Field id="calc-unit-qty" label="Tablets being sold" value={f('unitQty')} onChange={set('unitQty')} placeholder="1" />
            </>
          ),
          rows: r && [
            { label: 'Price per tablet', value: formatRupees(r.perUnit) },
            { label: `For ${formatDec(parseDec(f('unitQty') || '1') ?? ZERO)} tablet(s)`, value: formatRupees(r.total), strong: true }
          ],
          primary: r ? r.total : null
        };
      }
      default:
        return { form: null, rows: null, primary: null };
    }
  })();

  return (
    <div className="calc-tools">
      <div className="calc-tool-tabs" role="tablist" aria-label="Pharmacy tool">
        {TOOLS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tool === entry.value}
            className={`calc-tool-tab ${tool === entry.value ? 'is-on' : ''}`}
            onClick={() => setTool(entry.value)}
          >
            {entry.icon}
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
      <div className="calc-form">{view.form}</div>
      <Results rows={view.rows} primary={view.primary} onUse={onUse} />
    </div>
  );
}
