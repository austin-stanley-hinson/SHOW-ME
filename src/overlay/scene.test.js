import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScene } from './scene.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../api/fixtures/${name}.json`, import.meta.url)));

test('speaker fixture: all items kept, numbers come from physics.js', () => {
  const s = buildScene(fixture('speaker'));
  assert.equal(s.items.length, 9);
  assert.equal(s.items.find((i) => i.id === 'weight').text, 'W = 49.1 N');
  assert.equal(s.items.find((i) => i.id === 'lever_arm').text, 'd ≈ 0.1 m (est.)');
  const panel = s.items.find((i) => i.type === 'panel');
  assert.ok(panel.lines.length > 0);
  assert.ok(panel.assumptions.length > 0);
  assert.equal(s.physicsPanelDrawn, true);
});

test('tripod fixture builds', () => {
  const s = buildScene(fixture('tripod'));
  assert.ok(s.items.length > 0);
  assert.ok(s.physics.ok);
});

test('renderer rules: bad items dropped, coords clamped, first id wins, bad color replaced', () => {
  const s = buildScene({
    answer: 'ok',
    followup_question: null,
    physics: null,
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
  for (const junk of [null, undefined, 42, 'x', [], { draw: 'no' }, { draw: [null, 1, 'a'] }]) {
    const s = buildScene(junk);
    assert.deepEqual(s.items, []);
  }
});

test('max 12 items', () => {
  const draw = Array.from({ length: 20 }, (_, i) => ({ type: 'point', id: `p${i}`, at: [0.5, 0.5] }));
  assert.equal(buildScene({ answer: 'ok', draw }).items.length, 12);
});
