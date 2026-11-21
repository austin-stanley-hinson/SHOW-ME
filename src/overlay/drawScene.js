// Draws a scene (from buildScene) onto a 2D canvas of size w×h (CSS pixels; caller handles DPR).
// Coordinates are normalized [x, y] 0-1 of the camera frame Gemini saw.
//
// opts.frame: { x, y, w, h } where that frame sits on the canvas, in px. Default: fills the canvas
//   (photo mode: the frozen frame is cropped exactly like the screen). Live mode sends Gemini the
//   whole video frame while the screen shows it cropped (object-fit: cover), so the frame rect
//   is bigger than the canvas and some items can sit off screen.
// opts.gestures: Map target id -> { type: 'pulse' | 'point' | 'trace' | ..., start, until } (ms).
// opts.points: named points [{ id, at }] so gestures can target a spot that isn't drawn.
// opts.now: performance.now() for gesture animation; opts.reduceMotion: draw gestures still.
// Items with stale: true (the tracker lost them) are drawn faded; hidden items never reach here
// (buildScene drops them). 'rotate' arrows spin slowly unless reduceMotion.
//
// opts.topRight: { w, h } px of UI in the top-right corner (result controls); avoided like the bar.
// opts.bottomInset: px at the bottom covered by UI. Text avoids that area when it can (shapes
// stay where Gemini put them, since they must line up with the image).

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const OUTLINE = 'rgba(0, 0, 0, 0.65)';
const PILL_BG = 'rgba(0, 0, 0, 0.8)';

export function drawScene(ctx, scene, w, h, opts = {}) {
  ctx.clearRect(0, 0, w, h);
  if (!scene) return;
  const s = Math.min(w, h) / 390; // sizes are designed for a ~390px-wide phone
  const f = opts.frame || { x: 0, y: 0, w, h };
  const env = {
    ctx,
    w,
    h,
    s,
    fw: f.w, // frame width in px: circle radii are a fraction of it
    now: opts.now ?? 0,
    still: Boolean(opts.reduceMotion) || opts.now == null,
    P: ([x, y]) => [f.x + x * f.w, f.y + y * f.h],
    placed: [], // rects already taken (UI, markers, panel, labels), for collision avoidance
    texts: new Set(), // identical labels are drawn once (e.g. three "Leg = 65.3 N")
  };

  // Only what's on screen: a spot the tracker has followed out of view is left out entirely
  // (shape, label and gestures), instead of a label lingering at the screen edge.
  const items = scene.items.filter((i) => i.type === 'panel' || onScreen(env, i));

  const inset = Math.max(0, opts.bottomInset || 0);
  if (inset) env.placed.push({ l: 0, t: h - inset, r: w, b: h });
  const tr = opts.topRight;
  if (tr?.w && tr?.h) env.placed.push({ l: w - tr.w, t: 0, r: w, b: tr.h });

  // Lines, arrows and circles first, then point/step markers on top, so a marker's number is
  // never hidden under an arrow that starts on it (array order otherwise).
  const isMarker = (i) => i.type === 'point' || i.type === 'step';
  const shape = (item) => {
    ctx.globalAlpha = item.stale ? 0.4 : 1;
    SHAPES[item.type]?.(env, item);
  };
  for (const item of items) if (!isMarker(item)) shape(item);
  for (const item of items) if (isMarker(item)) shape(item);
  ctx.globalAlpha = 1;
  env.shapeBoxes = items
    .filter((i) => i.from && i.to)
    .map((i) => {
      const [a, b] = [env.P(i.from), env.P(i.to)];
      const pad = 8 * s;
      return { l: Math.min(a[0], b[0]) - pad, t: Math.min(a[1], b[1]) - pad, r: Math.max(a[0], b[0]) + pad, b: Math.max(a[1], b[1]) + pad };
    });
  // Markers are obstacles for labels.
  for (const item of items) {
    if (item.type === 'circle' || item.type === 'rotate') {
      const [x, y] = env.P(item.at);
      const r = item.r * env.fw;
      env.placed.push({ l: x - r, t: y - r, r: x + r, b: y + r });
    } else if (item.type === 'step' || item.type === 'point') {
      const [x, y] = env.P(item.at);
      const r = (item.type === 'step' ? 17 : 8) * s;
      env.placed.push({ l: x - r, t: y - r, r: x + r, b: y + r });
    }
  }
  // Panels first (largest), then labels around them.
  for (const item of items) if (item.type === 'panel') drawPanel(env, item);
  for (const item of items) {
    // Stale = the tracker isn't sure where this is now: keep a faint shape, but no label claiming it.
    if (item.type === 'panel' || item.stale) continue;
    LABELS[item.type]?.(env, item);
  }
  ctx.globalAlpha = 1;
  // Last, so the AI's pointing is never hidden under a panel or label.
  if (opts.gestures?.size) drawGestures(env, items, opts);
}

