// Checks a parsed Gemini reply against CONTRACT.md (v3).
// Returns { ok: true, value } with bad draw items dropped, or { ok: false, error }.

const TYPES = {
  arrow: ['from', 'to'],
  line: ['from', 'to'],
  point: ['at'],
  label: ['at'],
  step: ['at'],
  panel: ['at'],
};
const MAX_ITEMS = 12;
const MAX_POINTS = 16;

const isXY = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const clampXY = (p) => p.map((n) => Math.min(1, Math.max(0, n)));

// points: [{ id, at: [x, y] }] -> { id: [x, y] }. Bad or repeated points are dropped.
function cleanPoints(raw) {
  const map = {};
  const list = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!p || typeof p.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(p.id) || !isXY(p.at)) continue;
    if (Object.hasOwn(map, p.id)) continue;
    map[p.id] = clampXY(p.at);
    list.push({ id: p.id, at: map[p.id] });
    if (list.length === MAX_POINTS) break;
  }
  return { map, list };
}

// A position is [x, y] or the id of a point. Ids are resolved to coordinates and kept in item.refs
// so the 3D renderer can attach the item to the measured point.
function cleanItem(item, points) {
  if (!item || typeof item !== 'object') return null;
  const fields = TYPES[item.type];
  if (!fields || typeof item.id !== 'string' || !item.id) return null;
  if ((item.type === 'label' || item.type === 'step') && typeof item.label !== 'string') return null;
  if (item.type === 'step' && !Number.isInteger(item.n)) return null;
  if (item.type === 'panel' && typeof item.text !== 'string') return null;

  const out = { ...item };
  const refs = {};
  for (const f of fields) {
    const v = item[f];
    if (typeof v === 'string' && Object.hasOwn(points, v)) {
      out[f] = points[v];
      refs[f] = v;
    } else if (isXY(v)) {
      out[f] = clampXY(v);
    } else {
      return null;
    }
  }
  if (Object.keys(refs).length) out.refs = refs;
  return out;
}

export function validateResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'not an object' };
  if (typeof data.answer !== 'string' || !data.answer.trim()) return { ok: false, error: 'missing answer' };
  // Missing optional-ish keys become null / [] rather than rejecting a good answer.
  data = { ...data, followup_question: data.followup_question ?? null, calc: data.calc ?? null };
  if (data.followup_question !== null && typeof data.followup_question !== 'string') {
    return { ok: false, error: 'followup_question must be string or null' };
  }
  if (data.calc !== null && (typeof data.calc !== 'object' || Array.isArray(data.calc))) {
    return { ok: false, error: 'calc must be object or null' };
  }
  if (!Array.isArray(data.draw)) return { ok: false, error: 'draw must be an array' };

  const points = cleanPoints(data.points);
  const seen = new Set();
  const draw = [];
  for (const raw of data.draw) {
    const item = cleanItem(raw, points.map);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    draw.push(item);
    if (draw.length === MAX_ITEMS) break;
  }

  return {
    ok: true,
    value: {
      answer: data.answer,
      followup_question: data.followup_question,
      points: points.list,
      calc: data.calc,
      draw,
    },
  };
}
