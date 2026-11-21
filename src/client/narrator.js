// Speaks narration and drives gestures in sync (lane B logic; lane A draws the gesture).
//
//   import { unlockSpeech, narrate } from './client/narrator.js';
//   startButton.onclick = () => { unlockSpeech(); ... };      // iOS: must run inside a user tap once
//   const n = narrate(data.narration, {
//     onLine: (line, i) => showCaption(line.say),                // caption = the line being spoken
//     onGestureStart: (g, i) => startGesture(g.type, findTarget(scene, g.target)),
//     onGestureEnd: (g, i) => stopGesture(g.type, g.target),
//     onEnd: () => hideCaption(),
//   });
//   n.stop();                                                    // new question, Back, or the user taps
//
// Without speech support (or muted), lines still advance on a reading-speed timer so captions and
// gestures still play.

const synth = () => globalThis.speechSynthesis || null;

// iOS Safari only allows speech after a user gesture: speak an empty utterance inside the first tap.
export function unlockSpeech() {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
    return true;
  } catch {
    return false;
  }
}

// Reading time for a caption when speech is unavailable: ~170 words per minute, at least 1.5 s.
export const readMs = (text) => Math.max(1500, (String(text).split(/\s+/).length / 170) * 60_000);

export function narrate(lines, { onLine, onGestureStart, onGestureEnd, onEnd, rate = 1.05, speak = true } = {}) {
  const list = Array.isArray(lines) ? lines.filter((l) => l && typeof l.say === 'string') : [];
  let i = -1;
  let stopped = false;
  let timer = null;
  const s = speak ? synth() : null;
  const canSpeak = Boolean(s && typeof SpeechSynthesisUtterance !== 'undefined');

  const endLine = () => {
    const line = list[i];
    if (line?.gesture) onGestureEnd?.(line.gesture, i);
  };
  const next = () => {
    if (stopped) return;
    if (i >= 0) endLine();
    i++;
    if (i >= list.length) {
      stopped = true;
      onEnd?.();
      return;
    }
    const line = list[i];
    onLine?.(line, i);
    if (line.gesture) onGestureStart?.(line.gesture, i);
    if (canSpeak) {
      const u = new SpeechSynthesisUtterance(line.say);
      u.rate = rate;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        setTimeout(next, 250); // short pause between lines
      };
      u.onend = finish;
      u.onerror = finish;
      // Safety net: some iOS versions never fire onend.
      timer = setTimeout(finish, readMs(line.say) * 1.6 + 1500);
      s.speak(u);
    } else {
      timer = setTimeout(next, readMs(line.say));
    }
  };

  if (canSpeak) s.cancel();
  setTimeout(next, 0);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (canSpeak) s.cancel();
      endLine();
      onEnd?.();
    },
    get index() {
      return i;
    },
  };
}
