// src/client/view.js: the view as a persistent scene (lane B). Lane A renders whatever this returns.
//
//   let scene = emptyScene();
//   scene = applyResponse(scene, data);          // after every /api/ask answer
//   render(scene.items, scene.points);           // items: draw items in order
//   ask(canvas, q, previousFor(scene));          // next question knows what's on screen
//
// CONTRACT v3 "Editing the view": clear (default true) empties the scene, then every id in remove is
// taken away, then each draw item is added; an item with an existing id replaces it in place.

export const emptyScene = () => ({ items: [], points: [], question: null, last: null });

export function applyResponse(scene, data, question = null) {
  const keep = data?.clear === false;
  const remove = new Set(keep && Array.isArray(data?.remove) ? data.remove : []);
  const items = keep ? scene.items.filter((i) => !remove.has(i.id)) : [];
  for (const item of Array.isArray(data?.draw) ? data.draw : []) {
    const at = items.findIndex((i) => i.id === item.id);
    if (at >= 0) items[at] = item;
    else items.push(item);
  }
  // Points: merge by id the same way, so items kept from earlier turns can still reference theirs.
  const points = keep ? scene.points.filter((p) => !remove.has(p.id)) : [];
  for (const p of Array.isArray(data?.points) ? data.points : []) {
    const at = points.findIndex((x) => x.id === p.id);
    if (at >= 0) points[at] = p;
    else points.push(p);
  }
  return { items, points, question, last: data ?? null };
}

// The "previous" payload for /api/ask: the last question plus the CURRENT scene (not just the last
// answer), so the model can refer to, move or remove anything on screen.
export function previousFor(scene) {
  if (!scene.last || !scene.question) return null;
  const { answer, calc, procedure, followup_question } = scene.last;
  return {
    question: scene.question,
    response: { answer, followup_question, calc, procedure, points: scene.points, draw: scene.items },
  };
}

// Find what a gesture points at: a draw item, or a named point (returned as a pseudo point item).
export function findTarget(scene, id) {
  const item = scene.items.find((i) => i.id === id);
  if (item) return item;
  const p = scene.points.find((x) => x.id === id);
  return p ? { type: 'point', id: p.id, at: p.at } : null;
}
