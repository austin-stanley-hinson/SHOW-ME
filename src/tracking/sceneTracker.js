// Keeps a whole scene (contract v3 items + named points) stuck to the real world as the phone moves.
// Wraps tracker.js for both modes: Live (frames streamed to Gemini) and Photo (/api/ask on a captured frame).
//
//   const st = createSceneTracker(video);     // video = the <video> showing the camera
//   st.start();                               // tracks ~15 fps in the background
//
//   // When you capture / send a frame the model will answer about:
//   const frameId = st.mark();
//   ...                                       // the answer arrives 1-3 s later
//   st.place(scene, frameId);                 // anchor new/changed items to THAT frame
//
//   // Every animation frame:
//   const now = st.current(scene);            // { items, points, tracking: { quality, lost } }
//   render(now.items, now.points);            // positions moved to where the spots are now;
//                                             // items with stale: true could not be anchored (fade them)
//   st.stop();
//
// Positions that are point ids (strings) stay ids: resolve them through now.points, which are tracked.

import { createTracker, grabGray } from './tracker.js';

const FIELDS = ['at', 'from', 'to'];

export function createSceneTracker(video, { fps = 15, width = 320 } = {}) {
  const tracker = createTracker();
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const anchors = new Map(); // item object | 'pt:'+id -> { src, at?, from?, to? } in reference coords
  let timer = null;

  function step() {
    const g = canvas && grabGray(video, canvas, width);
    if (g) tracker.push(g.gray, g.w, g.h);
  }

  return {
    start() {
      if (!timer) timer = setInterval(step, Math.round(1000 / fps));
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    // Track the current camera frame now and return its id (call right when you capture / send it).
    mark() {
      step();
      if (tracker.lost) {
        // The scene was lost earlier: start a fresh reference from this frame. Old anchors are invalid.
        tracker.reset();
        anchors.clear();
        step();
      }
      return tracker.latestId;
    },
    // Anchor items and points that are new or were replaced (same id, new object) to frame `frameId`.
    place(scene, frameId) {
      const keep = new Set();
      for (const p of scene.points || []) {
        const key = 'pt:' + p.id;
        keep.add(key);
        if (anchors.get(key)?.src !== p) anchors.set(key, { src: p, at: tracker.toRef(p.at, frameId) });
      }
      for (const it of scene.items || []) {
        keep.add(it);
        if (anchors.has(it)) continue;
        const a = { src: it };
        for (const f of FIELDS) if (Array.isArray(it[f])) a[f] = tracker.toRef(it[f], frameId);
        anchors.set(it, a);
      }
      for (const k of anchors.keys()) if (!keep.has(k)) anchors.delete(k);
    },
    // The scene re-projected into the newest camera frame.
    current(scene) {
      const lost = tracker.lost;
      const pos = (ref, fallback) => (lost || !ref ? fallback : tracker.fromRef(ref) ?? fallback);
      const points = (scene.points || []).map((p) => ({ ...p, at: pos(anchors.get('pt:' + p.id)?.at, p.at) }));
      const items = (scene.items || []).map((it) => {
        const a = anchors.get(it) || {};
        const out = { ...it };
        let anchored = true;
        for (const f of FIELDS) {
          if (!Array.isArray(it[f])) continue;
          if (!a[f]) anchored = false;
          out[f] = pos(a[f], it[f]);
        }
        if (lost || !anchored) out.stale = true;
        return out;
      });
      return { items, points, tracking: { quality: tracker.quality, lost } };
    },
    get tracker() {
      return tracker;
    },
  };
}
