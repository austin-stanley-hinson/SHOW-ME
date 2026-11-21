import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTools } from './liveTools.js';
import { liveSetup } from '../../api/_lib/live.js';

test('live tools: show/remove/gesture/procedure/calc, Gemini [y,x] 0-1000 -> contract', () => {
  const t = createLiveTools();
  // Point item with no position but the same id as a named point = "here"; circle gets a default radius.
  let r = t.handle({ name: 'show', args: { points: [{ id: 'hinge', at: [470, 560] }], items: [{ type: 'point', id: 'hinge', label: 'Hinge' }, { type: 'circle', id: 'ring', at_point: 'hinge' }] } });
  assert.deepEqual(r.response.shown, ['hinge', 'ring']);
  assert.deepEqual(t.scene.points[0].at, [0.56, 0.47]);
  assert.equal(t.scene.items[1].r, 0.045);

  r = t.handle({ name: 'show', args: { items: [{ type: 'arrow', id: 'push', from: [200, 300] }] } });
  assert.match(r.response.dropped[0].why, /needs to as \[y, x\]/);
  r = t.handle({ name: 'show', args: { items: [{ type: 'arrow', id: 'push', from: [200, 300], to_point: 'hinge' }] } });
  assert.deepEqual(t.scene.items.map((i) => i.id), ['hinge', 'ring', 'push']); // added, earlier items kept

  assert.deepEqual(t.handle({ name: 'gesture', args: { type: 'pulse', target: 'ring' } }).update.gesture, { type: 'pulse', target: 'ring' });
  assert.match(t.handle({ name: 'gesture', args: { type: 'pulse', target: 'nope' } }).response.error, /nothing with id/);

  t.handle({ name: 'remove', args: { ids: ['ring'] } });
  assert.deepEqual(t.scene.items.map((i) => i.id), ['hinge', 'push']);

  assert.equal(t.handle({ name: 'procedure', args: { current: 1, total: 2, done_when: 'Seat up' } }).update.procedure.current, 1);

  r = t.handle({ name: 'calc', args: { inputs: [{ name: 'm', value: 4, unit: 'kg' }], steps: [{ name: 'W', expr: 'm * g', value: 50, unit: 'N' }] } });
  assert.equal(r.response.verified, false);
  assert.match(r.response.note, /wrong/);
  assert.equal(t.handle({ name: 'nope' }).response.error, 'unknown tool nope');
});

test('live setup is complete enough to lock into a token', () => {
  const s = liveSetup();
  assert.match(s.model, /^models\//);
  assert.deepEqual(s.generationConfig.responseModalities, ['AUDIO']);
  assert.deepEqual(s.tools[0].functionDeclarations.map((f) => f.name), ['show', 'remove', 'gesture', 'procedure', 'calc']);
});

test('precise points: targets for new spots, refine snaps them', () => {
  const t = createLiveTools();
  t.handle({ name: 'show', args: { points: [{ id: 'push_bar', at: [620, 480] }], items: [{ type: 'arrow', id: 'a', from: [800, 300], to_point: 'push_bar', label: 'Press here' }, { type: 'circle', id: 'c', at: [400, 400] }, { type: 'label', id: 'l', at: [100, 100], label: 'Soap' }] } });
  const targets = t.targetsFor(['a', 'c', 'l'], ['push_bar']);
  assert.deepEqual(targets.map((x) => x.id), ['push_bar', 'c']); // labels aren't snapped; an arrow aimed at a point follows that point
  assert.equal(targets[0].label, 'Press here (push bar)');
  const s = t.refine([{ id: 'push_bar', at: [0.5, 0.53] }, { id: 'c', at: [0.41, 0.4] }]);
  assert.deepEqual(s.points[0].at, [0.5, 0.53]);
  assert.deepEqual(s.items.find((i) => i.id === 'c').at, [0.41, 0.4]);
});

test('precise points: a pointing arrow with a numeric tip is snapped by moving the whole arrow', () => {
  const t = createLiveTools();
  t.handle({ name: 'show', args: { items: [{ type: 'arrow', id: 'push', from: [580, 500], to: [520, 500], label: 'Push here' }] } });
  const targets = t.targetsFor(['push'], []);
  assert.deepEqual(targets, [{ id: 'push', label: 'Push here', at: [0.5, 0.52] }]);
  const s = t.refine([{ id: 'push', at: [0.53, 0.5] }]);
  const a = s.items[0];
  assert.deepEqual(a.to, [0.53, 0.5]);
  assert.ok(Math.abs(a.from[0] - 0.53) < 1e-9 && Math.abs(a.from[1] - 0.56) < 1e-9); // same shape, shifted
});
