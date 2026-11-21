// General-purpose calculation CHECKER.
// Any model (Gemini, Claude, GPT, ...) writes a "calc sheet": named inputs, formula steps AND its own results.
// This file re-computes every step safely (no eval), marks each one ✓ or ⚠, and checks the yes/no verdict.
// When an input changes live (slider, teammate, measurement), it re-runs the model's formulas.
//
//   evaluateCalc({
//     inputs: [{ name: 'm', value: 16, unit: 'kg', label: 'Speaker mass', est: true }],
//     steps:  [{ name: 'W', expr: 'm * g', value: 157, unit: 'N', label: 'Weight' }],
//     assumptions: ['...'],
//   })
//   -> { ok, verified, mismatches, quantities, lines, assumptions, errors, verdict }
//
// Pure JS, no DOM, JSON in / JSON out: usable in the browser, on the server, or as an LLM tool.

const CONSTANTS = { g: 9.81, pi: Math.PI };
const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, min: Math.min, max: Math.max,
  deg: (r) => (r * 180) / Math.PI, // radians -> degrees
  rad: (d) => (d * Math.PI) / 180, // degrees -> radians
};
const NAME = /^(?!__)[A-Za-z_][A-Za-z0-9_]{0,31}$/; // no "__proto__"-style names
const MAX_STEPS = 20;

// 3 significant figures; each step uses the previous ROUNDED values so printed lines check out.
export const round3 = (n) => Number(n.toPrecision(3));
export const fmt = (n) => String(round3(n));

