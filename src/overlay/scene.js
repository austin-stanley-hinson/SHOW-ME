// Turns a contract response (CONTRACT.md) into a clean, render-ready scene.
// Applies the renderer rules: ignore bad items, clamp coordinates, keep first id, max 12,
// and every number comes from physics.js (formatLabel / computePhysics).
// Pure: no DOM, so it runs under `node --test`.

import { computePhysics, formatLabel } from '../physics/physics.js';

const MAX_ITEMS = 12;
const MAX_LABEL = 40;
const MAX_PANEL_TEXT = 400;

const REQUIRED_POINTS = {
  arrow: ['from', 'to'],
  line: ['from', 'to'],
  point: ['at'],
  label: ['at'],
  step: ['at'],
  panel: ['at'],
};

const DEFAULT_COLOR = {
  arrow: '#ffcc00',
  line: '#ffffff',
  point: '#ffffff',
  label: '#ffffff',
  step: '#ffcc00',
  panel: '#ffffff',
};

const isXY = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const clampXY = (p) => p.map((n) => Math.min(1, Math.max(0, n)));
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const str = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function normalizeItem(raw, physics) {
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
    text: formatLabel(label, typeof raw.quantity === 'string' ? raw.quantity : null, physics),
  };
  for (const f of fields) item[f] = clampXY(raw[f]);

  if (raw.type === 'step') item.n = raw.n;
  if (raw.type === 'panel') {
    const isPhysics = raw.content === 'physics';
    item.title = label;
    item.body = str(raw.text, MAX_PANEL_TEXT);
    item.lines = isPhysics && physics.ok ? physics.lines : [];
    item.assumptions = isPhysics ? physics.assumptions : [];
    item.isPhysics = isPhysics;
  }
  return item;
}

// data: the contract JSON from /api/ask (or a fixture).
export function buildScene(data) {
  const physics = computePhysics(data?.physics ?? null);
  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(data?.draw) ? data.draw : []) {
    const item = normalizeItem(raw, physics);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length === MAX_ITEMS) break;
  }

  const steps = items
    .filter((i) => i.type === 'step')
    .sort((a, b) => a.n - b.n)
    .map((s) => ({ n: s.n, text: s.text }));

  return {
    answer: str(data?.answer, 1000),
    followup: str(data?.followup_question, 300) || null,
    items,
    steps,
    physics, // { ok, quantities, lines, assumptions }
    hasPhysics: Boolean(data?.physics),
    // Assumptions must always be visible when physics is shown. If no physics panel is
    // drawn, the caption area shows them instead.
    physicsPanelDrawn: items.some((i) => i.type === 'panel' && i.isPhysics),
    // The canvas panel shows only title + math; its explanation goes in the caption area.
    explanation: items.find((i) => i.type === 'panel' && i.isPhysics)?.body || '',
  };
}
