// General-purpose calculation engine.
// Gemini (or any LLM / app) writes a "calc sheet": named inputs + formula steps.
// This file evaluates it safely (no eval) and shows the work, so every number on screen is ours.
//
//   evaluateCalc({
//     inputs: [{ name: 'm', value: 16, unit: 'kg', label: 'Speaker mass', est: true }],
//     steps:  [{ name: 'W', expr: 'm * g', unit: 'N', label: 'Weight' }],
//     assumptions: ['...'],
//   })
//   -> { ok, quantities, lines, assumptions, errors, verdict }
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

// ---------- the sheet ----------
// points3d (optional): measured 3D points; inputs with a "measure" use them, else fall back to "value".
export function evaluateCalc(calc, points3d = null) {
  const assumptions = Array.isArray(calc?.assumptions) ? calc.assumptions.filter((a) => typeof a === 'string') : [];
  const errors = [];
  const quantities = {};
  const lines = [];
  const scope = Object.assign(Object.create(null), CONSTANTS);
  const taken = (n) => Object.hasOwn(scope, n) || Object.hasOwn(FUNCTIONS, n);

  for (const inp of Array.isArray(calc?.inputs) ? calc.inputs : []) {
    const { name, unit = '', label } = inp || {};
    if (typeof name !== 'string' || !NAME.test(name) || taken(name)) {
      errors.push(`bad or duplicate input name "${name}"`);
      continue;
    }
    const measured = inp.measure ? measure(inp.measure, points3d) : null;
    const value = measured ?? inp.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`input "${name}" is not a number`);
      continue;
    }
    scope[name] = round3(value);
    const est = measured === null && inp.est !== false;
    quantities[name] = { value: scope[name], unit, name: label || name, estimated: est, measured: measured !== null };
    const tag = measured !== null ? ' (measured)' : est ? ' (est.)' : '';
    lines.push(`${label || name}: ${name} ${est ? '≈' : '='} ${fmt(value)}${unitText(unit)}${tag}`);
  }

  const steps = Array.isArray(calc?.steps) ? calc.steps.slice(0, MAX_STEPS) : [];
  for (const step of steps) {
    const { name, expr, unit = '', label } = step || {};
    if (typeof name !== 'string' || !NAME.test(name) || taken(name)) {
      errors.push(`bad or duplicate step name "${name}"`);
      continue;
    }
    try {
      const ast = parse(expr);
      const v = evaluate(ast, scope);
      if (!Number.isFinite(v)) throw new Error('result is not a finite number (divide by zero?)');
      scope[name] = round3(v);
      quantities[name] = { value: scope[name], unit, name: label || name, estimated: false };
      const work = ast.t === 'num' || ast.t === 'var' ? '' : ` = ${show(ast, scope)}`;
      lines.push(`${label || name}: ${name}${work} = ${fmt(v)}${unitText(unit)}`);
    } catch (e) {
      errors.push(`step "${name}": ${e.message}`);
    }
  }

  // Verdict: our code picks the conclusion from the number, so the caption can never contradict the math.
  // calc.verdict = { expr: "M_tip - M_rest", if_positive: "It would tip over.", if_not: "It stays up." }
  let verdict = null;
  const v = calc?.verdict;
  if (v && typeof v === "object") {
    try {
      if (typeof v.if_positive !== "string" || typeof v.if_not !== "string") throw new Error("needs if_positive and if_not text");
      const ast = parse(v.expr);
      const x = evaluate(ast, scope);
      if (!Number.isFinite(x)) throw new Error("result is not a finite number");
      const text = x > 0 ? v.if_positive : v.if_not;
      verdict = { value: round3(x), text };
      lines.push(`Check: ${show(ast, scope)} = ${fmt(x)} ${x > 0 ? ">" : "≤"} 0 → ${text}`);
    } catch (e) {
      errors.push(`verdict: ${e.message}`);
    }
  }

  const ok = errors.length === 0 && steps.length > 0;
  return { ok, quantities, lines, assumptions, errors, verdict };
}

// Label text for a draw item, per CONTRACT.md "How quantity is displayed".
export function formatLabel(label, quantityKey, result) {
  const q = quantityKey && result?.quantities ? result.quantities[quantityKey] : null;
  if (!q) return label || '';
  const name = label || q.name;
  const unit = unitText(q.unit);
  if (q.estimated) return `${name} ≈ ${fmt(q.value)}${unit} (est.)`;
  return `${name} = ${fmt(q.value)}${unit}${q.measured ? ' (measured)' : ''}`;
}
