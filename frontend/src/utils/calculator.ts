/* ==========================================================================
   The counter calculator
   --------------------------------------------------------------------------
   The arithmetic behind the calculator in the top bar, kept free of React so
   it can be tested on its own (tests/unit.test.mjs imports this file directly).

   Why not plain JavaScript numbers. 0.1 + 0.2 is 0.30000000000000004 in
   floating point, and 1.15 × 100 is 114.99999999999999. A calculator at a
   pharmacy counter is used for money, so every value here is an exact
   decimal: a whole-number BigInt and a count of decimal places. Addition,
   subtraction and multiplication are exact; division is carried to 20 places
   and rounded half away from zero — the rounding people learn at school and
   the rule the State Bank applies to paisa.

   Nothing here touches the DOM, storage or the network.
   ========================================================================== */

/* ================================ decimals ================================ */

/** An exact decimal: `units / 10^scale`. */
export interface Dec { units: bigint; scale: number }

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);
const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** Drops trailing zeros, so 2.50 and 2.5 are the same value. */
function normalise(d: Dec): Dec {
  let { units, scale } = d;
  while (scale > 0 && units % TEN === 0n) { units /= TEN; scale -= 1; }
  return { units, scale };
}

export const ZERO: Dec = { units: 0n, scale: 0 };

/** Reads "1,250.75", "-3" or ".5". Returns null for anything else. */
export function parseDec(text: string): Dec | null {
  const clean = String(text ?? '').replace(/[,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  const negative = clean.startsWith('-');
  const body = negative ? clean.slice(1) : clean;
  const [whole, fraction = ''] = body.split('.');
  const units = BigInt(`${whole || '0'}${fraction}`) * (negative ? -1n : 1n);
  return normalise({ units, scale: fraction.length });
}

/** A number from code, e.g. a rate of 18. Integers only to stay exact. */
export const dec = (value: number | string): Dec => parseDec(String(value)) ?? ZERO;

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale];
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, scale] = align(a, b);
  return normalise({ units: x + y, scale });
}

export function sub(a: Dec, b: Dec): Dec {
  const [x, y, scale] = align(a, b);
  return normalise({ units: x - y, scale });
}

export function mul(a: Dec, b: Dec): Dec {
  return normalise({ units: a.units * b.units, scale: a.scale + b.scale });
}

/** Integer division rounded half away from zero. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (abs(remainder) * 2n >= denominator) return quotient + (numerator < 0n ? -1n : 1n);
  return quotient;
}

export class DivisionByZero extends Error {
  constructor() { super('Cannot divide by zero'); }
}

/** a ÷ b, to `places` decimal places. */
export function div(a: Dec, b: Dec, places = 20): Dec {
  if (b.units === 0n) throw new DivisionByZero();
  const numerator = a.units * pow10(b.scale + places);
  const denominator = b.units * pow10(a.scale);
  return normalise({ units: divRound(numerator, denominator), scale: places });
}

/** Rounded to `places` decimals, half away from zero. */
export function round(d: Dec, places: number): Dec {
  if (d.scale <= places) return d;
  return normalise({ units: divRound(d.units, pow10(d.scale - places)), scale: places });
}

export const isZero = (d: Dec): boolean => d.units === 0n;
export const isNegative = (d: Dec): boolean => d.units < 0n;
export const negate = (d: Dec): Dec => ({ units: -d.units, scale: d.scale });
export const compare = (a: Dec, b: Dec): number => {
  const [x, y] = align(a, b);
  return x === y ? 0 : x < y ? -1 : 1;
};

/** Plain text with no grouping, e.g. "-1250.5" — what goes on the clipboard. */
export function toPlain(d: Dec): string {
  const negative = d.units < 0n;
  let digits = abs(d.units).toString();
  if (d.scale > 0) {
    digits = digits.padStart(d.scale + 1, '0');
    digits = `${digits.slice(0, -d.scale)}.${digits.slice(-d.scale)}`;
  }
  return `${negative ? '-' : ''}${digits}`;
}

const group = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * For the screen: grouped, at most `maxPlaces` decimals, and switched to
 * scientific notation only when the whole part would not fit.
 */
export function formatDec(d: Dec, maxPlaces = 10, fixedPlaces?: number): string {
  let value = round(d, fixedPlaces ?? maxPlaces);
  if (isZero(value)) value = ZERO;           // never show "-0"
  const plain = toPlain(value);
  const negative = plain.startsWith('-');
  const [whole, fraction = ''] = (negative ? plain.slice(1) : plain).split('.');
  if (whole.length > 15) return Number(plain).toExponential(8).replace('e+', 'e');
  const shownFraction = fixedPlaces === undefined ? fraction : fraction.padEnd(fixedPlaces, '0');
  return `${negative ? '−' : ''}${group(whole)}${shownFraction ? `.${shownFraction}` : ''}`;
}

