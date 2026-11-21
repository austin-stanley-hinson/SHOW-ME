// Turns Gemini Live tool calls into contract-shaped updates (pure; runs in the browser and in Node tests).
//
//   const t = createLiveTools();
//   const { response, update } = t.handle(functionCall);   // send `response` back as the toolResponse
//   // update: { scene } | { gesture } | { procedure } | { calc } - hand to the renderer
//
// Same rules as /api/ask: Gemini's [y, x] 0-1000 -> contract [x, y] 0-1 (coords.js), cleaned by the validator,
// applied to the persistent scene (view.js), numbers checked by calc.js.

import { toContractCoords } from '../../api/_lib/coords.js';
import { validateResponse } from '../../api/_lib/validate.js';
import { applyResponse, emptyScene } from './view.js';
import { evaluateCalc } from '../physics/calc.js';

const POS_REFS = [
  ['at_point', 'at'],
  ['from_point', 'from'],
  ['to_point', 'to'],
];

// at_point / from_point / to_point -> a point-id position (the contract allows ids in at/from/to).
const NEEDS = { arrow: ['from', 'to'], line: ['from', 'to'], point: ['at'], circle: ['at'], label: ['at'], step: ['at'], panel: ['at'] };

function withPointRefs(item, pointIds) {
  const out = { ...item };
  if (out.type === 'circle' && !(Number.isFinite(out.r) && out.r > 0)) out.r = 45; // live: default ring size (0-1000 units)
  for (const [ref, field] of POS_REFS) {
    if (typeof out[ref] === 'string' && out[ref]) out[field] = out[ref];
    delete out[ref];
  }
  // A point item / circle / label with no position but the same id as a named point means "here".
  if (NEEDS[out.type]?.[0] === 'at' && out.at === undefined && pointIds.has(out.id)) out.at = out.id;
  return out;
}

function whyDropped(i) {
  if (!NEEDS[i?.type]) return 'type must be one of ' + Object.keys(NEEDS).join(', ');
  if (typeof i.id !== 'string' || !i.id) return 'needs an id';
  const missing = NEEDS[i.type].filter((f) => i[f] === undefined);
  if (missing.length) return `needs ${missing.join(' and ')} as [y, x] 0-1000 (or ${missing.map((f) => f + '_point').join('/')} = a point id)`;
  if ((i.type === 'label' || i.type === 'step') && typeof i.label !== 'string') return 'needs label text';
  if (i.type === 'step' && !Number.isInteger(i.n)) return 'needs n (step number)';
  if (i.type === 'panel' && typeof i.text !== 'string') return 'needs text';
  return 'a position refers to an unknown point id';
}

export function createLiveTools({ coords = 'yx1000' } = {}) {
  let scene = emptyScene();
  let calcResult = null;

  const onScreen = () => scene.items.map((i) => i.id);

  function show(args) {
    const raw = {
      answer: '(live)',
      clear: args?.clear === true ? true : false,
      points: Array.isArray(args?.points) ? args.points : [],
      draw: [],
    };
    const pointIds = new Set([...scene.points.map((p) => p.id), ...raw.points.map((p) => p?.id)]);
    raw.draw = (Array.isArray(args?.items) ? args.items : []).map((i) => withPointRefs(i, pointIds));
    // Points already on screen can be referenced by id; validate against the merged set.
    const merged = { ...raw, points: [...scene.points.map((p) => ({ id: p.id, at: [p.at[1] * 1000, p.at[0] * 1000] })), ...raw.points] };
    const converted = toContractCoords(merged, coords);
    const v = validateResponse(converted, { previousIds: onScreen() });
    if (!v.ok) return { response: { error: v.error } };
    const sent = new Set(raw.draw.map((i) => i.id));
    const kept = v.value.draw.filter((i) => sent.has(i.id));
    scene = applyResponse(scene, { ...v.value, draw: kept }, scene.question);
    const dropped = raw.draw.filter((i) => !kept.some((k) => k.id === i.id)).map((i) => ({ id: i.id, why: whyDropped(i) }));
    return {
      response: { shown: kept.map((i) => i.id), ...(dropped.length && { dropped }) },
      update: { scene },
    };
  }

  function remove(args) {
    const ids = Array.isArray(args?.ids) ? args.ids : [];
    scene = applyResponse(scene, { clear: false, remove: ids, draw: [] }, scene.question);
    return { response: { removed: ids, on_screen: onScreen() }, update: { scene } };
  }

  function gesture(args) {
    const target = typeof args?.target === 'string' ? args.target : '';
    const exists = scene.items.some((i) => i.id === target) || scene.points.some((p) => p.id === target);
    if (!exists) return { response: { error: `nothing with id "${target}" is on screen`, on_screen: onScreen() } };
    return { response: { ok: true }, update: { gesture: { type: args.type, target } } };
  }

  function procedure(args) {
    const v = validateResponse({ answer: '(live)', draw: [], procedure: args });
    return v.value.procedure ? { response: { ok: true }, update: { procedure: v.value.procedure } } : { response: { error: 'needs current step number' } };
  }

  function calc(args) {
    calcResult = evaluateCalc(args);
    const r = calcResult;
    return {
      response: {
        verified: r.verified,
        lines: r.lines,
        ...(r.mismatches.length && { mismatches: r.mismatches, note: 'Some of your results are wrong. Say the corrected numbers.' }),
        ...(r.errors.length && { errors: r.errors }),
        ...(r.verdict && { verdict: r.verdict.text, verdict_check: r.verdict.check }),
      },
      update: { calc: { sheet: args, result: r } },
    };
  }

  const HANDLERS = { show, remove, gesture, procedure, calc };

  return {
    handle(fc) {
      const h = HANDLERS[fc?.name];
      if (!h) return { response: { error: `unknown tool ${fc?.name}` } };
      try {
        return h(fc.args || {});
      } catch (e) {
        return { response: { error: String(e.message || e) } };
      }
    },
    get scene() {
      return scene;
    },
    get calc() {
      return calcResult;
    },
    reset() {
      scene = emptyScene();
      calcResult = null;
    },
  };
}
