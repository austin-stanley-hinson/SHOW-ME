import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalc, formatLabel, parse, evaluate } from './calc.js';
import { tripodReference } from './reference/tripod.js';

const near = (a, b, rel = 0.006) => Math.abs(a - b) <= rel * Math.abs(b) + 1e-9;

// A sheet the way Gemini would write it for the venue speaker.
const tripodSheet = {
  inputs: [
    { name: 'm_spk', value: 16, unit: 'kg', label: 'Speaker mass' },
    { name: 'm_stand', value: 4, unit: 'kg', label: 'Stand mass' },
    { name: 'r', value: 0.55, unit: 'm', label: 'Leg radius' },
    { name: 'h_cm', value: 1.4, unit: 'm', label: 'Center of mass height' },
    { name: 'h_push', value: 1.75, unit: 'm', label: 'Push height' },
  ],
  steps: [
    { name: 'W', expr: '(m_spk + m_stand) * g', unit: 'N', label: 'Total weight' },
    { name: 'F_leg', expr: 'W / 3', unit: 'N', label: 'Each leg' },
    { name: 'e', expr: 'r / 2', unit: 'm', label: 'Tip edge' },
    { name: 'M', expr: 'W * e', unit: 'N·m', label: 'Moment to tip' },
    { name: 'F_tip', expr: 'M / h_push', unit: 'N', label: 'Push to tip' },
    { name: 'theta', expr: 'deg(atan(e / h_cm))', unit: '°', label: 'Lean limit' },
  ],
  assumptions: ['12-inch PA speakers are 14–18 kg'],
};

test('tripod sheet: shows its work', () => {
  const r = evaluateCalc(tripodSheet);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.lines.slice(5), [
    'Total weight: W = (16 + 4) × 9.81 = 196 N',
    'Each leg: F_leg = 196 / 3 = 65.3 N',
    'Tip edge: e = 0.55 / 2 = 0.275 m',
    'Moment to tip: M = 196 × 0.275 = 53.9 N·m',
    'Push to tip: F_tip = 53.9 / 1.75 = 30.8 N',
    'Lean limit: theta = deg(atan(0.275 / 1.4)) = 11.1°',
  ]);
  assert.equal(r.lines[0], 'Speaker mass: m_spk ≈ 16 kg (est.)');
  assert.equal(formatLabel('Push to tip', 'F_tip', r), 'Push to tip = 30.8 N');
  assert.equal(formatLabel('r', 'r', r), 'r ≈ 0.55 m (est.)');
});

test("tripod sheet agrees with Josh's hand model (reference/tripod.js)", () => {
  const cases = [
    [16, 4, 0.55, 1.4, 1.75],
    [10.4, 2.5, 0.45, 1.2, 1.5],
    [25, 6, 0.7, 1.8, 2.1],
  ];
  for (const [m, ms, rr, hcm, hp] of cases) {
    const sheet = structuredClone(tripodSheet);
    [m, ms, rr, hcm, hp].forEach((v, k) => (sheet.inputs[k].value = v));
    const q = evaluateCalc(sheet).quantities;
    const ref = tripodReference({ mass_kg: m, stand_mass_kg: ms, leg_radius_m: rr, com_height_m: hcm, push_height_m: hp });
    // 2% allows for chained 3-significant-figure rounding.
    assert.ok(near(q.W.value, ref.weight_N, 0.02));
    assert.ok(near(q.F_leg.value, ref.leg_load_N, 0.02));
    assert.ok(near(q.F_tip.value, ref.tip_force_N, 0.02));
    assert.ok(near(q.theta.value, ref.tip_angle_deg, 0.02));
  }
});

// Self-check: every "a = <work> = result" line must re-evaluate to its printed result.
function checkLines(result) {
  let checked = 0;
  for (const line of result.lines) {
    const parts = line.split(': ').slice(1).join(': ').split(' = ');
    if (parts.length < 3) continue;
    const work = parts[1].replaceAll('×', '*');
    const shown = parseFloat(parts[2]);
    const exact = evaluate(parse(work), {});
    assert.ok(near(exact, shown), `"${line}" re-evaluates to ${exact}`);
    checked++;
  }
  return checked;
}

test('every printed line re-evaluates to its printed result', () => {
  assert.equal(checkLines(evaluateCalc(tripodSheet)), 6);
  const beam = {
    inputs: [
      { name: 'P', value: 700, unit: 'N', label: 'Person' },
      { name: 'L', value: 2.4, unit: 'm', label: 'Span' },
      { name: 'b', value: 0.04, unit: 'm' },
      { name: 'd', value: 0.19, unit: 'm' },
    ],
    steps: [
      { name: 'M_max', expr: 'P * L / 4', unit: 'N·m', label: 'Max bending moment' },
      { name: 'S', expr: 'b * d^2 / 6', unit: 'm³', label: 'Section modulus' },
      { name: 'sigma', expr: 'M_max / S / 10^6', unit: 'MPa', label: 'Max stress' },
      { name: 'x', expr: '-(L - 2*L) ^ 2 + sqrt(P) - (P - (L - b))', label: 'Nonsense but tricky' },
    ],
  };
  const r = evaluateCalc(beam);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(checkLines(r), 4);
});

test('bad sheets report errors and never throw', () => {
  const r = evaluateCalc({
    inputs: [
      { name: 'a', value: 2 },
      { name: 'a', value: 3 }, // duplicate
      { name: 'g', value: 1 }, // shadows constant
      { name: 'x', value: 'big' }, // not a number
      { name: '__proto__', value: 1 },
    ],
    steps: [
      { name: 'b', expr: 'a / 0' },
      { name: 'c', expr: 'nope * 2' },
      { name: 'd', expr: 'process.exit()' },
      { name: 'e', expr: 'constructor(1)' },
      { name: 'f', expr: 'toString + 1' },
      { name: 'h', expr: 'a * (2' },
      { name: 'ok1', expr: 'a * g' },
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 10);
  assert.equal(r.quantities.ok1.value, 19.6); // good steps still computed
  for (const bad of [null, {}, { steps: 'x' }, { inputs: [null], steps: [null] }]) {
    assert.equal(evaluateCalc(bad).ok, false);
  }
});

test('verdict: code picks the conclusion from the number', () => {
  const sheet = (d_bag) => ({
    inputs: [
      { name: 'W', value: 181, unit: 'N' },
      { name: 'e', value: 0.225, unit: 'm' },
      { name: 'm_bag', value: 5, unit: 'kg', est: false },
      { name: 'd_bag', value: d_bag, unit: 'm' },
    ],
    steps: [
      { name: 'M_rest', expr: 'W * e', unit: 'N·m' },
      { name: 'M_tip', expr: 'm_bag * g * (d_bag - e)', unit: 'N·m' },
    ],
    verdict: { expr: 'M_tip - M_rest', if_positive: 'It would tip over.', if_not: 'It stays up.' },
  });
  const safe = evaluateCalc(sheet(0.25));
  assert.equal(safe.ok, true, safe.errors.join('; '));
  assert.equal(safe.verdict.text, 'It stays up.');
  assert.match(safe.lines.at(-1), /^Check: .* ≤ 0 → It stays up\.$/);
  const tips = evaluateCalc(sheet(1.2));
  assert.equal(tips.verdict.text, 'It would tip over.');
  const broken = evaluateCalc({ ...sheet(0.25), verdict: { expr: 'nope', if_positive: 'a', if_not: 'b' } });
  assert.equal(broken.ok, false);
  assert.equal(broken.verdict, null);
});
