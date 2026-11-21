import test from 'node:test';
import assert from 'node:assert/strict';
import { watchPrompt, isWaitReply, canDecide } from './watch.js';

test('watchPrompt names the step and its done_when, and asks for "waiting" otherwise', () => {
  const p = watchPrompt({ current: 2, total: 3, done_when: 'The cap is off.', title: 'Open the bottle' });
  assert.match(p, /^\[auto-check\]/);
  assert.match(p, /step 2 of 3/);
  assert.match(p, /done when: The cap is off\./);
  assert.match(p, /exactly one word: waiting/);
});

test('isWaitReply: drops only the "nothing to report" replies', () => {
  for (const t of ['waiting', 'Waiting.', ' waiting… ', 'Still waiting', 'Not yet.']) assert.ok(isWaitReply(t), t);
  for (const t of ['Nice, the cap is off. Step 3: take a sip.', 'Careful, twist the other way.', 'Waiting is fine but turn it left', ''])
    assert.ok(!isWaitReply(t), t);
});

test('canDecide: waits for more text while it could still be "waiting"', () => {
  assert.ok(!canDecide(''));
  assert.ok(!canDecide('Wai'));
  assert.ok(!canDecide('Still'));
  assert.ok(canDecide('waiting.'));
  assert.ok(canDecide('Nice'));
  assert.ok(canDecide('Careful, twist'));
});
