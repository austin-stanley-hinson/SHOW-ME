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
  assert.deepEqual(targets.map((x) => x.id), ['push_bar', 'c']); // labels aren't looked up; an arrow aimed at a point follows that point
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

test('an arrow with only a tip gets a tail instead of being rejected', () => {
  const t = createLiveTools();
  const r = t.handle({ name: 'show', args: { items: [{ type: 'arrow', id: 'keys', to: [510, 150], label: 'car keys' }] } });
  assert.deepEqual(r.response.shown, ['keys']);
  const a = t.scene.items[0];
  assert.deepEqual(a.to, [0.15, 0.51]);
  assert.deepEqual(a.from, [0.03, 0.39]);
});

test('clear: true drops old named points too (no ghost points re-snapped forever)', () => {
  const t = createLiveTools();
  t.handle({ name: 'show', args: { points: [{ id: 'pencil_point', at: [510, 360] }], items: [{ type: 'circle', id: 'c', at_point: 'pencil_point' }] } });
  t.handle({ name: 'show', args: { clear: true, items: [{ type: 'circle', id: 'keys', at: [640, 480] }] } });
  assert.deepEqual(t.scene.points, []);
  assert.deepEqual(t.scene.items.map((i) => i.id), ['keys']);
  // Kept view: old points stay referenceable.
  t.handle({ name: 'show', args: { points: [{ id: 'lid', at: [300, 300] }] } });
  t.handle({ name: 'show', args: { items: [{ type: 'arrow', id: 'a', from: [100, 100], to_point: 'lid', label: 'lid' }] } });
  assert.deepEqual(t.scene.items.map((i) => i.id), ['keys', 'a']);
});

test('an arrow given only "at" points at that spot', () => {
  const t = createLiveTools();
  const r = t.handle({ name: 'show', args: { items: [{ type: 'arrow', id: 'sauce', at: [130, 470], label: 'sauce packet' }] } });
  assert.deepEqual(r.response.shown, ['sauce']);
  assert.deepEqual(t.scene.items[0].to, [0.47, 0.13]);
  assert.equal(t.scene.items[0].at, undefined);
});

test('unlabelled arrows are snapped too, named by a label at the same spot or by their id; labels ride along', () => {
  const t = createLiveTools();
  t.handle({ name: 'show', args: { items: [
    { type: 'label', id: 'fork_label', at: [250, 750], text: 'Here is the fork.' }, // words in "text"
    { type: 'arrow', id: 'fork_arrow', from: [150, 750], to: [250, 750] },
    { type: 'arrow', id: 'nametag_arrow', from: [280, 380], to: [380, 380] },
  ] } });
  assert.deepEqual(t.scene.items.map((i) => i.id), ['fork_label', 'fork_arrow', 'nametag_arrow']);
  const targets = t.targetsFor(['fork_label', 'fork_arrow', 'nametag_arrow'], []);
  assert.deepEqual(targets.map((x) => [x.id, x.label]), [['fork_arrow', 'Here is the fork.'], ['nametag_arrow', 'nametag']]);
  const s = t.refine([{ id: 'fork_arrow', at: [0.8, 0.3] }]);
  assert.deepEqual(s.items.find((i) => i.id === 'fork_arrow').to, [0.8, 0.3]);
  const lab = s.items.find((i) => i.id === 'fork_label').at;
  assert.ok(Math.abs(lab[0] - 0.8) < 1e-9 && Math.abs(lab[1] - 0.3) < 1e-9); // the label moved with the arrow tip
});

test('motion arrows: only the part end is snapped, the arrow moves rigidly (stapler "lift the cover")', () => {
  const t = createLiveTools();
  // The model's arrow: from a point on the cover to a point in the air above it.
  t.handle({ name: 'show', args: {
    points: [{ id: 'stapler_top', at: [413, 382] }, { id: 'stapler_top_up', at: [350, 382] }],
    items: [{ type: 'arrow', id: 'open_stapler', label: 'Lift the top cover up', from_point: 'stapler_top', to_point: 'stapler_top_up' }],
  } });
  const targets = t.targetsFor(['open_stapler'], ['stapler_top', 'stapler_top_up']);
  assert.deepEqual(targets.map((x) => x.id), ['stapler_top']); // the air point is never looked up
  const s = t.refine([{ id: 'stapler_top', at: [0.454, 0.386] }]);
  const top = s.points.find((p) => p.id === 'stapler_top').at, up = s.points.find((p) => p.id === 'stapler_top_up').at;
  assert.ok(Math.abs(up[1] - top[1] + 0.063) < 1e-9 && Math.abs(up[0] - top[0]) < 1e-9); // still 0.063 above
  const a = s.items[0];
  assert.deepEqual(a.from, top); // the arrow follows its points
  assert.deepEqual(a.to, up);
});

test('pointing arrows snap the tip; explicit anchor wins; circles given from_point are accepted', () => {
  const t = createLiveTools();
  t.handle({ name: 'show', args: { items: [
    { type: 'arrow', id: 'w', label: 'Weight', anchor: 'tail', from: [400, 500], to: [600, 500] },
    { type: 'arrow', id: 'lever', label: 'the lever', from: [300, 300], to: [500, 500] },
  ], points: [{ id: 'tray', at: [610, 480] }] } });
  t.handle({ name: 'show', args: { items: [{ type: 'circle', id: 'place', label: 'Place staples here', from_point: 'tray', to_point: 'tray' }] } });
  assert.ok(t.scene.items.some((i) => i.id === 'place'));
  const targets = t.targetsFor(['w', 'lever'], []);
  assert.deepEqual(targets.map((x) => [x.id, x.at]), [['w', [0.5, 0.4]], ['lever', [0.5, 0.5]]]);
  const s = t.refine([{ id: 'w', at: [0.52, 0.42] }]);
  const w = s.items.find((i) => i.id === 'w');
  assert.ok(Math.abs(w.from[0] - 0.52) < 1e-9 && Math.abs(w.to[1] - 0.62) < 1e-9); // rigid shift from the tail
});
