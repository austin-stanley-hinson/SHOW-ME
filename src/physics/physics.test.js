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

const tripod = {
  model: 'tripod_stand',
  inputs: { mass_kg: 16, stand_mass_kg: 4, leg_radius_m: 0.55, com_height_m: 1.4, push_height_m: 1.75 },
  assumptions: ['PA speakers this size are 14–18 kg'],
};

test('tripod_stand matches the contract example (Example 1b)', () => {
  const r = computePhysics(tripod);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, [
    'Mass ≈ 16 + 4 = 20 kg (est.) → W = 20 × 9.81 = 196 N',
    'Each leg: 196 / 3 = 65.3 N',
    'Tip edge: e = 0.55 / 2 = 0.275 m from the pole',
    'To tip it: M = 196 × 0.275 = 53.9 N·m',
    'Push at the top: F = 53.9 / 1.75 = 30.8 N',
    'Lean limit: tan θ = 0.275 / 1.4 → θ = 11.1°',
  ]);
  assert.equal(formatLabel('Push to tip', 'tip_force', r), 'Push to tip = 30.8 N');
  assert.equal(formatLabel(undefined, 'tip_angle_deg', r), 'Lean limit = 11.1°');
  assert.equal(formatLabel('r', 'leg_radius_m', r), 'r ≈ 0.55 m (est.)');
});

test('tripod_stand panel lines hold on a calculator', () => {
  const inputs = [
    tripod.inputs,
    { mass_kg: 9.5, stand_mass_kg: 2.2, leg_radius_m: 0.42, com_height_m: 1.1, push_height_m: 1.3 },
    { mass_kg: 25, stand_mass_kg: 6, leg_radius_m: 0.7, com_height_m: 1.8, push_height_m: 2.1 },
    { mass_kg: 1.2, stand_mass_kg: 0.9, leg_radius_m: 0.25, com_height_m: 0.9, push_height_m: 1.2 },
  ];
  for (const i of inputs) {
    const r = computePhysics({ ...tripod, inputs: i });
    let checked = 0;
    for (const line of r.lines) {
      for (const [, a, op, b, c] of line.matchAll(/([\d.]+) ([×/+]) ([\d.]+) = ([\d.]+)/g)) {
        const exact = op === '×' ? a * b : op === '/' ? a / b : Number(a) + Number(b);
        assert.ok(near(exact, Number(c)), `${a} ${op} ${b} = ${c} (exact ${exact}) in "${line}"`);
        checked++;
      }
      const lean = line.match(/tan θ = ([\d.]+) \/ ([\d.]+) → θ = ([\d.]+)°/);
      if (lean) {
        const exact = (Math.atan(lean[1] / lean[2]) * 180) / Math.PI;
        assert.ok(near(exact, Number(lean[3])), `lean ${line}`);
        checked++;
      }
    }
    assert.equal(checked, 7);
  }
});

test('tripod_stand with a missing input shows no numbers', () => {
  const r = computePhysics({ ...tripod, inputs: { ...tripod.inputs, push_height_m: undefined } });
  assert.equal(r.ok, false);
  assert.equal(formatLabel('Push to tip', 'tip_force', r), 'Push to tip');
});