/** Rupees and paisa: "Rs 1,250.50". */
export const formatRupees = (d: Dec): string => {
  const text = formatDec(d, 2, 2);
  return text.startsWith('−') ? `−Rs ${text.slice(1)}` : `Rs ${text}`;
};

/** A percentage to two places at most: "33.33%". */
export const formatPercent = (d: Dec): string => `${formatDec(d, 2)}%`;

/* ============================ the calculator ============================ */

export type Operator = '+' | '−' | '×' | '÷';
export const OPERATORS: Operator[] = ['+', '−', '×', '÷'];
const isOperator = (token: string): token is Operator => (OPERATORS as string[]).includes(token);

export interface HistoryEntry { expression: string; result: string }

export interface CalcState {
  /** Numbers (plain text) and operators already committed, in order. */
  tokens: string[];
  /** The number being typed, as typed. Empty when nothing is being typed. */
  entry: string;
  /** Set straight after "=", until the next key starts something new. */
  result: string | null;
  /** The sum that produced `result`, shown above it. */
  lastExpression: string;
  error: string | null;
  memory: string | null;
}

export const initialCalc: CalcState = {
  tokens: [], entry: '', result: null, lastExpression: '', error: null, memory: null
};

const MAX_DIGITS = 15;

/** Multiplication and division before addition and subtraction. */
export function evaluate(tokens: string[]): Dec {
  const numbers: Dec[] = [];
  const ops: Operator[] = [];
  tokens.forEach((token, index) => {
    if (index % 2 === 0) numbers.push(parseDec(token) ?? ZERO);
    else ops.push(token as Operator);
  });
  if (numbers.length === 0) return ZERO;

  /* First pass: × and ÷, left to right. */
  const terms: Dec[] = [numbers[0]];
  const joins: Operator[] = [];
  ops.forEach((op, i) => {
    const right = numbers[i + 1] ?? ZERO;
    if (op === '×') terms[terms.length - 1] = mul(terms[terms.length - 1], right);
    else if (op === '÷') terms[terms.length - 1] = div(terms[terms.length - 1], right);
    else { terms.push(right); joins.push(op); }
  });

  /* Second pass: + and −. */
  return joins.reduce((sum, op, i) => (op === '+' ? add(sum, terms[i + 1]) : sub(sum, terms[i + 1])), terms[0]);
}

/** The value the large display shows. */
export function displayValue(state: CalcState): string {
  if (state.error) return state.error;
  if (state.entry) return formatTyped(state.entry);
  if (state.result !== null) return formatDec(parseDec(state.result) ?? ZERO);
  const lastNumber = [...state.tokens].reverse().find((t) => !isOperator(t));
  return formatDec(parseDec(lastNumber ?? '0') ?? ZERO);
}

/** The value as a Dec, for copying, memory and "use in calculator". */
export function currentValue(state: CalcState): Dec {
  if (state.error) return ZERO;
  if (state.entry) return parseDec(state.entry) ?? ZERO;
  if (state.result !== null) return parseDec(state.result) ?? ZERO;
  const lastNumber = [...state.tokens].reverse().find((t) => !isOperator(t));
  return parseDec(lastNumber ?? '0') ?? ZERO;
}

/** What is being typed keeps its trailing "." or zeros: "12." and "0.50". */
function formatTyped(entry: string): string {
  const negative = entry.startsWith('-');
  const body = negative ? entry.slice(1) : entry;
  const [whole, fraction] = body.split('.');
  return `${negative ? '−' : ''}${group(whole || '0')}${fraction !== undefined ? `.${fraction}` : ''}`;
}

/** The line above the display: "1,250 × 3 + 675". */
export function expressionText(state: CalcState): string {
  if (state.result !== null || state.error) return state.lastExpression;
  const parts = state.tokens.map((t) => (isOperator(t) ? t : formatDec(parseDec(t) ?? ZERO)));
  if (state.entry) parts.push(formatTyped(state.entry));
  return parts.join(' ');
}

/** Ready for another number: after "=", or after an error. */
function fresh(state: CalcState): CalcState {
  return { ...initialCalc, memory: state.memory };
}

export function inputDigit(state: CalcState, digit: string): CalcState {
  const base = state.error || state.result !== null ? fresh(state) : state;
  const digits = base.entry.replace(/[-.]/g, '');
  if (digits.length >= MAX_DIGITS) return base;
  if (base.entry === '0') return { ...base, entry: digit };
  if (base.entry === '-0') return { ...base, entry: `-${digit}` };
  return { ...base, entry: base.entry + digit };
}

