// Debug recorder for live sessions (lane B). Keeps the last ~90 s ON THE PHONE ONLY: frames sent to the
// model (small JPEGs), every tool call and response, precise-point lookups, transcripts, and where the
// tracker moved each drawing. Nothing is uploaded; the user exports it with a tap (live.debugReport())
// and shares the file with the team.

const KEEP_MS = 90_000;

export function createDebugLog() {
  const t0 = Date.now();
  let events = [];
  const frames = new Map(); // frameId -> { t, jpeg }

  const prune = () => {
    const cutoff = Date.now() - t0 - KEEP_MS;
    events = events.filter((e) => e.t >= cutoff);
    for (const [id, f] of frames) if (f.t < cutoff) frames.delete(id);
  };

  return {
    event(type, data) {
      events.push({ t: Date.now() - t0, type, data });
      if (events.length % 50 === 0) prune();
    },
    frame(id, jpeg) {
      frames.set(id, { t: Date.now() - t0, jpeg });
      if (frames.size % 20 === 0) prune();
    },
    report(extra = {}) {
      prune();
      return {
        kind: 'show-me-debug',
        version: 1,
        startedAt: new Date(t0).toISOString(),
        durationMs: Date.now() - t0,
        userAgent: globalThis.navigator?.userAgent || null,
        screen: globalThis.screen ? { w: screen.width, h: screen.height, dpr: globalThis.devicePixelRatio } : null,
        ...extra,
        events,
        frames: Object.fromEntries([...frames].map(([id, f]) => [id, f])),
      };
    },
  };
}
