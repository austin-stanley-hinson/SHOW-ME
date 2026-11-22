// Bridges src/client/live.js callbacks to React state.
// The live session must start inside the user's tap (iOS audio), so the tap handler creates the
// store, passes store.handlers to startLive(), and the UI subscribes with useSyncExternalStore.
//
import { evaluateCalc } from '../physics/calc.js';

// Gestures are kept in a Map (target id -> { type, start, until }) read by the overlay every frame,
// so they animate without re-rendering React.

const GESTURE_MS = 2500;

export function createLiveStore() {
  let state = {
    status: 'connecting', // connecting | live | listening | speaking | closed | error: ...
    said: '', // what the AI is saying right now (live transcript)
    saidFinal: '', // last finished sentence, announced to screen readers
    heard: '', // what it heard the user say
    procedure: null,
    calc: null, // evaluateCalc result: the AI's last calc, re-checked with the slider overrides
    calcSheet: null, // the AI's calc itself (for the sliders)
    overrides: {}, // "what if" slider values, by input name
    error: '',
    parked: false, // phone put down (live.js stops streaming frames; the mic stays open)
  };
  const subs = new Set();
  let heardDone = true; // true once the AI answers: the next onHeard starts a new line
  const gestures = new Map();
  const set = (patch) => {
    state = { ...state, ...patch };
    subs.forEach((f) => f());
  };

  const handlers = {
    onScene: () => {}, // the overlay reads live.trackedScene() every frame instead
    onGesture: (g) => {
      if (!g?.target) return;
      const t = performance.now();
      gestures.set(g.target, { ...g, start: t, until: t + GESTURE_MS });
    },
    onProcedure: (p) => set({ procedure: p }),
    // A new calc from the AI resets the sliders.
    onCalc: ({ sheet, result }) => set({ calc: result, calcSheet: sheet ?? null, overrides: {} }),
    // onSaid gives the whole utterance so far; onHeard gives fragments of what the user says.
    // Fragments are joined until the AI starts answering, then the next thing heard starts fresh.
    onSaid: (text, final) => {
      heardDone = true;
      set(final ? { said: text, saidFinal: text } : { said: text });
    },
    onHeard: (text) => {
      const heard = heardDone ? text.trim() : `${state.heard}${text}`.trim();
      heardDone = false;
      set({ heard });
    },
    onStatus: (s) => set({ status: s }),
    onParked: (parked) => set({ parked: Boolean(parked) }),
    onError: (e) => set({ error: e?.message || String(e) }),
  };

  // Slider moved (value) or reset (null for all).
  function setOverride(name, value) {
    if (!state.calcSheet) return;
    const overrides = name == null ? {} : { ...state.overrides, [name]: { value, by: 'you' } };
    set({ overrides, calc: evaluateCalc(state.calcSheet, null, overrides) });
  }

  return {
    handlers,
    setOverride,
    gestures,
    set,
    get: () => state,
    subscribe: (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