export function inputDot(state: CalcState): CalcState {
  const base = state.error || state.result !== null ? fresh(state) : state;
  if (base.entry.includes('.')) return base;
  if (base.entry === '' || base.entry === '-') return { ...base, entry: `${base.entry}0.` };
  return { ...base, entry: `${base.entry}.` };
}

export function inputOperator(state: CalcState, op: Operator): CalcState {
  if (state.error) return state;
  /* Carry a result straight into the next sum: "= then + 5". */
  if (state.result !== null) {
    return { ...state, tokens: [state.result, op], entry: '', result: null, lastExpression: '' };
  }
  const tokens = [...state.tokens];
  if (state.entry && state.entry !== '-') tokens.push(toPlain(parseDec(state.entry) ?? ZERO));
  if (tokens.length === 0) tokens.push('0');
  /* Pressing a different operator straight away changes it. */
  if (isOperator(tokens[tokens.length - 1])) tokens[tokens.length - 1] = op;
  else tokens.push(op);
  return { ...state, tokens, entry: '' };
}

/**
 * Percent, the way a shop calculator does it:
 *   200 + 10 %  →  200 + 20     (10% of what came before, then added)
 *   200 × 10 %  →  200 × 0.1
 *   50 %        →  0.5
 * So "1,250 × 3 + 18 %" adds 18% to 3,750 — GST on a line, in one go.
 */
export function inputPercent(state: CalcState): CalcState {
  if (state.error) return state;
  try {
    if (state.result !== null) {
      const value = div(parseDec(state.result) ?? ZERO, dec(100));
      return { ...fresh(state), entry: toPlain(value) };
    }
    if (!state.entry) return state;
    const typed = parseDec(state.entry) ?? ZERO;
    const last = state.tokens[state.tokens.length - 1];
    let value: Dec;
    if ((last === '+' || last === '−') && state.tokens.length >= 2) {
      const base = evaluate(state.tokens.slice(0, -1));
      value = div(mul(base, typed), dec(100));
    } else {
      value = div(typed, dec(100));
    }
    return { ...state, entry: toPlain(value) };
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : 'Error' };
  }
}

export function toggleSign(state: CalcState): CalcState {
  if (state.error) return state;
  if (state.result !== null) {
    const value = negate(parseDec(state.result) ?? ZERO);
    return { ...fresh(state), entry: toPlain(value) };
  }
  if (!state.entry) return { ...state, entry: '-' };
  return { ...state, entry: state.entry.startsWith('-') ? state.entry.slice(1) : `-${state.entry}` };
}

export function backspace(state: CalcState): CalcState {
  if (state.error) return fresh(state);
  if (state.result !== null) return state;
  if (state.entry) {
    const entry = state.entry.slice(0, -1);
    return { ...state, entry: entry === '-' ? '' : entry };
  }
  /* Nothing being typed: take back the last operator and edit the number. */
  if (state.tokens.length >= 2 && isOperator(state.tokens[state.tokens.length - 1])) {
    const tokens = state.tokens.slice(0, -2);
    return { ...state, tokens, entry: state.tokens[state.tokens.length - 2] };
  }
  return state;
}

/** "C" clears what is being typed; "AC" (pressed when nothing is) clears it all. */
export function clear(state: CalcState): CalcState {
  if (state.entry && !state.error && state.result === null) return { ...state, entry: '' };
  return fresh(state);
}

export const clearLabel = (state: CalcState): 'C' | 'AC' =>
  (state.entry && !state.error && state.result === null ? 'C' : 'AC');

