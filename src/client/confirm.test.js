import test from 'node:test';
import assert from 'node:assert/strict';
import { asksForConfirmation, soundsLikeConfirmation } from './confirm.js';

test('user asks for confirmation', () => {
  for (const t of ['Like this?', 'like that', 'done', 'Is it sealed?', 'is this right', 'Did I do it right?', "I'm done", 'how is that, does that look ok']) {
    assert.equal(asksForConfirmation(t), true, t);
  }
  for (const t of ['Where is the cap?', 'How do I put it on?', 'What is this?']) assert.equal(asksForConfirmation(t), false, t);
});

test('model reply confirms', () => {
  for (const t of ["Yes, just like that. You've successfully placed the cap", 'Great. It looks like the lid is properly sealed', 'Perfect!', "That's it!", "It's sealed now.", 'Looks good.']) {
    assert.equal(soundsLikeConfirmation(t), true, t);
  }
  for (const t of ['Not quite yet, the seat is still down.', 'Actually, the chair is still unfolded.', 'Go ahead and pick up the cap.']) {
    assert.equal(soundsLikeConfirmation(t), false, t);
  }
});
