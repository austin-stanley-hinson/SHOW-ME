import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene, applyResponse, previousFor, findTarget } from './view.js';
import { narrate, readMs } from './narrator.js';
import { guideState, doneQuestion } from './guide.js';

const A = { type: 'arrow', id: 'a', from: [0, 0], to: [1, 1] };
const B = { type: 'point', id: 'b', at: [0.5, 0.5] };

test('scene: clear by default, keep + replace + remove with clear:false', () => {
  let s = applyResponse(emptyScene(), { answer: 'one', draw: [A, B], points: [{ id: 'hinge', at: [0.4, 0.6] }] }, 'q1');
  assert.deepEqual(s.items.map((i) => i.id), ['a', 'b']);
  s = applyResponse(s, { answer: 'two', clear: false, remove: ['b'], draw: [{ ...A, to: [0.2, 0.2] }, { type: 'circle', id: 'c', at: 'hinge', r: 0.05 }] }, 'q2');
  assert.deepEqual(s.items.map((i) => i.id), ['a', 'c']);
  assert.deepEqual(s.items[0].to, [0.2, 0.2]); // replaced in place
  assert.deepEqual(findTarget(s, 'hinge'), { type: 'point', id: 'hinge', at: [0.4, 0.6] });
  assert.equal(findTarget(s, 'nope'), null);
  const prev = previousFor(s);
  assert.equal(prev.question, 'q2');
  assert.deepEqual(prev.response.draw.map((i) => i.id), ['a', 'c']); // the whole current scene, not just the last draw
  s = applyResponse(s, { answer: 'three', draw: [B] }, 'q3'); // clear defaults to true
  assert.deepEqual(s.items.map((i) => i.id), ['b']);
  assert.equal(previousFor(emptyScene()), null);
});

test('narrator: lines and gestures fire in order without speech (timer fallback)', async () => {
  const events = [];
  await new Promise((done) => {
    narrate(
      [{ say: 'one', gesture: { type: 'pulse', target: 'b' } }, { say: 'two' }],
      {
        speak: false,
        onLine: (l) => events.push('line:' + l.say),
        onGestureStart: (g) => events.push('start:' + g.target),
        onGestureEnd: (g) => events.push('end:' + g.target),
        onEnd: () => (events.push('end'), done()),
      },
    );
  });
  assert.deepEqual(events, ['line:one', 'start:b', 'end:b', 'line:two', 'end']);
  assert.ok(readMs('a b c') >= 1500);
});

test('narrator: stop() ends the current gesture and finishes once', async () => {
  const events = [];
  const n = narrate([{ say: 'one', gesture: { type: 'trace', target: 'a' } }, { say: 'two' }], {
    speak: false,
    onGestureEnd: (g) => events.push('end:' + g.target),
    onEnd: () => events.push('end'),
  });
  await new Promise((r) => setTimeout(r, 20));
  n.stop();
  n.stop();
  assert.deepEqual(events, ['end:a', 'end']);
});

test('guide: state + the Done question', () => {
  assert.equal(guideState(null), null);
  const g = guideState({ title: 'Fold the chair', current: 1, total: 3, done_when: 'The seat is vertical.', safety: ['Mind the hinge.'] });
  assert.equal(g.progress, 'Step 1 of 3');
  assert.match(doneQuestion(g), /step 1 of "Fold the chair".*The seat is vertical\./);
});
