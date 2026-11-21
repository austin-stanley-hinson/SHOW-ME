// Run: node --test src/physics/ api/_lib/
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePhysics, formatLabel } from './physics.js';

const speaker = {
  model: 'wall_mount',
  inputs: { mass_kg: 5, lever_arm_m: 0.1, bolt_spacing_m: 0.08, bolt_count: 2 },
  assumptions: ['Speakers this size are 4–6 kg'],
};

const near = (a, b) => Math.abs(a - b) <= 0.006 * Math.abs(b) + 1e-9; // 3 significant figures

test('wall_mount matches the contract example', () => {
  const r = computePhysics(speaker);
  assert.equal(r.ok, true);
  assert.ok(near(r.quantities.weight.value, 49.05));
  assert.ok(near(r.quantities.shear_per_bolt.value, 24.525));
  assert.ok(near(r.quantities.moment.value, 4.905));
  assert.ok(near(r.quantities.top_bolt_tension.value, 61.3125));
  assert.equal(r.quantities.wall_reaction.value, r.quantities.top_bolt_tension.value);
  assert.equal(r.lines.length, 4);
});

// Every "a × b = c" or "a / b = c" printed in the panel must hold on a calculator.
test('every panel line is arithmetically consistent', () => {
  const inputs = [
    speaker.inputs,
    { mass_kg: 3.7, lever_arm_m: 0.13, bolt_spacing_m: 0.06, bolt_count: 3 },
    { mass_kg: 12, lever_arm_m: 0.25, bolt_spacing_m: 0.11, bolt_count: 4 },
    { mass_kg: 0.8, lever_arm_m: 0.05, bolt_spacing_m: 0.03, bolt_count: 2 },
  ];
  for (const i of inputs) {
    const r = computePhysics({ ...speaker, inputs: i });
    let checked = 0;
    for (const line of r.lines) {
      for (const [, a, op, b, c] of line.matchAll(/([\d.]+) ([×/]) ([\d.]+) = ([\d.]+)/g)) {
        const exact = op === '×' ? Number(a) * Number(b) : Number(a) / Number(b);
        assert.ok(near(exact, Number(c)), `${a} ${op} ${b} = ${c} (exact ${exact}) in "${line}"`);
        checked++;
      }
    }
    assert.equal(checked, 4);
  }
});

test('labels follow "How quantity is displayed"', () => {
  const r = computePhysics(speaker);
  assert.equal(formatLabel('W', 'weight', r), `W = ${r.quantities.weight.value} N`);
  assert.equal(formatLabel('d', 'lever_arm_m', r), 'd ≈ 0.1 m (est.)');
  assert.equal(formatLabel(undefined, 'top_bolt_tension', r), `Top bolt tension = ${r.quantities.top_bolt_tension.value} N`);
  assert.equal(formatLabel('W', 'weight', computePhysics(null)), 'W');
});

test('bad input never throws and shows no numbers', () => {
  for (const bad of [null, {}, { model: 'nope' }, { ...speaker, inputs: { ...speaker.inputs, mass_kg: -1 } },
    { ...speaker, inputs: { mass_kg: 5 } }, { ...speaker, inputs: { ...speaker.inputs, bolt_count: '2' } }]) {
    const r = computePhysics(bad);
    assert.equal(r.ok, false);
    assert.deepEqual(r.lines, []);
  }
});