function onScreen(env, item) {
  const inView = (p) => {
    if (!Array.isArray(p)) return false;
    const [x, y] = env.P(p);
    return x >= 0 && x <= env.w && y >= 0 && y <= env.h;
  };
  return item.at ? inView(item.at) : inView(item.from) || inView(item.to);
}

// ---------- gestures (the AI "pointing" while it talks) ----------
// Calm motion only: a slowly breathing halo, or a dot gliding along an arrow. No flashing.

function anchorOf(env, item) {
  if (item.at) return env.P(item.at);
  if (item.from && item.to) {
    const a = env.P(item.from);
    const b = env.P(item.to);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  return null;
}

function drawGestures(env, items, opts) {
  const { ctx, s } = env;
  const now = opts.now ?? 0;
  for (const [target, g] of opts.gestures) {
    if (!(g.until > now)) continue;
    const item = items.find((i) => i.id === target || Object.values(i.refs || {}).includes(target));
    const point = !item && (opts.points || []).find((p) => p.id === target);
    const at = item ? anchorOf(env, item) : point ? env.P(point.at) : null;
    if (!at) continue;
    const t = (now - (g.start ?? now)) / 1000;
    const breathe = opts.reduceMotion ? 0 : Math.sin(t * Math.PI * 1.6); // ~0.8 Hz
    const base = item?.r ? Math.max(10 * s, item.r * env.fw) + 10 * s : 24 * s;

    if (g.type === 'trace' && item?.from && item?.to && !opts.reduceMotion) {
      const a = env.P(item.from);
      const b = env.P(item.to);
      const k = (t % 1.4) / 1.4;
      circle(env, [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], 9 * s, '#ffffff');
      continue;
    }
    if (g.type === 'point') {
      // A white arrow that taps the spot from the upper left (a ring reads as "highlight", not "here").
      const bob = opts.reduceMotion ? 0 : 6 * s * Math.max(0, Math.sin(t * Math.PI * 2));
      const off = (item?.r ? Math.max(10 * s, item.r * env.fw) : 6 * s) * 0.7 + bob;
      const tip = [at[0] - off, at[1] - off];
      const tail = [tip[0] - 60 * s, tip[1] - 60 * s];
      SHAPES.arrow(env, { from: tail, to: tip, color: '#ffffff', px: true });
      continue;
    }
    const r = base + (g.type === 'pulse' ? 6 : 4) * s * breathe;
    for (const [color, width] of [[OUTLINE, 7 * s], ['#ffffff', 3.5 * s]]) {
      ctx.beginPath();
      ctx.arc(at[0], at[1], r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
}

// ---------- shapes ----------

const SHAPES = {
  line(env, it) {
    strokeLine(env, env.P(it.from), env.P(it.to), it.color, 3.5 * env.s);
  },
  arrow(env, it) {
    const { s } = env;
    const a = it.px ? it.from : env.P(it.from);
    const b = it.px ? it.to : env.P(it.to);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) return;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const head = Math.min(18 * s, len * 0.5);
    strokeLine(env, a, [b[0] - ux * head * 0.8, b[1] - uy * head * 0.8], it.color, 5 * s);
    const hw = head * 0.6;
    const base = [b[0] - ux * head, b[1] - uy * head];
    fillPath(env, [b, [base[0] - uy * hw, base[1] + ux * hw], [base[0] + uy * hw, base[1] - ux * hw]], it.color);
  },
  point(env, it) {
    circle(env, env.P(it.at), 8 * env.s, it.color);
  },
  circle(env, it) {
    const { ctx, s } = env;
    const [x, y] = env.P(it.at);
    const r = Math.max(10 * s, it.r * env.fw);
    for (const [color, width] of [[OUTLINE, 7 * s], [it.color, 4 * s]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  },
  // Curved arrow (3/4 turn) around a spot for twisting / turning. Spins slowly so the direction
  // is obvious; still when reduced motion is on.
  rotate(env, it) {
    const { ctx, s } = env;
    const [x, y] = env.P(it.at);
    const r = Math.max(14 * s, it.r * env.fw);
    const ccw = it.dir === 'ccw';
    const sign = ccw ? -1 : 1;
    const spin = env.still ? -Math.PI / 2 : ((env.now / 2400) % 1) * Math.PI * 2 * sign;
    const a0 = spin;
    const a1 = spin + sign * Math.PI * 1.5;
    for (const [color, width] of [[OUTLINE, 8 * s], [it.color, 4.5 * s]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1, ccw);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    const tip = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
    const t = a1 + sign * (Math.PI / 2); // direction of travel at the end of the arc
    const head = 14 * s;
    const pts = [
      [tip[0] + head * Math.cos(t), tip[1] + head * Math.sin(t)],
      [tip[0] + head * 0.7 * Math.cos(t + 2.2), tip[1] + head * 0.7 * Math.sin(t + 2.2)],
      [tip[0] + head * 0.7 * Math.cos(t - 2.2), tip[1] + head * 0.7 * Math.sin(t - 2.2)],
    ];
    fillPath(env, pts, it.color);
  },
  step(env, it) {
    const { ctx, s } = env;
    const [x, y] = env.P(it.at);
    circle(env, [x, y], 17 * s, it.color);
    ctx.fillStyle = '#000';
    ctx.font = `700 ${19 * s}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(it.n), x, y + 1 * s);
  },
};

// ---------- labels: candidate positions, first free one wins ----------
// Each candidate is [anchorX, anchorY, align] where align is 'left' | 'right' | 'center'
// (which edge of the pill sits at anchorX). Vertically the pill is centered on anchorY.

const LABELS = {
  circle(env, it) {
    if (!it.text) return;
    const [x, y] = env.P(it.at);
    const r = Math.max(10 * env.s, it.r * env.fw);
    const g = r + 8 * env.s;
    placePill(env, it.text, it.color, [
      [x + g, y, 'left'],
      [x - g, y, 'right'],
      [x, y - g - 6 * env.s, 'center'],
      [x, y + g + 6 * env.s, 'center'],
    ]);
  },
  point(env, it) {
    if (!it.text) return;
    const [x, y] = env.P(it.at);
    const g = 14 * env.s;
    placePill(env, it.text, it.color, [
      [x + g, y, 'left'],
      [x - g, y, 'right'],
      [x, y - 24 * env.s, 'center'],
      [x, y + 24 * env.s, 'center'],
      [x + g, y - 30 * env.s, 'left'],
      [x + g, y + 30 * env.s, 'left'],
    ]);
  },
  label(env, it) {
    const [x, y] = env.P(it.at);
    const d = 28 * env.s;
    placePill(env, it.text, it.color, [
      [x, y, 'center'],
      [x, y - d, 'center'],
      [x, y + d, 'center'],
      [x, y - 2 * d, 'center'],
      [x, y + 2 * d, 'center'],
    ]);
  },
  step(env, it) {
    const [x, y] = env.P(it.at);
    const g = 22 * env.s;
    const d = 32 * env.s;
    // The full instruction is always in the caption's step list, so skip it if nothing fits.
    placePill(
      env,
      it.text,
      '#ffffff',
      [
        [x, y + d, 'center'],
        [x, y - d, 'center'],
        [x + g, y, 'left'],
        [x - g, y, 'right'],
      ],
      { skipIfNoRoom: true },
    );
  },
  line: lineLabel,
  arrow: lineLabel,
};
LABELS.rotate = (env, it) => LABELS.circle(env, { ...it, r: Math.max(14 * env.s, it.r * env.fw) / env.fw });

function lineLabel(env, it) {
  if (!it.text) return;
  const a = env.P(it.from);
  const b = env.P(it.to);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const off = 20 * env.s;
  const vertical = Math.abs(nx) > Math.abs(ny);
  const cands = [];
  for (const [t, k] of [[0.5, 1], [0.25, 1], [0.75, 1], [0.5, 2.4], [0.25, 2.4], [0.75, 2.4]]) {
    const mx = a[0] + (b[0] - a[0]) * t;
    const my = a[1] + (b[1] - a[1]) * t;
    if (vertical) {
      cands.push([mx + off * k, my, 'left'], [mx - off * k, my, 'right']);
    } else {
      cands.push([mx, my - off * k, 'center'], [mx, my + off * k, 'center']);
    }
  }
  placePill(env, it.text, it.color, cands);
}

function placePill(env, text, color, candidates, { skipIfNoRoom = false } = {}) {
  const { ctx, s } = env;
  if (env.texts.has(text)) return;
  ctx.font = `600 ${15 * s}px ${FONT}`;
  const pad = 7 * s;
  const bw = ctx.measureText(text).width + pad * 2;
  const bh = 26 * s;

  const rects = candidates.map(([x, y, align]) => {
    const left = align === 'center' ? x - bw / 2 : align === 'right' ? x - bw : x;
    return clampRect(env, { l: left, t: y - bh / 2, r: left + bw, b: y + bh / 2 });
  });
  const { rect, cost } = leastOverlap(env, rects);
  if (cost > 0 && skipIfNoRoom) return;
  env.placed.push(rect);
  env.texts.add(text);

  roundRect(ctx, rect.l, rect.t, bw, bh, 8 * s);
  ctx.fillStyle = PILL_BG;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rect.l + pad, rect.t + bh / 2 + 1);
}

function clampRect(env, r) {
  const m = 4;
  const w = r.r - r.l;
  const h = r.b - r.t;
  const l = Math.min(Math.max(m, r.l), env.w - w - m);
  const t = Math.min(Math.max(m, r.t), env.h - h - m);
  return { l, t, r: l + w, b: t + h };
}

// Overlap area between two rects (with a small gap so pills don't touch).
function overlapArea(a, b) {
  const g = 3;
  const x = Math.min(a.r, b.r + g) - Math.max(a.l, b.l - g);
  const y = Math.min(a.b, b.b + g) - Math.max(a.t, b.t - g);
  return x > 0 && y > 0 ? x * y : 0;
}

// First candidate with no overlap; otherwise the one that overlaps least.
function leastOverlap(env, rects) {
  let best = { rect: rects[0], cost: Infinity };
  for (const rect of rects) {
    const cost = env.placed.reduce((sum, p) => sum + overlapArea(rect, p), 0);
    if (cost === 0) return { rect, cost };
    if (cost < best.cost) best = { rect, cost };
  }
  return best;
}

// ---------- panel ----------
// Compact on purpose: title + worked math only. The explanation and assumptions are shown as
// real text in the caption area, so the panel covers as little of the object as possible.
// `at` is the top-left corner; the panel is shifted to stay on screen and above the UI.

function drawPanel(env, it) {
  const { ctx, w, s } = env;
  const pad = 10 * s;
  const titleFont = `700 ${14.5 * s}px ${FONT}`;
  const lineFont = `600 ${13 * s}px ${FONT}`;
  const maxInner = Math.min(270 * s, w - 16 - pad * 2);

  const rows = [];
  const add = (font, color, text, gap) => {
    ctx.font = font;
    wrap(ctx, text, maxInner).forEach((t, i) => rows.push({ text: t, font, color, gap: i === 0 ? gap : 0 }));
  };
  if (it.title) add(titleFont, '#ffffff', it.title, 0);
  // Non-physics panels have no math, so their text is the content.
  // Calc panels: the checked lines (✓ yellow, ⚠ orange). Other panels: their text.
  const body = it.lines.length ? it.lines : it.isCalc ? [] : [it.body];
  const lineColor = (l) => (!it.lines.length ? '#e5e5ea' : l.includes('⚠') ? '#ff9f0a' : '#ffcc00');
  body.forEach((l, i) => add(lineFont, lineColor(l), l, i === 0 && it.title ? 4 * s : 0));
  if (!rows.length) return;

  const inner = Math.max(
    ...rows.map((r) => {
      ctx.font = r.font;
      return ctx.measureText(r.text).width;
    }),
  );
  const lineH = 18 * s;
  const bw = inner + pad * 2;
  const bh = pad * 2 + rows.reduce((sum, r) => sum + lineH + r.gap, 0);
  const [ax, ay] = env.P(it.at);
  // Gemini's spot first; otherwise a grid of left/right × top-to-bottom positions.
  const spots = [[ax, ay]];
  for (const t of [8, 0.25, 0.4, 0.55, 0.7].map((f) => (f > 1 ? f : f * env.h))) {
    spots.push([w - bw - 8, t], [8, t]);
  }
  const rects = spots.map(([l, t]) => clampRect(env, { l, t, r: l + bw, b: t + bh }));
  const shapes = env.shapeBoxes || [];
  const { rect } = leastOverlap({ placed: [...env.placed, ...shapes] }, rects);
  env.placed.push(rect);

  roundRect(ctx, rect.l, rect.t, bw, bh, 12 * s);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = rect.t + pad;
  for (const r of rows) {
    y += r.gap;
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, rect.l + pad, y + 2 * s);
    y += lineH;
  }
}

// ---------- primitives ----------

function strokeLine({ ctx }, a, b, color, width) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function fillPath({ ctx }, pts, color) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

function circle({ ctx }, [x, y], r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}
