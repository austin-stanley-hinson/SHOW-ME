// Eases tracked positions toward their targets each frame, so snaps and tracker corrections glide
// instead of jump. Huge jumps (the thing was re-found somewhere else) teleport. Hidden items are
// passed through untouched. Positions that are point ids (strings) are left alone.
const FIELDS = ['at', 'from', 'to'];

export function createSmoother({ rate = 0.35, teleport = 0.35 } = {}) {
  const shown = new Map(); // key -> last drawn [x, y]

  function ease(key, p) {
    const prev = shown.get(key);
    const far = prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > teleport;
    const next = !prev || far ? p : [prev[0] + (p[0] - prev[0]) * rate, prev[1] + (p[1] - prev[1]) * rate];
    shown.set(key, next);
    return next;
  }

  return function smooth(scene) {
    const seen = new Set();
    const items = (scene.items || []).map((it) => {
      if (it.hidden) return it;
      const out = { ...it };
      for (const f of FIELDS) {
        if (!Array.isArray(it[f])) continue;
        const key = `${it.id}.${f}`;
        seen.add(key);
        out[f] = ease(key, it[f]);
      }
      return out;
    });
    const points = (scene.points || []).map((p) => {
      if (!Array.isArray(p.at)) return p;
      const key = `p:${p.id}`;
      seen.add(key);
      return { ...p, at: ease(key, p.at) };
    });
    // Forget what's no longer drawn, so it doesn't glide in from an old spot when it comes back.
    for (const k of shown.keys()) if (!seen.has(k)) shown.delete(k);
    return { ...scene, items, points };
  };
}
