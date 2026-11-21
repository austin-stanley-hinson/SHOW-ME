// Hands-free step checking for live mode (lane B file; written by lane A's agent at Austin's request
// for Josh to review, see #22).
// While a procedure step is active, live.js periodically asks the model to compare the newest frame
// with the step's done_when. The model answers "waiting" when there's nothing to say, and that reply
// is dropped silently, so the user only hears it when the step is done or something is wrong.

export const WATCH_GAP_MS = 6000; // quiet time after the model's last turn before the next check
export const WATCH_TIMEOUT_MS = 15000; // a check that never completes stops blocking the next one

export function watchPrompt(procedure) {
  const { current, total, done_when: doneWhen, title } = procedure || {};
  const step = `step ${current}${total ? ` of ${total}` : ''}${title ? ` of "${title}"` : ''}`;
  return (
    `[auto-check] Look at the newest frame. The user is doing ${step}` +
    (doneWhen ? `, done when: ${doneWhen}.` : '.') +
    ' If it is done, say so in a few words and call procedure with the next step (or complete: true).' +
    ' If they are doing it wrong or something looks unsafe, say what to fix in one short sentence.' +
    ' Otherwise reply with exactly one word: waiting.'
  );
}

// The model's "nothing to report" reply (tolerates punctuation, case and a few variants).
export function isWaitReply(text) {
  return /^\W*(waiting|still waiting|not yet|not done yet)\W*$/i.test(String(text || '').trim());
}

// Enough transcript to tell whether a reply is just "waiting" (or clearly isn't): a finished sentence,
// a longer text, or a first word that can't be the start of a wait reply.
const WAIT_STARTS = ['waiting', 'still', 'not'];
export function canDecide(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.length >= 12 || /[.!?…]$/.test(t)) return true;
  const first = t.split(/\s+/)[0].toLowerCase().replace(/\W/g, '');
  return !WAIT_STARTS.some((w) => w.startsWith(first));
}
