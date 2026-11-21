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
