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
  // Label items often arrive with their words in "text": use them as the label.
  if (out.type === 'label' && typeof out.label !== 'string' && typeof out.text === 'string') out.label = out.text;
  // An arrow with only a tip ("point at the keys"): add a tail up-left of it instead of rejecting it.
  // A spot item (circle, point, step, label) given from/to instead of at: use it as the spot.
  if (out.type !== 'arrow' && out.type !== 'line' && out.at === undefined && out.at_point === undefined) {
    const p = out.from_point ?? out.to_point;
    if (typeof p === 'string') out.at_point = p;
    else if (Array.isArray(out.from ?? out.to)) out.at = out.from ?? out.to;
    delete out.from_point; delete out.to_point; delete out.from; delete out.to;
  }
  // An arrow given a single position ("at") means "point at this spot".
  if (out.type === 'arrow' && out.to === undefined && out.to_point === undefined) {
    if (Array.isArray(out.at)) out.to = out.at;
    else if (typeof out.at_point === 'string') out.to_point = out.at_point;
    delete out.at;
    delete out.at_point;
  }
  if (out.type === 'arrow' && out.from === undefined && out.from_point === undefined) {
    const tip = Array.isArray(out.to) ? out.to : null; // [y, x] 0-1000
    if (tip) out.from = [Math.max(0, tip[0] - 120), Math.max(0, tip[1] - 120)];
  }
  if ((out.type === 'circle' || out.type === 'rotate') && !(Number.isFinite(out.r) && out.r > 0)) out.r = out.type === 'rotate' ? 60 : 45; // live: default size (0-1000 units)
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
      // A new show REPLACES what's on screen unless the model asks to keep it (clear: false): adding by default
      // left old drawings piling up and looked sloppy in demo recordings.
      clear: args?.clear !== false,
      points: Array.isArray(args?.points) ? args.points : [],
      draw: [],
    };
    const pointIds = new Set([...scene.points.map((p) => p.id), ...raw.points.map((p) => p?.id)]);
    raw.draw = (Array.isArray(args?.items) ? args.items : []).map((i) => withPointRefs(i, pointIds));
    // A spot item with no position, sent together with exactly one point, belongs on that point
    // (e.g. a rotate "Twist to open" + points [{ id: "cap" }]).
    if (raw.points.length === 1) {
      for (const i of raw.draw) {
        if (['circle', 'rotate', 'point', 'step', 'label'].includes(i.type) && i.at === undefined && i.at_point === undefined) i.at = raw.points[0].id;
      }
    }
    // Points already on screen can be referenced by id; validate against the merged set.
    // Points already on screen can be referenced, but only when the view is kept (clear: false).
    const keep = raw.clear ? [] : scene.points.map((p) => ({ id: p.id, at: [p.at[1] * 1000, p.at[0] * 1000] }));
    const merged = { ...raw, points: [...keep, ...raw.points] };
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

  // wait: the model has nothing to say (auto-check turns). The app drops that turn's audio.
  const wait = (args) => ({ response: { ok: true }, update: { wait: { seen: typeof args?.seen === 'string' ? args.seen.slice(0, 120) : null } } });
  const HANDLERS = { show, remove, gesture, procedure, calc, wait };

  const words = (id) => id.replace(/_/g, ' ');
  // "fork_arrow" -> "fork", "nametag_circle" -> "nametag"
  const stem = (id) => words(id).replace(/\b(arrow|label|circle|point|dot|marker|highlight|pointer|tip)\b/g, '').replace(/\s+/g, ' ').trim() || words(id);
  const near = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.06;
  // A label item sitting at (about) the same spot names what's there.
  const labelAt = (pos, exceptId) => scene.items.find((i) => i.id !== exceptId && i.type === 'label' && near(i.at, pos))?.label;
  // What to look up precisely after a show: named points and spot-like items that were just added.
  // Which end of an arrow touches the real part: "tip" for pointing ("here's the lever"), "tail" for a
  // motion or force applied to a part ("lift the cover", "weight acts here"). The other end is a direction
  // in space, never looked up. The model can say so with item.anchor; otherwise motion verbs mean "tail".
  // "Press here" / "push this" point at a spot (tip). Strong motion verbs or direction words describe a
  // motion or force of the part (tail): "lift the cover", "slide it out", "push down", "weight".
  const HERE = /\b(here|this|that)\b/i;
  const STRONG = /\b(lift|raise|lower|slide|turn|rotate|twist|swing|fold|unfold|flip|tilt|open|close|pull|weight|force|load|gravity)\b/i;
  const DIRECTION = /\b(up|down|left|right|away|toward|towards|forward|backward|back|outward|inward|clockwise|counterclockwise|this way)\b/i;
  const anchorOf = (it) => {
    if (it.anchor === 'tail' || it.anchor === 'tip') return it.anchor;
    const text = it.label || (it.id || '').replace(/_/g, ' ');
    if (HERE.test(text) && !DIRECTION.test(text)) return 'tip';
    return STRONG.test(text) || DIRECTION.test(text) ? 'tail' : 'tip';
  };
  const endField = (it) => (anchorOf(it) === 'tail' ? 'from' : 'to');

  // Points that are only the free (direction) end of an arrow: id -> the point/arrow that anchors them.
  function freePoints() {
    const free = new Map();
    const anchoredRefs = new Set();
    for (const it of scene.items) {
      if (it.type !== 'arrow' || !it.refs) continue;
      const f = endField(it), other = f === 'to' ? 'from' : 'to';
      if (it.refs[f]) anchoredRefs.add(it.refs[f]);
      if (it.refs[other]) free.set(it.refs[other], { anchorPoint: it.refs[f] || null, arrow: it.id });
    }
    for (const id of anchoredRefs) free.delete(id); // anchored somewhere else: it's a real part
    for (const it of scene.items) if (it.type !== 'arrow') for (const r of Object.values(it.refs || {})) free.delete(r);
    return free;
  }

  // What to look up precisely after a show: real spots only.
  function targetsFor(shownIds, pointIds) {
    const out = [];
    const free = freePoints();
    for (const id of pointIds) {
      const p = scene.points.find((x) => x.id === id);
      if (!p || free.has(id)) continue;
      const user = scene.items.find((i) => Object.values(i.refs || {}).includes(id) && i.label);
      out.push({ id, label: user ? `${user.label} (${words(id)})` : words(id), at: p.at });
    }
    for (const id of shownIds) {
      const it = scene.items.find((i) => i.id === id);
      if (!it) continue;
      if (Array.isArray(it.at) && ['circle', 'rotate', 'point', 'step'].includes(it.type)) {
        if (!it.refs?.at) out.push({ id, label: it.label || labelAt(it.at, id) || stem(id), at: it.at });
      } else if (it.type === 'arrow') {
        // Snap the end that touches the part (unless that end is a named point, which is looked up itself).
        const f = endField(it);
        if (Array.isArray(it[f]) && !it.refs?.[f]) out.push({ id, label: it.label || labelAt(it[f], id) || stem(id), at: it[f] });
      }
    }
    return out.slice(0, 8);
  }

  // Snap points/items to precise positions [{ id, at }] (contract coords). Arrows move rigidly (direction and
  // length kept); free arrow ends and labels sitting on a snapped spot move by the same amount; items that
  // reference a point by id get that point's new position. Returns the new scene.
  function refine(found) {
    const byId = new Map(found.map((f) => [f.id, f.at]));
    const delta = new Map(); // id -> [dx, dy]
    const moves = [];
    for (const f of found) {
      const it = scene.items.find((i) => i.id === f.id);
      const old = it ? (it.type === 'arrow' ? it[endField(it)] : it.at) : scene.points.find((p) => p.id === f.id)?.at;
      if (!Array.isArray(old)) continue;
      const d = [f.at[0] - old[0], f.at[1] - old[1]];
      delta.set(f.id, d);
      moves.push({ from: old, d });
    }
    // Free arrow ends follow their anchor point.
    for (const [pid, link] of freePoints()) {
      const d = (link.anchorPoint && delta.get(link.anchorPoint)) || delta.get(link.arrow);
      const p = scene.points.find((x) => x.id === pid);
      if (d && p && !byId.has(pid)) byId.set(pid, [p.at[0] + d[0], p.at[1] + d[1]]);
    }
    // Labels on a snapped spot ride along.
    for (const i of scene.items) {
      if (byId.has(i.id) || i.type !== 'label' || !Array.isArray(i.at) || i.refs?.at) continue;
      const m = moves.find((mv) => near(mv.from, i.at));
      if (m) byId.set(i.id, [i.at[0] + m.d[0], i.at[1] + m.d[1]]);
    }
    const points = scene.points.map((p) => (byId.has(p.id) ? { ...p, at: byId.get(p.id) } : p));
    const pointAt = new Map(points.map((p) => [p.id, p.at]));
    const items = scene.items.map((i) => {
      let out = i;
      if (byId.has(i.id)) {
        const at = byId.get(i.id);
        if (i.type === 'arrow') {
          const d = delta.get(i.id) || [0, 0];
          const shift = (p) => (Array.isArray(p) ? [p[0] + d[0], p[1] + d[1]] : p);
          out = { ...i, from: shift(i.from), to: shift(i.to) };
        } else if (Array.isArray(i.at)) out = { ...i, at };
      }
      // Positions that are named points take the point's (possibly new) position.
      if (i.refs) {
        let changed = false;
        const upd = { ...out };
        for (const [f, pid] of Object.entries(i.refs)) {
          const at = pointAt.get(pid);
          if (at && (upd[f]?.[0] !== at[0] || upd[f]?.[1] !== at[1])) (upd[f] = at), (changed = true);
        }
        if (changed) out = upd;
      }
      return out;
    });
    scene = { ...scene, points, items };
    return scene;
  }


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
    targetsFor,
    refine,
    reset() {
      scene = emptyScene();
      calcResult = null;
    },
  };
}
