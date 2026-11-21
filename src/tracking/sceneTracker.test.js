import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneTracker } from './sceneTracker.js';

// Textured frames of a camera panning right/down by (k*dx, k*dy) pixels.
const W = 200, H = 150;
const frame = (sx, sy) => {
  const img = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const X = x + sx, Y = y + sy;
      img[y * W + x] = 128 + 55 * Math.sin(X * 0.21) * Math.cos(Y * 0.17) + 35 * Math.sin((X + Y) * 0.07) + 25 * Math.cos(X * 0.05 - Y * 0.11);
    }
  return img;
};

test('scene tracker: items + points placed on an older frame move with the view; replaced items re-anchor', () => {
  const st = createSceneTracker(null);
  const tr = st.tracker;
  tr.push(frame(0, 0), W, H);
  const seen = tr.push(frame(2, 1), W, H); // the frame "Gemini saw"
  const scene = {
    points: [{ id: 'hinge', at: [0.5, 0.5] }],
    items: [
      { type: 'circle', id: 'c', at: 'hinge', r: 0.05 },
      { type: 'arrow', id: 'a', from: [0.3, 0.4], to: [0.6, 0.4] },
    ],
  };
  for (let k = 2; k <= 6; k++) tr.push(frame(2 * k, k), W, H); // answer arrives while the camera keeps panning
  st.place(scene, seen);
  for (let k = 7; k <= 12; k++) tr.push(frame(2 * k, k), W, H);

  const now = st.current(scene);
  // Camera moved +22 px right and +11 px down since the seen frame, so content moves left/up.
  const dx = -22 / W, dy = -11 / H;
  assert.ok(Math.abs(now.points[0].at[0] - (0.5 + dx)) < 0.01 && Math.abs(now.points[0].at[1] - (0.5 + dy)) < 0.01, JSON.stringify(now.points[0].at));
  assert.ok(Math.abs(now.items[1].from[0] - (0.3 + dx)) < 0.01);
  assert.equal(now.items[0].at, 'hinge'); // point-id positions stay ids (resolve via now.points)
  assert.equal(now.items.some((i) => i.stale), false);
  assert.equal(now.tracking.lost, false);

  // An item that was never placed is reported stale.
  const extra = { ...scene, items: [...scene.items, { type: 'point', id: 'p', at: [0.1, 0.1] }] };
  assert.equal(st.current(extra).items[2].stale, true);
});
