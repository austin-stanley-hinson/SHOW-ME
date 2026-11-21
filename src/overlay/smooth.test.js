import test from "node:test";
import assert from "node:assert/strict";
import { createSmoother } from "./smooth.js";

const scene = (x, extra = {}) => ({
  items: [{ id: "a", type: "point", at: [x, 0.5], ...extra }],
  points: [{ id: "p", at: [x, 0.5] }],
});

test("smooth: first frame exact, then eases toward the target", () => {
  const smooth = createSmoother({ rate: 0.5 });
  assert.deepEqual(smooth(scene(0.2)).items[0].at, [0.2, 0.5]);
  const s = smooth(scene(0.4));
  assert.ok(Math.abs(s.items[0].at[0] - 0.3) < 1e-9);
  assert.ok(Math.abs(s.points[0].at[0] - 0.3) < 1e-9);
});

test("smooth: huge jumps teleport, hidden items pass through, gone items are forgotten", () => {
  const smooth = createSmoother({ rate: 0.5, teleport: 0.35 });
  smooth(scene(0.1));
  assert.deepEqual(smooth(scene(0.9)).items[0].at, [0.9, 0.5]);
  assert.deepEqual(
    smooth(scene(0.5, { hidden: true })).items[0].at,
    [0.5, 0.5],
  );
  smooth({ items: [], points: [] }); // 'a' disappears
  assert.deepEqual(smooth(scene(0.2)).items[0].at, [0.2, 0.5]); // comes back exactly, no glide
});
