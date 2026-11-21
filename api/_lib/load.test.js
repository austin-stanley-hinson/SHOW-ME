// Every serverless function must at least load: a syntax error makes Vercel answer 500
// (FUNCTION_INVOCATION_FAILED) on every request, and `npm run build` doesn't build api/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

const dir = new URL('../', import.meta.url);
const endpoints = readdirSync(dir).filter((f) => f.endsWith('.js'));

for (const f of endpoints) {
  test(`api/${f} loads and exports a handler`, async () => {
    const mod = await import(new URL(f, dir));
    assert.equal(typeof mod.default, 'function');
  });
}