export function equals(state: CalcState): { state: CalcState; history?: HistoryEntry } {
  if (state.error || state.result !== null) return { state };
  const tokens = [...state.tokens];
  if (state.entry && state.entry !== '-') tokens.push(toPlain(parseDec(state.entry) ?? ZERO));
  while (tokens.length && isOperator(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length < 3) {
    /* A lone number: nothing to work out, but treat it as a result so the
       next digit starts afresh. */
    const only = tokens[0] ?? '0';
    return { state: { ...state, tokens: [], entry: '', result: toPlain(parseDec(only) ?? ZERO), lastExpression: '' } };
  }
  const expression = tokens.map((t) => (isOperator(t) ? t : formatDec(parseDec(t) ?? ZERO))).join(' ');
  try {
    const value = evaluate(tokens);
    const result = toPlain(round(value, 12));
    return {
      state: { ...state, tokens: [], entry: '', result, lastExpression: `${expression} =` },
      history: { expression, result }
    };
  } catch (error) {
    return { state: { ...state, tokens: [], entry: '', error: error instanceof Error ? error.message : 'Error', lastExpression: `${expression} =` } };
  }
}

/** Starts a new number with a value from memory, history or a tool. */
export function recall(state: CalcState, value: Dec): CalcState {
  const base = state.error || state.result !== null ? fresh(state) : state;
  return { ...base, entry: toPlain(value) };
}

export function memoryAdd(state: CalcState, sign: 1 | -1): CalcState {
  const current = currentValue(state);
  const memory = parseDec(state.memory ?? '0') ?? ZERO;
  const next = sign === 1 ? add(memory, current) : sub(memory, current);
  return { ...state, memory: isZero(next) ? null : toPlain(next) };
}

export const memoryClear = (state: CalcState): CalcState => ({ ...state, memory: null });

export const memoryRecall = (state: CalcState): CalcState =>
  (state.memory === null ? state : recall(state, parseDec(state.memory) ?? ZERO));

/** One keyboard key, as the calculator understands it; null if it is not one. */
export function keyAction(key: string): string | null {
  if (/^\d$/.test(key)) return key;
  switch (key) {
    case '.': case ',': case 'Decimal': return '.';
    case '+': return '+';
    case '-': case '−': return '−';
    case '*': case 'x': case 'X': case '×': return '×';
    case '/': case '÷': return '÷';
    case '%': return '%';
    case 'Enter': case '=': return '=';
    case 'Backspace': return 'back';
    case 'Delete': return 'clear';
    default: return null;
  }
}

/** Applies one key. History, if any, is returned alongside the new state. */
export function press(state: CalcState, action: string): { state: CalcState; history?: HistoryEntry } {
  if (/^\d$/.test(action)) return { state: inputDigit(state, action) };
  if (isOperator(action)) return { state: inputOperator(state, action) };
  switch (action) {
    case '.': return { state: inputDot(state) };
    case '%': return { state: inputPercent(state) };
    case '=': return equals(state);
    case 'back': return { state: backspace(state) };
    case 'clear': return { state: clear(state) };
    case 'sign': return { state: toggleSign(state) };
    default: return { state };
  }
}

/* =========================== pharmacy tools ============================ */
/* Each takes what was typed (as text) and returns exact results, or null
   when the inputs are not yet complete. Money is rounded to the paisa only
   when it is shown. */

export interface DiscountResult { gross: Dec; discount: Dec; payable: Dec }
export function discountTool(price: string, percent: string, quantity: string): DiscountResult | null {
  const p = parseDec(price);
  const r = parseDec(percent || '0');
  const q = parseDec(quantity || '1');
  if (!p || !r || !q || isNegative(p) || isNegative(r) || isNegative(q)) return null;
  const gross = mul(p, q);
  const discount = div(mul(gross, r), dec(100));
  return { gross, discount, payable: sub(gross, discount) };
}

export interface TaxResult { net: Dec; tax: Dec; gross: Dec }
/** `inclusive` means the amount already contains the tax. */
export function taxTool(amount: string, rate: string, inclusive: boolean): TaxResult | null {
  const a = parseDec(amount);
  const r = parseDec(rate || '0');
  if (!a || !r || isNegative(a) || isNegative(r)) return null;
  if (inclusive) {
    const net = div(mul(a, dec(100)), add(dec(100), r));
    return { net, tax: sub(a, net), gross: a };
  }
  const tax = div(mul(a, r), dec(100));
  return { net: a, tax, gross: add(a, tax) };
}

export interface MarginResult { profit: Dec; margin: Dec | null; markup: Dec | null }
export function marginTool(cost: string, selling: string): MarginResult | null {
  const c = parseDec(cost);
  const s = parseDec(selling);
  if (!c || !s || isNegative(c) || isNegative(s)) return null;
  const profit = sub(s, c);
  return {
    profit,
    margin: isZero(s) ? null : div(mul(profit, dec(100)), s),
    markup: isZero(c) ? null : div(mul(profit, dec(100)), c)
  };
}

export interface ChangeResult { change: Dec; short: Dec }
export function changeTool(due: string, received: string): ChangeResult | null {
  const d = parseDec(due);
  const r = parseDec(received);
  if (!d || !r || isNegative(d) || isNegative(r)) return null;
  const difference = sub(r, d);
  return isNegative(difference)
    ? { change: ZERO, short: negate(difference) }
    : { change: difference, short: ZERO };
}

export interface UnitResult { perUnit: Dec; total: Dec }
export function unitTool(packPrice: string, unitsPerPack: string, unitsSold: string): UnitResult | null {
  const p = parseDec(packPrice);
  const u = parseDec(unitsPerPack);
  const q = parseDec(unitsSold || '1');
  if (!p || !u || !q || isNegative(p) || isNegative(q) || isZero(u) || isNegative(u)) return null;
  const perUnit = div(p, u);
  return { perUnit, total: mul(perUnit, q) };
}
