import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './relay.js';

async function withServer(fn) {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Read SSE "state" events from a stream until `count` arrive.
async function readStates(res, count) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const states = [];
  while (states.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (block.includes('event: state') && data) states.push(JSON.parse(data.slice(6)));
    }
  }
  reader.cancel();
  return states;
}

test('two devices share one session: doc + input changes reach everyone', async () => {
  await withServer(async (base) => {
    const { id } = await (await post(`${base}/s`, { doc: { answer: 'chair', calc: null, draw: [] } })).json();
    assert.match(id, /^[a-z0-9]{6}$/);

    const phone = await fetch(`${base}/s/${id}/events`);
    const laptop = await fetch(`${base}/s/${id}/events`);
    assert.equal(phone.headers.get('content-type'), 'text/event-stream');

    const phoneStates = readStates(phone, 3);
    const laptopStates = readStates(laptop, 3);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await post(`${base}/s/${id}`, { type: 'input', name: 'F_load', value: 800, by: 'austin' })).status, 200);
    assert.equal((await post(`${base}/s/${id}`, { type: 'doc', doc: { answer: 'new', calc: null, draw: [] } })).status, 200);

    for (const states of [await phoneStates, await laptopStates]) {
      assert.equal(states[0].doc.answer, 'chair');
      assert.deepEqual(states[1].inputs, { F_load: { value: 800, by: 'austin' } });
      assert.equal(states[2].doc.answer, 'new');
      assert.deepEqual(states[2].inputs, {}); // new model resets overrides
      assert.ok(states[2].version > states[1].version);
    }
  });
});

test('rejects bad input, images and unknown sessions', async () => {
  await withServer(async (base) => {
    const { id } = await (await post(`${base}/s`, {})).json();
    assert.equal((await post(`${base}/s/${id}`, { type: 'input', name: '__proto__', value: 1 })).status, 400);
    assert.equal((await post(`${base}/s/${id}`, { type: 'input', name: 'x', value: 'big' })).status, 400);
    assert.equal((await post(`${base}/s/${id}`, { type: 'doc', doc: { image: 'AAAA' } })).status, 400);
    assert.equal((await post(`${base}/s/${id}`, { type: 'nope' })).status, 400);
    assert.equal((await post(`${base}/s/zzzzzz`, { type: 'input', name: 'x', value: 1 })).status, 404);
    assert.equal((await fetch(`${base}/s/../etc/events`)).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const big = await post(`${base}/s/${id}`, { type: 'doc', doc: { answer: 'x'.repeat(300 * 1024) } });
    assert.equal(big.status, 413);
  });
});
