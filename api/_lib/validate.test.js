import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateResponse } from './validate.js';

const speaker = JSON.parse(readFileSync(new URL('../fixtures/speaker.json', import.meta.url)));

test('contract example 1 is valid and unchanged', () => {
  const r = validateResponse(speaker);
  assert.equal(r.ok, true);
  assert.equal(r.value.draw.length, speaker.draw.length);
});

test('rejects missing required fields', () => {
  assert.equal(validateResponse({ ...speaker, answer: '' }).ok, false);
  assert.equal(validateResponse({ ...speaker, draw: 'x' }).ok, false);
  assert.equal(validateResponse('nope').ok, false);
});

test('missing followup_question / calc become null', () => {
  const r = validateResponse({ answer: 'hi', draw: [] });
  assert.equal(r.ok, true);
  assert.equal(r.value.followup_question, null);
  assert.equal(r.value.calc, null);
});

test('drops bad items, dedupes ids, clamps coords, caps at 12', () => {
  const draw = [
    { type: 'point', id: 'a', at: [1.5, -0.2] },
    { type: 'point', id: 'a', at: [0.1, 0.1] },
    { type: 'blob', id: 'b', at: [0.1, 0.1] },
    { type: 'arrow', id: 'c', from: [0.1, 0.1] },
    { type: 'label', id: 'd', at: [0.5, 0.5] },
    ...Array.from({ length: 20 }, (_, i) => ({ type: 'point', id: `p${i}`, at: [0.5, 0.5] })),
  ];
  const r = validateResponse({ answer: 'hi', followup_question: null, calc: null, draw });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.draw[0].at, [1, 0]);
  assert.equal(r.value.draw.length, 12);
  assert.ok(!r.value.draw.some((i) => ['b', 'c', 'd'].includes(i.id)));
});

test('contract example 1b (tripod) is valid and unchanged', () => {
  const tripod = JSON.parse(readFileSync(new URL('../fixtures/tripod.json', import.meta.url)));
  const r = validateResponse(tripod);
  assert.equal(r.ok, true);
  assert.equal(r.value.draw.length, tripod.draw.length);
});

test('points: draw items can reference named points; refs kept for 3D', () => {
  const r = validateResponse({
    answer: 'hi',
    points: [
      { id: 'seat', at: [0.5, 0.55] },
      { id: 'seat', at: [0.1, 0.1] }, // repeated: dropped
      { id: 'bad id!', at: [0.1, 0.1] },
      { id: 'foot', at: [0.4, 1.3] }, // clamped
    ],
    draw: [
      { type: 'arrow', id: 'w', from: 'seat', to: [0.5, 0.8] },
      { type: 'arrow', id: 'x', from: 'nope', to: [0.5, 0.8] }, // unknown point: dropped
      { type: 'point', id: 'f', at: 'foot' },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.points, [{ id: 'seat', at: [0.5, 0.55] }, { id: 'foot', at: [0.4, 1] }]);
  assert.deepEqual(r.value.draw.map((i) => i.id), ['w', 'f']);
  assert.deepEqual(r.value.draw[0].from, [0.5, 0.55]);
  assert.deepEqual(r.value.draw[0].refs, { from: 'seat' });
  assert.deepEqual(r.value.draw[1].at, [0.4, 1]);
});
