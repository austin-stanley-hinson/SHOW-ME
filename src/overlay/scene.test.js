import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScene } from './scene.js';
import { coverRect } from './coverRect.js';
import { evaluateCalc } from '../physics/calc.js';
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

test('live: precomputed calc result is used, stale and refs survive', () => {
  const data = fixture('chair-tip');
  const calc = evaluateCalc(data.calc, null, { F_push: { value: 20, by: 'test' } });
  const items = data.draw.map((i) => ({ ...i, stale: true, refs: { at: 'seat' } }));
  const s = buildScene({ draw: items }, null, { calc });
  assert.ok(s.hasCalc);
  assert.equal(s.calc, calc);
  assert.ok(s.items.every((i) => i.stale && i.refs.at === 'seat'));
});

test('coverRect: portrait camera on a phone screen is cropped at the sides, centered', () => {
  const r = coverRect(1080, 1920, 390, 844);
  assert.equal(r.h, 844);
  assert.ok(r.w > 390 && Math.abs(r.x + (r.w - 390) / 2) < 1e-9);
  assert.equal(r.y, 0);
  assert.deepEqual(coverRect(0, 0, 390, 844), { x: 0, y: 0, w: 390, h: 844 });
});

test('v3.1: rotate items normalized, hidden items dropped', () => {
  const s = buildScene({
    draw: [
      { type: 'rotate', id: 'r1', at: [0.5, 0.5], dir: 'ccw', label: 'Twist' },
      { type: 'rotate', id: 'r2', at: [0.2, 0.2], r: 5, dir: 'sideways' },
      { type: 'circle', id: 'c1', at: [0.3, 0.3], hidden: true },
    ],
  });
  assert.deepEqual(
    s.items.map((i) => [i.id, i.r, i.dir]),
    [
      ['r1', 0.06, 'ccw'],
      ['r2', 0.3, 'cw'],
    ],
  );
});
