import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, robustSimilarity, apply, compose, invert } from './tracker.js';

// A textured "scene" we can view through a moving camera: smooth blobs (like real surfaces).
function makeScene(W, H, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 260 }, () => [rnd() * W, rnd() * H, 4 + rnd() * 14, rnd() * 200 - 100]);
  return (x, y) => {
    let v = 110;
    for (const [bx, by, r, a] of blobs) {
      const d2 = (x - bx) ** 2 + (y - by) ** 2;
      if (d2 < 9 * r * r) v += a * Math.exp(-d2 / (2 * r * r));
    }
    return Math.max(0, Math.min(255, v));
  };
}
// Camera view of the scene: pixel (u, v) shows scene point center + zoom*R(angle)*(u - w/2, v - h/2).
function view(scene, w, h, { cx, cy, zoom = 1, angle = 0 }) {
  const img = new Float32Array(w * h);
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const dx = (u - w / 2) / zoom, dy = (v - h / 2) / zoom;
      img[v * w + u] = scene(cx + c * dx - s * dy, cy + s * dx + c * dy);
    }
  }
  return img;
}
// Where a scene point appears in a camera view (0-1).
function project(pt, w, h, { cx, cy, zoom = 1, angle = 0 }) {
  const dx = pt[0] - cx, dy = pt[1] - cy;
  const c = Math.cos(-angle), s = Math.sin(-angle);
  return [(w / 2 + zoom * (c * dx - s * dy)) / w, (h / 2 + zoom * (s * dx + c * dy)) / h];
}

test('similarity math: compose / invert / robust fit with outliers', () => {
  const T = { a: 1.1 * Math.cos(0.1), b: 1.1 * Math.sin(0.1), tx: 5, ty: -3 };
  const P = Array.from({ length: 30 }, (_, i) => [i * 7 % 50, (i * 13) % 40]);
  const Q = P.map((p) => apply(T, p));
  Q[3] = [999, 999];
  Q[9] = [-50, 70]; // outliers
  const fit = robustSimilarity(P, Q);
  assert.ok(Math.abs(fit.T.a - T.a) < 1e-6 && Math.abs(fit.T.tx - T.tx) < 1e-6);
  assert.equal(fit.inliers, 28);
  const back = apply(compose(invert(T), T), [12, 34]);
  assert.ok(Math.abs(back[0] - 12) < 1e-9 && Math.abs(back[1] - 34) < 1e-9);
});

test('tracker: a point placed on an older frame stays on the same scene spot as the camera pans, zooms, rotates', () => {
  const w = 160, h = 120;
  const scene = makeScene(400, 300);
  const tr = createTracker();
  const spot = [215, 160]; // a scene location (e.g. the chair hinge)
  const path = Array.from({ length: 24 }, (_, k) => ({ cx: 200 + k * 1.6, cy: 150 - k * 0.8, zoom: 1 + k * 0.012, angle: k * 0.004 }));

  let placedId = null;
  let ref = null;
  for (let k = 0; k < path.length; k++) {
    const id = tr.push(view(scene, w, h, path[k]), w, h);
    if (k === 4) placedId = id; // the frame "Gemini saw"
    if (k === 10) ref = tr.toRef(project(spot, w, h, path[4]), placedId); // its answer arrives later
  }
  const now = tr.fromRef(ref);
  const truth = project(spot, w, h, path.at(-1));
  const errPx = Math.hypot((now[0] - truth[0]) * w, (now[1] - truth[1]) * h);
  assert.ok(errPx < 3, `error ${errPx.toFixed(2)} px`);
  assert.ok(tr.quality > 0.5);
  assert.equal(tr.lost, false);
});

test('tracker: a featureless view marks it lost', () => {
  const w = 80, h = 60;
  const tr = createTracker();
  const flat = new Float32Array(w * h).fill(128);
  for (let k = 0; k < 12; k++) tr.push(flat, w, h);
  assert.equal(tr.lost, true);
  assert.equal(tr.fromRef([10, 10]), null);
});
