import test from 'node:test';
import assert from 'node:assert/strict';
import { toContractCoords } from './coords.js';
import { buildPrompt } from './prompt.js';

test('Gemini [y, x] 0-1000 -> contract [x, y] 0-1; point ids untouched', () => {
  const out = toContractCoords(
    {
      answer: 'x',
      points: [{ id: 'hinge', at: [620, 420] }],
      draw: [
        { type: 'arrow', id: 'a', from: [100, 250], to: 'hinge' },
        { type: 'circle', id: 'c', at: [500, 500], r: 40 },
      ],
    },
    'yx1000',
  );
  assert.deepEqual(out.points[0].at, [0.42, 0.62]);
  assert.deepEqual(out.draw[0].from, [0.25, 0.1]);
  assert.equal(out.draw[0].to, 'hinge');
  assert.deepEqual(out.draw[1].at, [0.5, 0.5]);
  assert.equal(out.draw[1].r, 0.04);
});

test('prompt is built for the provider convention', () => {
  const g = buildPrompt('yx1000');
  assert.match(g, /\[y, x\] in the image, each 0 to 1000/);
  assert.ok(!g.includes('"at": [x, y]'));
  assert.match(g, /between y 50 and 920/);
  assert.match(buildPrompt('xy01'), /\[x, y\] in the image, each 0 to 1:/);
});
