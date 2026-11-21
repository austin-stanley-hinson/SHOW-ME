// Checks a parsed Gemini reply against CONTRACT.md.
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

const isXY = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const clampXY = (p) => p.map((n) => Math.min(1, Math.max(0, n)));

function cleanItem(item) {
  if (!item || typeof item !== 'object') return null;
  const fields = TYPES[item.type];
  if (!fields || typeof item.id !== 'string' || !item.id) return null;
  for (const f of fields) if (!isXY(item[f])) return null;
  if ((item.type === 'label' || item.type === 'step') && typeof item.label !== 'string') return null;
  if (item.type === 'step' && !Number.isInteger(item.n)) return null;
  if (item.type === 'panel' && typeof item.text !== 'string') return null;

  const out = { ...item };
  for (const f of fields) out[f] = clampXY(item[f]);
  return out;
}

export function validateResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'not an object' };
  if (typeof data.answer !== 'string' || !data.answer.trim()) return { ok: false, error: 'missing answer' };
  if (data.followup_question !== null && typeof data.followup_question !== 'string') {
    return { ok: false, error: 'followup_question must be string or null' };
  }
  if (data.physics !== null && (typeof data.physics !== 'object' || Array.isArray(data.physics))) {
    return { ok: false, error: 'physics must be object or null' };
  }
  if (!Array.isArray(data.draw)) return { ok: false, error: 'draw must be an array' };

  const seen = new Set();
  const draw = [];
  for (const raw of data.draw) {
    const item = cleanItem(raw);
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
      physics: data.physics,
      draw,
    },
  };
}
