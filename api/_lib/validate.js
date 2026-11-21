// Checks a parsed Gemini reply against CONTRACT.md (v3).
// Returns { ok: true, value } with bad draw items dropped, or { ok: false, error }.

const TYPES = {
  arrow: ['from', 'to'],
  line: ['from', 'to'],
  point: ['at'],
  circle: ['at'],
  rotate: ['at'], // curved arrow around a spot: dir 'cw' | 'ccw', r like circle
  label: ['at'],
  step: ['at'],
  panel: ['at'],
};
const MAX_ITEMS = 12;
const MAX_POINTS = 16;
const MAX_NARRATION = 8;
const GESTURES = new Set(['point', 'pulse', 'trace', 'circle']);
const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);

// narration: [{ say, gesture?: { type, target } }]. A gesture's target is a draw item id or a point id;
// unknown targets are dropped (the line is still spoken). The client may also target items already on screen,
// so ids listed in "keepIds" (from the previous scene) count too.
function cleanNarration(raw, targets) {
  const out = [];
  for (const n of Array.isArray(raw) ? raw : []) {
    const say = str(n?.say, 200);
    if (!say) continue;
    const g = n.gesture;
    const gesture = g && GESTURES.has(g.type) && typeof g.target === 'string' && targets.has(g.target) ? { type: g.type, target: g.target } : null;
    out.push(gesture ? { say, gesture } : { say });
    if (out.length === MAX_NARRATION) break;
  }
  return out;
}

// procedure: { title, current, total, done_when, safety: [] } for guided step-by-step tasks.
function cleanProcedure(p) {
  if (!p || typeof p !== 'object') return null;
  const current = Number.isInteger(p.current) && p.current > 0 ? p.current : null;
  if (!current) return null;
  const total = Number.isInteger(p.total) && p.total >= current ? p.total : null;
  const safety = (Array.isArray(p.safety) ? p.safety : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 3);
  return {
    title: str(p.title, 60),
    current,
    total,
    done_when: str(p.done_when, 160),
    complete: p.complete === true,
    safety,
  };
}

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
  if (item.type === 'circle' && !(Number.isFinite(item.r) && item.r > 0)) return null;

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
  if (item.type === 'circle') out.r = Math.min(0.3, Math.max(0.01, item.r));
  if (item.type === 'rotate') {
    out.r = Number.isFinite(item.r) && item.r > 0 ? Math.min(0.3, Math.max(0.02, item.r)) : 0.06;
    out.dir = item.dir === 'ccw' ? 'ccw' : 'cw';
  }
  if (Object.keys(refs).length) out.refs = refs;
  return out;
}

// options.previousIds: ids of items currently on screen (lets narration/edits refer to them).
function cleanTitle(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim().replace(/^[a-z]+\s+(?=[A-Z])/, '').slice(0, 40);
  return s || null;
}

export function validateResponse(data, options = {}) {
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

  // Scene edits: "clear" (default true) starts a fresh view; false keeps what's on screen, and draw items
  // with an existing id replace that item. "remove" lists ids to take away.
  const clear = data.clear !== false;
  const remove = clear ? [] : (Array.isArray(data.remove) ? data.remove : []).filter((id) => typeof id === 'string' && ID_RE.test(id)).slice(0, 20);
  const previousIds = Array.isArray(options.previousIds) ? options.previousIds : [];
  const targets = new Set([...draw.map((i) => i.id), ...points.list.map((p) => p.id), ...(clear ? [] : previousIds.filter((id) => !remove.includes(id)))]);

  return {
    ok: true,
    value: {
      // Gemini sometimes garbles the very first string it writes (" me stand is…"), so the prompt puts a
      // throwaway-safe title first. Clean it: drop a leading lowercase fragment, keep it short.
      title: cleanTitle(data.title),
      heard: typeof data.heard === 'string' && data.heard.trim() ? data.heard.trim().slice(0, 300) : null,
      answer: data.answer.trim(),
      followup_question: data.followup_question,
      points: points.list,
      calc: data.calc,
      draw,
      clear,
      remove,
      narration: cleanNarration(data.narration, targets),
      procedure: cleanProcedure(data.procedure),
    },
  };
}
