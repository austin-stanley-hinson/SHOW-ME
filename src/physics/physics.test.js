// Run: node --test src/physics/ api/_lib/
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePhysics, formatLabel } from './physics.js';

const speaker = {
  model: 'wall_mount',
  inputs: { mass_kg: 5, lever_arm_m: 0.1, bolt_spacing_m: 0.08, bolt_count: 2 },
  assumptions: ['Speakers this size are 4–6 kg'],
};

test('wall_mount matches the contract example', () => {
  const r = computePhysics(speaker);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.quantities.weight.value - 49.05) < 1e-9);
  assert.ok(Math.abs(r.quantities.shear_per_bolt.value - 24.525) < 1e-9);
  assert.ok(Math.abs(r.quantities.moment.value - 4.905) < 1e-9);
  assert.ok(Math.abs(r.quantities.top_bolt_tension.value - 61.3125) < 1e-9);
  assert.equal(r.quantities.wall_reaction.value, r.quantities.top_bolt_tension.value);
  assert.equal(r.lines.length, 4);
});

test('labels follow "How quantity is displayed"', () => {
  const r = computePhysics(speaker);
  assert.equal(formatLabel('W', 'weight', r), 'W = 49.1 N');
  assert.equal(formatLabel('d', 'lever_arm_m', r), 'd ≈ 0.1 m (est.)');
  assert.equal(formatLabel(undefined, 'top_bolt_tension', r), 'Top bolt tension = 61.3 N');
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
