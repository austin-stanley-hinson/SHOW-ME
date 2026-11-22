import test from 'node:test';
import assert from 'node:assert/strict';
import { createParkDetector, isFlat } from './parked.js';

test('isFlat: face up / face down count, held upright does not', () => {
  assert.equal(isFlat(5, -3), true); // on a table, screen up
  assert.equal(isFlat(178, 4), true); // face down
  assert.equal(isFlat(-176, 2), true);
  assert.equal(isFlat(80, 2), false); // held up, camera at the work
  assert.equal(isFlat(45, 10), false);
  assert.equal(isFlat(null, 0), false);
});

test('parks after lying flat and still; pickup by tilting or a jolt', () => {
  const events = [];
  const pd = createParkDetector({ onPark: () => events.push('park'), onPickup: (why) => events.push('pickup:' + why) });
  const g = { x: 0, y: 0, z: 9.8 };
  // Held up and moving: never parks.
  for (let t = 0; t < 2000; t += 100) {
    pd.orientation(75, 3, t);
    pd.motion({ x: Math.sin(t) * 2, y: 9, z: 1 }, t);
  }
  assert.deepEqual(events, []);
  // Put down flat, settles.
  for (let t = 2000; t < 4000; t += 100) {
    pd.orientation(3, 2, t);
    pd.motion(g, t);
  }
  assert.deepEqual(events, ['park']);
  assert.equal(pd.parked, true);
  // Picked up: tilted toward the work.
  pd.orientation(60, 0, 4100);
  assert.deepEqual(events, ['park', 'pickup:tilted']);
  // Down again, then picked up with a jolt while still flat.
  for (let t = 5000; t < 7000; t += 100) {
    pd.orientation(2, 1, t);
    pd.motion(g, t);
  }
  pd.motion({ x: 3, y: 1, z: 12 }, 7100);
  assert.deepEqual(events, ['park', 'pickup:tilted', 'park', 'pickup:moved']);
});

test('flat but being moved around does not park', () => {
  const events = [];
  const pd = createParkDetector({ onPark: () => events.push('park') });
  for (let t = 0; t < 3000; t += 100) {
    pd.orientation(4, 4, t);
    pd.motion({ x: (t / 100) % 2 ? 1.5 : -1.5, y: 0, z: 9.8 }, t);
  }
  assert.deepEqual(events, []);
});
