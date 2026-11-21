// Turns a contract v3 answer (CONTRACT.md) into a clean, render-ready scene.
// Applies the renderer rules: ignore bad items, clamp coordinates, keep first id, max 12.
// Numbers come from src/physics/calc.js: the model computes, evaluateCalc re-checks every step,
// and formatLabel shows each value with its status (est. / measured / set).
// Pure: no DOM, so it runs under `node --test`.

import { evaluateCalc, formatLabel, auditText } from '../physics/calc.js';

const MAX_ITEMS = 12;
const MAX_LABEL = 40;
const MAX_PANEL_TEXT = 300;

const REQUIRED_POINTS = {
  arrow: ['from', 'to'],
  line: ['from', 'to'],
  point: ['at'],
  circle: ['at'],
  label: ['at'],
  step: ['at'],
  panel: ['at'],
};

const DEFAULT_COLOR = {
  arrow: '#ffcc00',
  line: '#ffffff',
  point: '#ffffff',
  circle: '#ffcc00',
  label: '#ffffff',
  step: '#ffcc00',
  panel: '#ffffff',
};

const isXY = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const clampXY = (p) => p.map((n) => Math.min(1, Math.max(0, n)));
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const str = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function normalizeItem(raw, calc) {
  if (!raw || typeof raw !== 'object') return null;
  const fields = REQUIRED_POINTS[raw.type];
  if (!fields || typeof raw.id !== 'string' || !raw.id) return null;
  if (!fields.every((f) => isXY(raw[f]))) return null;

  const label = str(raw.label, MAX_LABEL);
  if ((raw.type === 'label' || raw.type === 'step') && !label) return null;
  if (raw.type === 'step' && !(Number.isInteger(raw.n) && raw.n > 0)) return null;
  if (raw.type === 'panel' && typeof raw.text !== 'string') return null;

  const item = {
    type: raw.type,
    id: raw.id,
    color: isHex(raw.color) ? raw.color : DEFAULT_COLOR[raw.type],
    text: formatLabel(label, typeof raw.quantity === 'string' ? raw.quantity : null, calc),
  };
  for (const f of fields) item[f] = clampXY(raw[f]);
  if (raw.stale) item.stale = true; // live mode: the tracker lost this spot
  if (raw.refs && typeof raw.refs === 'object') item.refs = raw.refs; // point ids, for gesture targets

  if (raw.type === 'step') item.n = raw.n;
  if (raw.type === 'circle') {
    const r = typeof raw.r === 'number' && Number.isFinite(raw.r) ? raw.r : 0.05;
    item.r = Math.min(0.3, Math.max(0.01, r)); // fraction of image width
  }
  if (raw.type === 'panel') {
    const isCalc = raw.content === 'calc';
    item.title = label;
    item.body = str(raw.text, MAX_PANEL_TEXT);
    item.lines = isCalc ? calc.lines : [];
    item.isCalc = isCalc;
  }
  return item;
}

// Split text into [{ text, unchecked }] so the UI can mark numbers the checker couldn't trace.
function markUnchecked(text, flagged) {
  if (!text || !flagged.length) return text ? [{ text, unchecked: false }] : [];
  const parts = [];
  let rest = text;
  for (const f of flagged) {
    const i = rest.indexOf(f.text);
    if (i < 0) continue;
    if (i > 0) parts.push({ text: rest.slice(0, i), unchecked: false });
    parts.push({ text: f.text, unchecked: true });
    rest = rest.slice(i + f.text.length);
  }
  if (rest) parts.push({ text: rest, unchecked: false });
  return parts;
}

// data: the latest contract answer (from /api/ask or a fixture).
// items (optional): the current view's items from src/client/view.js (applyResponse), so
// follow-up answers that edit the view (clear: false) keep what's already on screen.
// opts.calc (optional): an evaluateCalc result already computed (live mode gets one from onCalc).
export function buildScene(data, items = null, opts = {}) {
  const calc = opts.calc ?? evaluateCalc(data?.calc ?? null);
  const hasCalc = Boolean(data?.calc) || Boolean(opts.calc);
  const drawn = [];
  const seen = new Set();
  const source = Array.isArray(items) ? items : Array.isArray(data?.draw) ? data.draw : [];
  for (const raw of source) {
    const item = normalizeItem(raw, calc);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    drawn.push(item);
    if (drawn.length === MAX_ITEMS) break;
  }

  const steps = drawn
    .filter((i) => i.type === 'step')
    .sort((a, b) => a.n - b.n)
    .map((s) => ({ n: s.n, text: s.text }));

  const answer = str(data?.answer, 1000);
  const calcPanel = drawn.find((i) => i.type === 'panel' && i.isCalc);

  return {
    title: str(data?.title, 60),
    answer,
    // The answer with numbers the checker couldn't trace marked (CONTRACT: "mark untraced numbers").
    answerParts: markUnchecked(answer, hasCalc ? auditText(answer, calc, data?.calc) : []),
    followup: str(data?.followup_question, 300) || null,
    items: drawn,
    steps,
    calc, // { ok, verified, mismatches, quantities, lines, assumptions, errors, verdict }
    hasCalc,
    calcPanelDrawn: Boolean(calcPanel),
    // The canvas panel shows only title + math; its explanation goes in the caption area.
    explanation: calcPanel?.body || '',
  };
}
