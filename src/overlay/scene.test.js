import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScene } from './scene.js';
import { validateResponse } from '../../api/_lib/validate.js';
import { emptyScene, applyResponse } from '../client/view.js';

// Fixtures are raw model output; the server validates them (resolving point ids) before the client
// sees them, so do the same here.
const fixture = (name) => {
  const v = validateResponse(JSON.parse(readFileSync(new URL(`../../api/fixtures/v3/${name}.json`, import.meta.url))));
  assert.ok(v.ok, v.error);
  return v.value;
};

test('chair-tip: every item renders, numbers come from the checker', () => {
  const data = fixture('chair-tip');
  const s = buildScene(data);
  assert.equal(s.items.length, data.draw.length);
  assert.equal(s.items.find((i) => i.quantity === undefined && i.type === 'arrow' && i.text.startsWith('W'))?.text, 'W = 34.3 N');
  assert.ok(s.hasCalc && s.calc.ok);
  const panel = s.items.find((i) => i.type === 'panel');
  assert.ok(panel.isCalc && panel.lines.length > 0);
  assert.ok(s.calc.assumptions.length > 0);
});

test('circle items render with a clamped radius', () => {
  const s = buildScene({
    answer: 'ok',
    draw: [
      { type: 'circle', id: 'a', at: [0.5, 0.5], r: 0.04 },
      { type: 'circle', id: 'b', at: [0.5, 0.5], r: 5 },
      { type: 'circle', id: 'c', at: [0.5, 0.5] },
    ],
  });
  assert.deepEqual(
    s.items.map((i) => i.r),
    [0.04, 0.3, 0.05],
  );
});

test('all v3 fixtures render without dropping items', () => {
  for (const name of ['chair-tip', 'what-is-this', 'fold-step1', 'fold-live-gemini', 'nothing']) {
    const data = fixture(name);
    assert.equal(buildScene(data).items.length, Math.min(12, data.draw.length), name);
  }
});

test('view edits: clear:false keeps earlier items, remove takes them away', () => {
  let view = applyResponse(emptyScene(), { answer: 'a', draw: [{ type: 'point', id: 'p1', at: [0.1, 0.1] }] }, 'q1');
  view = applyResponse(view, { answer: 'b', clear: false, draw: [{ type: 'point', id: 'p2', at: [0.2, 0.2] }] }, 'q2');
  assert.deepEqual(buildScene(view.last, view.items).items.map((i) => i.id), ['p1', 'p2']);
  view = applyResponse(view, { answer: 'c', clear: false, remove: ['p1'], draw: [] }, 'q3');
  assert.deepEqual(buildScene(view.last, view.items).items.map((i) => i.id), ['p2']);
});

test('numbers in the answer that the checker cannot trace are marked', () => {
  const data = fixture('chair-tip');
  const s = buildScene({ ...data, answer: 'It weighs about 34 N but needs 999 N to tip.' });
  const flagged = s.answerParts.filter((p) => p.unchecked).map((p) => p.text);
  assert.ok(flagged.some((t) => t.includes('999')));
  assert.ok(!flagged.some((t) => t.includes('34')));
});

test('renderer rules: bad items dropped, coords clamped, first id wins, bad color replaced', () => {
  const s = buildScene({
    answer: 'ok',
    draw: [
      { type: 'point', id: 'a', at: [1.5, -0.2], color: 'red' },
      { type: 'point', id: 'a', at: [0.1, 0.1] },
      { type: 'blob', id: 'b', at: [0.5, 0.5] },
      { type: 'arrow', id: 'c', from: [0.1, 0.1] },
      { type: 'label', id: 'd', at: [0.5, 0.5] },
      { type: 'step', id: 'e', at: [0.5, 0.5], n: 0, label: 'x' },
    ],
  });
  assert.equal(s.items.length, 1);
  assert.deepEqual(s.items[0].at, [1, 0]);
  assert.equal(s.items[0].color, '#ffffff');
});

test('steps are listed in order of n', () => {
  const s = buildScene({
    answer: 'ok',
    draw: [
      { type: 'step', id: 's2', at: [0.5, 0.5], n: 2, label: 'Press Start' },
      { type: 'step', id: 's1', at: [0.2, 0.5], n: 1, label: 'Turn dial' },
    ],
  });
  assert.deepEqual(s.steps, [
    { n: 1, text: 'Turn dial' },
    { n: 2, text: 'Press Start' },
  ]);
});

test('never crashes on garbage', () => {
  for (const junk of [null, undefined, 42, 'x', [], { draw: 'no' }, { draw: [null, 1, 'a'] }, { calc: 'x', draw: [] }]) {
    assert.deepEqual(buildScene(junk).items, []);
  }
});

test('max 12 items', () => {
  const draw = Array.from({ length: 20 }, (_, i) => ({ type: 'point', id: `p${i}`, at: [0.5, 0.5] }));
  assert.equal(buildScene({ answer: 'ok', draw }).items.length, 12);
});
