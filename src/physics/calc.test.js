import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalc, formatLabel, parse, evaluate, measure } from './calc.js';
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

test('measured inputs: 3D points from the phone replace estimates', () => {
  // WebXR: y is up. Two chair feet 0.42 m apart on the floor, seat 0.45 m up.
  const pts = { foot_fl: [0, 0, 0], foot_bl: [0.3, 0, -0.294], seat: [0.15, 0.45, -0.15] };
  assert.ok(near(measure({ kind: 'horizontal', from: 'foot_fl', to: 'foot_bl' }, pts), 0.42));
  assert.ok(near(measure({ kind: 'vertical', from: 'foot_fl', to: 'seat' }, pts), 0.45));
  assert.equal(measure({ kind: 'horizontal', from: 'foot_fl', to: 'missing' }, pts), null);
  assert.equal(measure({ kind: 'sideways', from: 'foot_fl', to: 'seat' }, pts), null);

  const sheet = {
    inputs: [
      { name: 'm', value: 6, unit: 'kg', label: 'Chair mass' },
      { name: 'd', value: 0.4, unit: 'm', label: 'Leg spread', measure: { kind: 'horizontal', from: 'foot_fl', to: 'foot_bl' } },
    ],
    steps: [{ name: 'M', expr: 'm * g * d / 2', unit: 'N·m', label: 'Restoring moment' }],
  };
  const withPts = evaluateCalc(sheet, pts);
  assert.equal(withPts.lines[1], 'Leg spread: d = 0.42 m (measured)');
  assert.equal(formatLabel('d', 'd', withPts), 'd = 0.42 m (measured)');
  const noPts = evaluateCalc(sheet); // measurement unavailable: Gemini's estimate is used
  assert.equal(noPts.lines[1], 'Leg spread: d ≈ 0.4 m (est.)');
  assert.equal(noPts.ok, true);
});

test('overrides: a teammate sets an input live; clamped to its adjustable range', () => {
  const sheet = {
    inputs: [
      { name: 'm_person', value: 80, unit: 'kg', label: 'Person', adjustable: { min: 0, max: 200 } },
      { name: 'a', value: 0.2, unit: 'm', label: 'Lever arm' },
    ],
    steps: [{ name: 'M', expr: 'm_person * g * a', unit: 'N·m', label: 'Moment' }],
  };
  const base = evaluateCalc(sheet);
  assert.equal(base.quantities.M.value, 157);
  assert.deepEqual(base.quantities.m_person.adjustable, { min: 0, max: 200 });
  const set = evaluateCalc(sheet, null, { m_person: { value: 120, by: 'austin' } });
  assert.equal(set.lines[0], 'Person: m_person = 120 kg (set by austin)');
  assert.equal(set.quantities.M.value, 235);
  const clamped = evaluateCalc(sheet, null, { m_person: { value: 999 } });
  assert.equal(clamped.quantities.m_person.value, 200);
  const ignored = evaluateCalc(sheet, null, { m_person: { value: 'x' }, nope: { value: 1 } });
  assert.equal(ignored.quantities.M.value, 157);
});

test('checker: the model does the math, we verify each step and the verdict', () => {
  const sheet = {
    inputs: [
      { name: 'm', value: 3.5, unit: 'kg', label: 'Chair mass', adjustable: { min: 1, max: 20 } },
      { name: 'd', value: 0.18, unit: 'm', label: 'CG to rear feet' },
      { name: 'h', value: 0.75, unit: 'm', label: 'Push height' },
    ],
    steps: [
      { name: 'W', expr: 'm * g', value: 34.3, unit: 'N', label: 'Weight' },
      { name: 'M', expr: 'W * d', value: 6.17, unit: 'N·m', label: 'Restoring moment' },
      { name: 'F', expr: 'M / h', value: 9.5, unit: 'N', label: 'Push to tip' }, // wrong: 6.17/0.75 = 8.23
    ],
    verdict: { expr: 'F - 5', if_positive: 'A 5 N push will not tip it.', if_not: 'A 5 N push tips it.', claim: 'positive' },
  };
  const r = evaluateCalc(sheet);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.verified, false);
  assert.equal(r.quantities.W.check, 'ok');
  assert.equal(r.quantities.M.check, 'ok');
  assert.equal(r.quantities.F.check, 'mismatch');
  assert.equal(r.quantities.F.value, 9.5); // the model's number is shown...
  assert.equal(r.quantities.F.expected, 8.23); // ...with ours next to it
  assert.equal(r.lines[3], 'Weight: W = 3.5 × 9.81 = 34.3 N ✓');
  assert.equal(r.lines[5], 'Push to tip: F = 6.17 / 0.75 = 9.5 N ⚠ checker gets 8.23 N');
  assert.equal(r.verdict.check, 'ok'); // 9.5 - 5 > 0 agrees with "positive"
  assert.deepEqual(r.mismatches, [{ name: 'F', claimed: 9.5, computed: 8.23 }]);

  // Correct sheet: everything verified.
  const good = structuredClone(sheet);
  good.steps[2].value = 8.23;
  assert.equal(evaluateCalc(good).verified, true);

  // Wrong conclusion is flagged.
  const badClaim = structuredClone(good);
  badClaim.verdict.claim = 'not';
  const b = evaluateCalc(badClaim);
  assert.equal(b.verdict.check, 'mismatch');
  assert.equal(b.verdict.text, 'A 5 N push tips it.');
  assert.equal(b.verdict.expected, 'A 5 N push will not tip it.');

  // A slider changes the mass: every downstream step and the verdict re-run from the model's formulas.
  const live = evaluateCalc(good, null, { m: { value: 10, by: 'austin' } });
  assert.equal(live.quantities.W.check, 'updated');
  assert.equal(live.quantities.W.value, 98.1);
  assert.equal(live.quantities.F.check, 'updated');
  assert.ok(Math.abs(live.quantities.F.value - 23.5) < 0.2); // 10 * 9.81 * 0.18 / 0.75
  assert.equal(live.verdict.check, 'updated');
  assert.equal(live.verified, true);
});

test('text audit: numbers in the caption must trace back to checked values', async () => {
  const { auditText } = await import('./calc.js');
  const calc = {
    inputs: [
      { name: 'm_person', value: 113, unit: 'kg' },
      { name: 'm_chair', value: 3.5, unit: 'kg' },
      { name: 'd', value: 0.2, unit: 'm' },
      { name: 'h', value: 0.82, unit: 'm' },
    ],
    steps: [
      { name: 'W', expr: '(m_person + m_chair) * g', value: 1140, unit: 'N' },
      { name: 'F_tip', expr: 'W * d / h', value: 278, unit: 'N' },
    ],
    verdict: { expr: '300 - m_person * 2.21', if_positive: 'ok', if_not: 'no', claim: 'positive' },
  };
  const r = evaluateCalc(calc);
  const caption =
    'It can hold a 250 lb (113 kg) person; it is rated for 300 lbs. With someone seated it takes 279 N (62.7 lbs) ' +
    'to tip it, but pushing back with just 24 lbs (107 N) will tip it.';
  assert.deepEqual(auditText(caption, r, calc).map((x) => x.text), ['24 lbs', '107 N']);
  assert.deepEqual(auditText('No numbers here.', r, calc), []);
});
