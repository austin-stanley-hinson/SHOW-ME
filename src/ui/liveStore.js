// Bridges src/client/live.js callbacks to React state.
// The live session must start inside the user's tap (iOS audio), so the tap handler creates the
// store, passes store.handlers to startLive(), and the UI subscribes with useSyncExternalStore.
//
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
    calc: null, // evaluateCalc result from the AI's last calc
    error: '',
  };
  const subs = new Set();
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
    onCalc: ({ result }) => set({ calc: result }),
    onSaid: (text, final) => set(final ? { said: text, saidFinal: text } : { said: text }),
    onHeard: (text) => set({ heard: text }),
    onStatus: (s) => set({ status: s }),
    onError: (e) => set({ error: e?.message || String(e) }),
  };

  return {
    handlers,
    gestures,
    set,
    get: () => state,
    subscribe: (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
