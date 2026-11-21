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

test('circle highlights a part; radius required and clamped', () => {
  const r = validateResponse({
    answer: 'That bolt.',
    draw: [
      { type: 'circle', id: 'bolt', at: [0.4, 0.6], r: 0.05 },
      { type: 'circle', id: 'huge', at: [0.4, 0.6], r: 2 },
      { type: 'circle', id: 'nor', at: [0.4, 0.6] },
    ],
  });
  assert.deepEqual(r.value.draw.map((i) => [i.id, i.r]), [['bolt', 0.05], ['huge', 0.3]]);
});

test('narration with gestures, scene edits and procedures', () => {
  const r = validateResponse(
    {
      answer: 'Here is how to fold it.',
      clear: false,
      remove: ['old_arrow', 'bad id!'],
      points: [{ id: 'hinge_left', at: [0.4, 0.62] }],
      draw: [
        { type: 'step', id: 'step1', at: 'hinge_left', n: 1, label: 'Lift the seat' },
        { type: 'arrow', id: 'lift', from: [0.5, 0.6], to: [0.5, 0.4] },
      ],
      narration: [
        { say: 'First, lift the front of the seat.', gesture: { type: 'trace', target: 'lift' } },
        { say: 'It pivots on this hinge.', gesture: { type: 'pulse', target: 'hinge_left' } },
        { say: 'Keep your fingers clear of this bar.', gesture: { type: 'point', target: 'warning_bar' } }, // on screen from before
        { say: 'Unknown target is dropped, line kept.', gesture: { type: 'point', target: 'nope' } },
        { say: '' },
      ],
      procedure: { title: 'Fold the chair', current: 1, total: 3, done_when: 'The seat is vertical.', safety: ['Mind your fingers at the hinge.'] },
    },
    { previousIds: ['warning_bar', 'old_arrow'] },
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.clear, false);
  assert.deepEqual(r.value.remove, ['old_arrow']);
  assert.deepEqual(r.value.narration.map((n) => n.gesture?.target ?? null), ['lift', 'hinge_left', 'warning_bar', null]);
  assert.equal(r.value.procedure.current, 1);
  assert.equal(r.value.procedure.done_when, 'The seat is vertical.');

  const fresh = validateResponse({ answer: 'hi', draw: [], remove: ['x'], narration: [{ say: 'hi', gesture: { type: 'point', target: 'warning_bar' } }] }, { previousIds: ['warning_bar'] });
  assert.equal(fresh.value.clear, true); // default: new view
  assert.deepEqual(fresh.value.remove, []);
  assert.equal(fresh.value.narration[0].gesture, undefined); // old items are gone after a clear
  assert.equal(fresh.value.procedure, null);
});

test('contract v3 examples are valid, and the chair calc checks out', async () => {
  const { evaluateCalc, auditText } = await import('../../src/physics/calc.js');
  for (const name of ['what-is-this', 'fold-step1', 'chair-tip', 'nothing', 'fold-live-gemini']) {
    const raw = JSON.parse(readFileSync(new URL(`../fixtures/v3/${name}.json`, import.meta.url)));
    const r = validateResponse(raw);
    assert.equal(r.ok, true, name);
    assert.equal(r.value.draw.length, raw.draw.length, `${name}: no items dropped`);
    assert.equal(r.value.narration.length, (raw.narration || []).length, `${name}: narration kept`);
    for (const n of r.value.narration) if (raw.narration.find((x) => x.say === n.say).gesture) assert.ok(n.gesture, `${name}: gesture target resolves`);
    if (raw.calc) {
      const c = evaluateCalc(raw.calc);
      assert.equal(c.verified, true, `${name}: ${JSON.stringify(c.mismatches)} ${c.errors}`);
      assert.deepEqual(auditText(raw.answer, c, raw.calc), [], `${name}: caption numbers trace`);
    }
  }
});

test('title: optional, garbled leading fragment dropped; answer trimmed', () => {
  assert.equal(validateResponse({ title: ' me Folding chair', answer: ' Hi', draw: [] }).value.title, 'Folding chair');
  assert.equal(validateResponse({ title: 'Tripod speaker stand', answer: 'Hi', draw: [] }).value.title, 'Tripod speaker stand');
  assert.equal(validateResponse({ answer: ' Hi ', draw: [] }).value.title, null);
  assert.equal(validateResponse({ answer: ' Hi ', draw: [] }).value.answer, 'Hi');
});
