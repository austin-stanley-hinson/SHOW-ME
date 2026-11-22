// Enforcing "never confirm without check" (lane B). The model ignores the prompt rule when it's eager ("Yes,
// just like that. You've successfully placed the cap" - it hadn't), so the app holds the reply to a
// "like this? / done? / is it sealed?" question and drops it if it confirms before calling check.

// The user is asking us to confirm their work.
export function asksForConfirmation(text) {
  return /\b(like (this|that)|is (it|this|that) (right|ok|okay|good|done|correct|sealed|tight|secure|closed|on|folded|in)|did i (do|get)|am i (doing|done)|(i'?m|i am|it'?s|it is) done|done\b|finished|how'?s (this|that)|does (this|that) look|right\?|correct\?|sealed\?)/i.test(text || '');
}

// The model's reply (so far) is a confirmation.
export function soundsLikeConfirmation(text) {
  return /^\W*(yes|yeah|yep|great|perfect|exactly|nice|good job|well done|that's (it|right|correct|perfect)|looks (good|great|right)|you('ve| have) (done|got|successfully)|it('s| is) (now )?(sealed|secure|done|on|tight|correct|closed|folded))/i.test(text || '');
}