// ---------- parser: expr -> AST ----------
// AST: {t:'num',v} | {t:'var',n} | {t:'neg',a} | {t:'op',o,a,b} | {t:'call',f,args}
export function parse(src) {
  const toks = String(src).match(/\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|\S/g) || [];
  let i = 0;
  const peek = () => toks[i];
  const take = (want) => {
    const t = toks[i++];
    if (want && t !== want) throw new Error(`expected "${want}" but got "${t ?? 'end'}"`);
    return t;
  };
  const expr = () => {
    let a = term();
    while (peek() === '+' || peek() === '-') a = { t: 'op', o: take(), a, b: term() };
    return a;
  };
  const term = () => {
    let a = unary();
    while (peek() === '*' || peek() === '/') a = { t: 'op', o: take(), a, b: unary() };
    return a;
  };
  const unary = () => (peek() === '-' ? (take(), { t: 'neg', a: unary() }) : power());
  const power = () => {
    const a = atom();
    return peek() === '^' ? (take(), { t: 'op', o: '^', a, b: unary() }) : a;
  };
  const atom = () => {
    const t = take();
    if (t === undefined) throw new Error('unexpected end of formula');
    if (t === '(') {
      const e = expr();
      take(')');
      return e;
    }
    if (/^\d|^\./.test(t)) return { t: 'num', v: Number(t) };
    if (NAME.test(t)) {
      if (peek() !== '(') return { t: 'var', n: t };
      take('(');
      const args = [];
      if (peek() !== ')') {
        args.push(expr());
        while (peek() === ',') take(), args.push(expr());
      }
      take(')');
      if (!Object.hasOwn(FUNCTIONS, t)) throw new Error(`unknown function "${t}"`);
      return { t: 'call', f: t, args };
    }
    throw new Error(`unexpected "${t}"`);
  };
  const ast = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`);
  return ast;
}

export function evaluate(ast, scope) {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'var':
      if (Object.hasOwn(scope, ast.n)) return scope[ast.n];
      throw new Error(`unknown name "${ast.n}"`);
    case 'neg': return -evaluate(ast.a, scope);
    case 'call': return FUNCTIONS[ast.f](...ast.args.map((a) => evaluate(a, scope)));
    case 'op': {
      const a = evaluate(ast.a, scope), b = evaluate(ast.b, scope);
      if (ast.o === '+') return a + b;
      if (ast.o === '-') return a - b;
      if (ast.o === '*') return a * b;
      if (ast.o === '/') return a / b;
      return a ** b;
    }
  }
}

// Print an AST with each name replaced by its (rounded) number: "(16 + 4) × 9.81".
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
export function show(ast, scope, parentPrec = 0, rightSide = false) {
  switch (ast.t) {
    case 'num': return fmt(ast.v);
    case 'var': return scope[ast.n] < 0 ? `(${fmt(scope[ast.n])})` : fmt(scope[ast.n]);
    case 'neg': return `-${show(ast.a, scope, 4)}`;
    case 'call': return `${ast.f}(${ast.args.map((a) => show(a, scope)).join(', ')})`;
    case 'op': {
      const p = PREC[ast.o];
      const sym = ast.o === '*' ? '×' : ast.o;
      const s = `${show(ast.a, scope, p)} ${sym} ${show(ast.b, scope, p, true)}`;
      const needParens =
        p < parentPrec ||
        (p === parentPrec && rightSide && ast.o !== '+' && ast.o !== '*') ||
        (p === parentPrec && !rightSide && ast.o === '^');
      return needParens ? `(${s})` : s;
    }
  }
}

const unitText = (u) => (!u ? '' : u === '°' ? '°' : ` ${u}`);

// ---------- measurements ----------
// points3d: { [pointId]: [x, y, z] } in meters, WebXR convention (y is UP), from the phone's depth/hit-test.
// measure: { kind: 'distance' | 'horizontal' | 'vertical', from: pointId, to: pointId }
export function measure(m, points3d) {
  const a = points3d?.[m?.from], b = points3d?.[m?.to];
  const ok = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (!ok(a) || !ok(b)) return null;
  const [dx, dy, dz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  if (m.kind === 'distance') return Math.hypot(dx, dy, dz);
  if (m.kind === 'horizontal') return Math.hypot(dx, dz);
  if (m.kind === 'vertical') return Math.abs(dy);
  return null;
}

// "adjustable": { min, max } marks an input users can change live (e.g. a load slider).
function rangeOf(a) {
  return a && Number.isFinite(a.min) && Number.isFinite(a.max) && a.min < a.max ? { min: a.min, max: a.max } : null;
}
function clampToRange(v, a) {
  const r = rangeOf(a);
  return r ? Math.min(r.max, Math.max(r.min, v)) : v;
}

// ---------- the sheet ----------
// points3d (optional): measured 3D points; inputs with a "measure" use them, else fall back to "value".
// overrides (optional): { name: { value, by } } set live by a user or teammate (sliders, shared session).
//   They win over measurements and estimates, clamped to the input's "adjustable" range if it has one.
export function evaluateCalc(calc, points3d = null, overrides = null) {
  const assumptions = Array.isArray(calc?.assumptions) ? calc.assumptions.filter((a) => typeof a === 'string') : [];
  const errors = [];
  const quantities = {};
  const lines = [];
  const scope = Object.assign(Object.create(null), CONSTANTS);
  const taken = (n) => Object.hasOwn(scope, n) || Object.hasOwn(FUNCTIONS, n);
  const changed = new Set(); // names whose value differs from what the model wrote

  for (const inp of Array.isArray(calc?.inputs) ? calc.inputs : []) {
    const { name, unit = '', label } = inp || {};
    if (typeof name !== 'string' || !NAME.test(name) || taken(name)) {
      errors.push(`bad or duplicate input name "${name}"`);
      continue;
    }
    const o = overrides && Object.hasOwn(overrides, name) ? overrides[name] : null;
    const set = o && Number.isFinite(o.value) ? clampToRange(o.value, inp.adjustable) : null;
    const measured = set === null && inp.measure ? measure(inp.measure, points3d) : null;
    const value = set ?? measured ?? inp.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`input "${name}" is not a number`);
      continue;
    }
    scope[name] = round3(value);
    if (value !== inp.value) changed.add(name); // downstream results the model wrote are now stale
    const est = set === null && measured === null && inp.est !== false;
    quantities[name] = {
      value: scope[name], unit, name: label || name, estimated: est, measured: measured !== null,
      set: set !== null, by: set !== null ? o.by || null : null, adjustable: rangeOf(inp.adjustable),
    };
    const tag = set !== null ? (o.by ? ` (set by ${o.by})` : ' (set)') : measured !== null ? ' (measured)' : est ? ' (est.)' : '';
    lines.push(`${label || name}: ${name} ${est ? '≈' : '='} ${fmt(value)}${unitText(unit)}${tag}`);
  }

  const steps = Array.isArray(calc?.steps) ? calc.steps.slice(0, MAX_STEPS) : [];
  const mismatches = [];
  for (const step of steps) {
    const { name, expr, unit = '', label } = step || {};
    if (typeof name !== 'string' || !NAME.test(name) || taken(name)) {
      errors.push(`bad or duplicate step name "${name}"`);
      continue;
    }
    try {
      const ast = parse(expr);
      const computed = evaluate(ast, scope);
      if (!Number.isFinite(computed)) throw new Error('result is not a finite number (divide by zero?)');
      const claimed = typeof step.value === 'number' && Number.isFinite(step.value) ? step.value : null;
      const stale = dependsOn(ast, changed);
      let value, check;
      if (claimed !== null && !stale) {
        // Audit the model's own arithmetic, using the model's own values for everything upstream.
        check = agrees(claimed, computed) ? 'ok' : 'mismatch';
        value = claimed;
        if (check === 'mismatch') mismatches.push({ name, claimed, computed: round3(computed) });
      } else {
        // No result given, or an input upstream changed (slider, teammate, measurement): re-run the formula.
        check = claimed === null ? 'computed' : 'updated';
        value = round3(computed);
        if (claimed !== null && !agrees(claimed, computed)) changed.add(name);
      }
      if (check === 'computed') changed.add(name);
      scope[name] = value;
      quantities[name] = { value, unit, name: label || name, estimated: false, check, ...(check === 'mismatch' && { expected: round3(computed) }) };
      const work = ast.t === 'num' || ast.t === 'var' ? '' : ` = ${show(ast, scope)}`;
      const mark =
        check === 'ok' ? ' ✓' : check === 'mismatch' ? ` ⚠ checker gets ${fmt(computed)}${unitText(unit)}` : check === 'updated' ? ' (updated)' : '';
      lines.push(`${label || name}: ${name}${work} = ${fmt(value)}${unitText(unit)}${mark}`);
    } catch (e) {
      errors.push(`step "${name}": ${e.message}`);
    }
  }

  // Verdict: the model states its yes/no conclusion and the formula behind it; we check they agree.
  // calc.verdict = { expr: "M_tip - M_rest", if_positive: "It tips.", if_not: "It stays up.", claim: "positive" | "not" }
  let verdict = null;
  const v = calc?.verdict;
  if (v && typeof v === 'object') {
    try {
      if (typeof v.if_positive !== 'string' || typeof v.if_not !== 'string') throw new Error('needs if_positive and if_not text');
      const ast = parse(v.expr);
      const x = evaluate(ast, scope);
      if (!Number.isFinite(x)) throw new Error('result is not a finite number');
      const sign = x > 0 ? 'positive' : 'not';
      const claim = v.claim === 'positive' || v.claim === 'not' ? v.claim : null;
      const stale = dependsOn(ast, changed);
      const check = claim === null ? 'computed' : stale ? 'updated' : claim === sign ? 'ok' : 'mismatch';
      const shown = check === 'mismatch' ? claim : sign; // show the model's claim, flagged, if it disagrees
      const text = shown === 'positive' ? v.if_positive : v.if_not;
      verdict = { value: round3(x), text, check, ...(check === 'mismatch' && { expected: sign === 'positive' ? v.if_positive : v.if_not }) };
      if (check === 'mismatch') mismatches.push({ name: 'verdict', claimed: claim, computed: sign });
      const mark = check === 'ok' ? ' ✓' : check === 'mismatch' ? ` ⚠ the numbers say: ${verdict.expected}` : check === 'updated' ? ' (updated)' : '';
      lines.push(`Check: ${show(ast, scope)} = ${fmt(x)} ${x > 0 ? '>' : '≤'} 0 → ${text}${mark}`);
    } catch (e) {
      errors.push(`verdict: ${e.message}`);
    }
  }

  const ok = errors.length === 0 && steps.length > 0;
  return { ok, verified: ok && mismatches.length === 0, mismatches, quantities, lines, assumptions, errors, verdict };
}

// Does this formula use any of these names?
function dependsOn(ast, names) {
  if (!names.size) return false;
  switch (ast.t) {
    case 'var': return names.has(ast.n);
    case 'neg': return dependsOn(ast.a, names);
    case 'op': return dependsOn(ast.a, names) || dependsOn(ast.b, names);
    case 'call': return ast.args.some((a) => dependsOn(a, names));
    default: return false;
  }
}

// The model's number vs ours: 1.5% relative (models round as they go), or tiny absolute near zero.
const agrees = (claimed, computed) => Math.abs(claimed - computed) <= 0.015 * Math.abs(computed) + 1e-6;

// Label text for a draw item, per CONTRACT.md "How quantity is displayed".
export function formatLabel(label, quantityKey, result) {
  const q = quantityKey && result?.quantities ? result.quantities[quantityKey] : null;
  if (!q) return label || '';
  const name = label || q.name;
  const unit = unitText(q.unit);
  if (q.estimated) return `${name} ≈ ${fmt(q.value)}${unit} (est.)`;
  const tag = q.set ? (q.by ? ` (set by ${q.by})` : ' (set)') : q.measured ? ' (measured)' : '';
  return `${name} = ${fmt(q.value)}${unit}${tag}`;
}

// ---------- text audit ----------
// Numbers with units in free text (the caption, panel text) must match something the checker knows:
// an input, a checked step, a number written in a formula, or a unit conversion of one of those.
// Returns the numbers it could not trace, e.g. [{ text: '107 N', value: 107, unit: 'N' }].
const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(N·m|N\*m|Nm|N|kN|kg|lbs?|lbf|m|cm|mm|°|deg|MPa|%)(?![A-Za-z])/g;
const CONVERSIONS = [1, 2.20462, 1 / 2.20462, 4.44822, 1 / 4.44822, 100, 0.01, 1000, 0.001, 9.81, 1 / 9.81];

export function auditText(text, result, calc = null) {
  if (typeof text !== 'string' || !text) return [];
  const known = Object.values(result?.quantities || {}).map((q) => q.value).filter(Number.isFinite);
  for (const s of Array.isArray(calc?.steps) ? calc.steps : []) {
    for (const m of String(s?.expr ?? '').matchAll(/\d*\.?\d+/g)) known.push(Number(m[0]));
  }
  if (result?.verdict) {
    for (const m of String(calc?.verdict?.expr ?? '').matchAll(/\d*\.?\d+/g)) known.push(Number(m[0]));
  }
  // A rounded mention counts: "about 8 N" traces to 8.23 at the number of significant digits written.
  const sigDigits = (raw) => raw.replace(/^0+.?0*/, '').replace('.', '').replace(/0+$/, '').length || 1;
  const roundTo = (x, d) => Number(x.toPrecision(Math.max(1, Math.min(21, d))));
  const traced = (v, digits) =>
    known.some((k) =>
      CONVERSIONS.some((c) => {
        const kc = k * c;
        const close = Math.abs(kc - v) <= 0.015 * Math.abs(v) + 0.05;
        const rounded = roundTo(kc, digits) === v && Math.abs(kc - v) <= 0.08 * Math.abs(kc);
        return close || rounded;
      }),
    );
  const out = [];
  for (const m of text.matchAll(UNIT_RE)) {
    const raw = m[1].replace(',', '.');
    const value = Number(raw);
    if (!traced(value, sigDigits(raw))) out.push({ text: m[0], value, unit: m[2] });
  }
  return out;
}
