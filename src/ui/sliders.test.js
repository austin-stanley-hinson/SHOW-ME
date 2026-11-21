import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { niceStep, sliderSpecs } from './sliders.js';
import { evaluateCalc } from '../physics/calc.js';

const chair = JSON.parse(readFileSync(new URL('../../api/fixtures/v3/chair-tip.json', import.meta.url)));

test('niceStep: about 100 round notches', () => {
  assert.equal(niceStep(50), 0.5);
  assert.equal(niceStep(10.5), 0.1);
  assert.equal(niceStep(0.5), 0.005);
  assert.equal(niceStep(0), 1);
});

test('sliderSpecs: adjustable inputs first, estimates get 1/4x-3x, known facts none', () => {
  const specs = sliderSpecs(chair.calc, evaluateCalc(chair.calc));
  assert.deepEqual(specs.map((s) => s.name), ['F_push', 'm', 'd', 'h']);
  const push = specs[0];
  assert.deepEqual([push.min, push.max, push.estimated], [0, 50, false]);
  const m = specs.find((s) => s.name === 'm');
  assert.ok(m.estimated && m.min <= 0.875 + 1e-9 && m.max >= 10.5 - 1e-9);
});

test('dragging a slider changes the checked verdict', () => {
  const before = evaluateCalc(chair.calc);
  assert.equal(before.verdict.text, "That push won't tip it.");
  const after = evaluateCalc(chair.calc, null, { F_push: { value: 20, by: 'you' } });
  assert.equal(after.verdict.text, 'That push tips it over.');
  const spec = sliderSpecs(chair.calc, after).find((s) => s.name === 'F_push');
  assert.equal(spec.value, 20);
  assert.ok(spec.changed);
});
