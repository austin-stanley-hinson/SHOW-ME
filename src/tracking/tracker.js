// Keeps drawings stuck to the scene as the phone moves (lane B). Pure JS, no dependencies, no DOM in the core.
//
// Each grayscale frame (~320 px wide) is compared with the previous one: ~60 well-textured spots are
// followed with pyramidal Lucas-Kanade optical flow, and a similarity transform (shift + zoom + rotation)
// is fitted robustly. Transforms are chained into C_t: reference view -> frame t. Drawings are stored in
// reference coordinates, so an item placed on an older frame s (e.g. the frame Gemini saw ~1 s ago) is
//   ref = C_s^-1(p)        and drawn at   C_now(ref).
//
//   const tr = createTracker();
//   const id = tr.push(gray, w, h);        // every frame; returns a frame id
//   const ref = tr.toRef([x, y], id);      // contract [x, y] 0-1 on frame `id` -> reference coords
//   const now = tr.fromRef(ref);           // -> where it is in the newest frame (0-1), or null if lost
//   tr.quality                             // 0-1 share of spots that agreed; tr.lost after a bad stretch

const MAX_FEATURES = 60;
const GRID = [8, 6];
const WIN = 7; // half window -> 15x15
const LEVELS = 3;
const ITERS = 8;
const RING = 90; // frames of history (~6 s at 15 fps)

// ---------- image pyramid ----------
function downsample(img, w, h) {
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * w2 + x] = (img[i] + img[i + 1] + img[i + w] + img[i + w + 1]) * 0.25;
    }
  }
  return { img: out, w: w2, h: h2 };
}
function pyramid(gray, w, h) {
  const levels = [{ img: Float32Array.from(gray), w, h }];
  for (let l = 1; l < LEVELS; l++) levels.push(downsample(levels[l - 1].img, levels[l - 1].w, levels[l - 1].h));
  return levels;
}
// Bilinear sample, clamped to the border (coarse pyramid levels are small, so windows often touch the edge).
function sample(L, x, y) {
  x = Math.min(Math.max(x, 0), L.w - 1.001);
  y = Math.min(Math.max(y, 0), L.h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0, i = y0 * L.w + x0, im = L.img;
  return (im[i] * (1 - fx) + im[i + 1] * fx) * (1 - fy) + (im[i + L.w] * (1 - fx) + im[i + L.w + 1] * fx) * fy;
}

// ---------- features: best "min eigenvalue" corner in each grid cell ----------
// Best corner in a box [x0, x1) x [y0, y1); returns [x, y, score] or null.
function bestCorner(L, x0, x1, y0, y1) {
  const { img, w, h } = L;
  let best = 0, bx = -1, by = -1;
  for (let y = Math.max(WIN + 1, y0); y < Math.min(h - WIN - 1, y1); y += 2) {
    for (let x = Math.max(WIN + 1, x0); x < Math.min(w - WIN - 1, x1); x += 2) {
      let sxx = 0, syy = 0, sxy = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const i = (y + dy) * w + x + dx;
          const ix = img[i + 1] - img[i - 1], iy = img[i + w] - img[i - w];
          sxx += ix * ix; syy += iy * iy; sxy += ix * iy;
        }
      }
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const minEig = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      if (minEig > best) (best = minEig), (bx = x), (by = y);
    }
  }
  return bx >= 0 && best > 50 ? [bx, by, best] : null;
}

// Extra features around each anchor (pixel positions): a 4x4 grid of cells in a box around it, so the
// object being annotated has its own spots to follow (not just the background).
export function featuresNear(L, centers, half, max = 64) {
  const out = [];
  // Many anchors sit close together (one object): spread the budget, nearest-first per anchor.
  const per = Math.max(4, Math.floor(max / Math.max(1, centers.length)));
  const step = (2 * half) / 4;
  for (const [cx, cy] of centers) {
    const mine = [];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const x0 = Math.round(cx - half + i * step), y0 = Math.round(cy - half + j * step);
        const c = bestCorner(L, x0, Math.round(x0 + step), y0, Math.round(y0 + step));
        if (c) mine.push([c[0], c[1], Math.hypot(c[0] - cx, c[1] - cy)]);
      }
    }
    mine.sort((p, q) => p[2] - q[2]);
    for (const p of mine.slice(0, per)) out.push([p[0], p[1]]);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

export function findFeatures(L, max = MAX_FEATURES) {
  const { img, w, h } = L;
  const [gx, gy] = GRID;
  const cw = Math.floor(w / gx), ch = Math.floor(h / gy);
  const pts = [];
  for (let cy = 0; cy < gy; cy++) {
    for (let cx = 0; cx < gx; cx++) {
      let best = 0, bx = -1, by = -1;
      for (let y = Math.max(WIN + 1, cy * ch); y < Math.min(h - WIN - 1, (cy + 1) * ch); y += 2) {
        for (let x = Math.max(WIN + 1, cx * cw); x < Math.min(w - WIN - 1, (cx + 1) * cw); x += 2) {
          let sxx = 0, syy = 0, sxy = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const i = (y + dy) * w + x + dx;
              const ix = img[i + 1] - img[i - 1], iy = img[i + w] - img[i - w];
              sxx += ix * ix; syy += iy * iy; sxy += ix * iy;
            }
          }
          const tr = sxx + syy, det = sxx * syy - sxy * sxy;
          const minEig = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
          if (minEig > best) (best = minEig), (bx = x), (by = y);
        }
      }
      if (bx >= 0 && best > 50) pts.push([bx, by, best]);
    }
  }
  return pts.sort((a, b) => b[2] - a[2]).slice(0, max).map(([x, y]) => [x, y]);
}

// ---------- pyramidal Lucas-Kanade for one point ----------
function trackPoint(P, Q, x, y) {
  let gx = 0, gy = 0; // displacement guess at the current level (in that level's pixels)
  for (let l = LEVELS - 1; l >= 0; l--) {
    const A = P[l], B = Q[l], s = 1 / (1 << l);
    const px = x * s, py = y * s;
    let sxx = 0, syy = 0, sxy = 0;
    const ixs = [], iys = [], vals = [];
    for (let dy = -WIN; dy <= WIN; dy++) {
      for (let dx = -WIN; dx <= WIN; dx++) {
        const v = sample(A, px + dx, py + dy);
        const ix = (sample(A, px + dx + 1, py + dy) - sample(A, px + dx - 1, py + dy)) / 2;
        const iy = (sample(A, px + dx, py + dy + 1) - sample(A, px + dx, py + dy - 1)) / 2;
        if (!Number.isFinite(v + ix + iy)) return null;
        ixs.push(ix); iys.push(iy); vals.push(v);
        sxx += ix * ix; syy += iy * iy; sxy += ix * iy;
      }
    }
    const det = sxx * syy - sxy * sxy;
    if (det < 1e-3) return null;
    for (let it = 0; it < ITERS; it++) {
      let bx = 0, by = 0, k = 0;
      for (let dy = -WIN; dy <= WIN; dy++) {
        for (let dx = -WIN; dx <= WIN; dx++, k++) {
          const diff = vals[k] - sample(B, px + gx + dx, py + gy + dy);
          if (!Number.isFinite(diff)) return null;
          bx += diff * ixs[k]; by += diff * iys[k];
        }
      }
      const ux = (syy * bx - sxy * by) / det, uy = (sxx * by - sxy * bx) / det;
      gx += ux; gy += uy;
      if (ux * ux + uy * uy < 0.0009) break;
    }
    if (l > 0) (gx *= 2), (gy *= 2);
  }
  return [x + gx, y + gy];
}

// ---------- similarity transform: q = s*R*p + t, as {a, b, tx, ty} with [a -b; b a] ----------
export const IDENTITY = { a: 1, b: 0, tx: 0, ty: 0 };
export const apply = (T, [x, y]) => [T.a * x - T.b * y + T.tx, T.b * x + T.a * y + T.ty];
export const compose = (T2, T1) => ({ a: T2.a * T1.a - T2.b * T1.b, b: T2.a * T1.b + T2.b * T1.a, tx: T2.a * T1.tx - T2.b * T1.ty + T2.tx, ty: T2.b * T1.tx + T2.a * T1.ty + T2.ty });
export function invert(T) {
  const d = T.a * T.a + T.b * T.b;
  const a = T.a / d, b = -T.b / d;
  return { a, b, tx: -(a * T.tx - b * T.ty), ty: -(b * T.tx + a * T.ty) };
}
function fitSimilarity(P, Q) {
  const n = P.length;
  let mpx = 0, mpy = 0, mqx = 0, mqy = 0;
  for (let i = 0; i < n; i++) (mpx += P[i][0]), (mpy += P[i][1]), (mqx += Q[i][0]), (mqy += Q[i][1]);
  mpx /= n; mpy /= n; mqx /= n; mqy /= n;
  let sxx = 0, sxy = 0, spp = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i][0] - mpx, py = P[i][1] - mpy, qx = Q[i][0] - mqx, qy = Q[i][1] - mqy;
    sxx += px * qx + py * qy;
    sxy += px * qy - py * qx;
    spp += px * px + py * py;
  }
  if (spp < 1e-9) return null;
  const a = sxx / spp, b = sxy / spp;
  return { a, b, tx: mqx - (a * mpx - b * mpy), ty: mqy - (b * mpx + a * mpy) };
}
// Fit, drop points far from the fit, refit. Returns { T, inliers }.
export function robustSimilarity(P, Q) {
  let idx = P.map((_, i) => i);
  let T = null;
  for (let round = 0; round < 3 && idx.length >= 4; round++) {
    T = fitSimilarity(idx.map((i) => P[i]), idx.map((i) => Q[i]));
    if (!T) return null;
    const res = idx.map((i) => {
      const [x, y] = apply(T, P[i]);
      return Math.hypot(x - Q[i][0], y - Q[i][1]);
    });
    const sorted = [...res].sort((a, b) => a - b);
    const cut = Math.max(1.5, 2.5 * sorted[Math.floor(sorted.length / 2)]);
    idx = idx.filter((_, k) => res[k] <= cut);
  }
  return T && idx.length >= 4 ? { T, inliers: idx.length } : null;
}

// ---------- the tracker ----------
// Move a pixel position one frame using the feature pairs near it (local motion), else the global fit.
function stepLocal(pos, pairs, globalT, radius) {
  const P = [], Q = [];
  for (let i = 0; i < pairs.P.length; i++) {
    const p = pairs.P[i];
    if (Math.hypot(p[0] - pos[0], p[1] - pos[1]) <= radius) (P.push(p), Q.push(pairs.Q[i]));
  }
  if (P.length >= 6) {
    const fit = robustSimilarity(P, Q);
    if (fit && fit.inliers >= 5) return { pos: apply(fit.T, pos), local: true };
  }
  return { pos: globalT ? apply(globalT, pos) : pos, local: false };
}

export function createTracker() {
  let prev = null; // { pyr, w, h, feats }
  const anchors = new Set(); // { pos: [px, py], weak }
  const LOCAL_RADIUS = 0.2; // of frame width
  const NEAR_HALF = 0.1; // half-size of the box of extra features around each anchor (of width)
  let pairs = null; // feature pairs from the previous frame to this one
  let C = IDENTITY; // reference (pixel coords of the first frame) -> current frame pixels
  let nextId = 0;
  const ring = new Map(); // id -> { C, w, h }
  let quality = 1;
  let bad = 0;
  let lost = false;
  let size = null;

  function reset() {
    C = IDENTITY;
    ring.clear();
    anchors.clear();
    bad = 0;
    lost = false;
  }

  return {
    // gray: Uint8Array/Uint8ClampedArray/Float32Array luminance, w*h. Returns a frame id.
    push(gray, w, h) {
      if (!size || size.w !== w || size.h !== h) {
        size = { w, h };
        prev = null;
        reset();
      }
      const pyr = pyramid(gray, w, h);
      if (prev) {
        const P = [], Q = [];
        for (const [x, y] of prev.feats) {
          const q = trackPoint(prev.pyr, pyr, x, y);
          if (q && q[0] > 2 && q[1] > 2 && q[0] < w - 3 && q[1] < h - 3) (P.push([x, y]), Q.push(q));
        }
        const fit = P.length >= 6 ? robustSimilarity(P, Q) : null;
        quality = fit ? fit.inliers / Math.max(1, prev.feats.length) : 0;
        // A close object moving against the background lowers global agreement, so accept less here;
        // anchors use their own local fits anyway.
        const ok = fit && quality > 0.15;
        if (ok) {
          C = compose(fit.T, C);
          bad = 0;
        } else if (++bad > 8) lost = true; // ~0.5 s of nothing usable
        pairs = { P, Q, T: ok ? fit.T : null };
        for (const a of anchors) {
          const r = stepLocal(a.pos, pairs, pairs.T, LOCAL_RADIUS * w);
          a.pos = r.pos;
          a.weak = r.local ? 0 : a.weak + 1;
        }
      }
      const near = anchors.size ? featuresNear(pyr[0], [...anchors].map((a) => a.pos), NEAR_HALF * w) : [];
      prev = { pyr, w, h, feats: [...findFeatures(pyr[0]), ...near] };
      const id = nextId++;
      ring.set(id, { C, w, h, pairs });
      pairs = null;
      if (ring.size > RING) ring.delete(ring.keys().next().value);
      return id;
    },
    // Contract [x, y] 0-1 on frame `id` -> reference coords (pixels of the reference view).
    toRef([x, y], id) {
      const f = ring.get(id) ?? ring.get(nextId - 1);
      if (!f) return null;
      return apply(invert(f.C), [x * f.w, y * f.h]);
    },
    // Reference coords -> contract [x, y] 0-1 in the newest frame.
    fromRef(ref) {
      if (!ref || lost || !size) return null;
      const [px, py] = apply(C, ref);
      return [px / size.w, py / size.h];
    },
    get latestId() {
      return nextId - 1;
    },
    get quality() {
      return quality;
    },
    get lost() {
      return lost;
    },
    // After losing the scene, start over: items placed before this are no longer valid.
    reset,
    // Local anchors: follow ONE spot using the motion of the features near it, so a close object moves
    // with itself and not with the background. Placed on frame "id" (e.g. the frame Gemini saw), it is
    // replayed through the stored frame-to-frame feature pairs up to now.
    anchor([x, y], id) {
      const f = ring.get(id);
      if (!f || !size) return null;
      let pos = [x * f.w, y * f.h];
      for (let k = id + 1; k < nextId; k++) {
        const fr = ring.get(k);
        if (fr && fr.pairs) pos = stepLocal(pos, fr.pairs, fr.pairs.T, LOCAL_RADIUS * f.w).pos;
      }
      const a = { pos, weak: 0 };
      anchors.add(a);
      return a;
    },
    where(a) {
      if (!a || lost || !size || !anchors.has(a)) return null;
      return [a.pos[0] / size.w, a.pos[1] / size.h];
    },
    release(a) {
      anchors.delete(a);
    },
    // ~1 s without local features: the anchor is only following the background.
    isWeak: (a) => !a || a.weak > 15,
  };
}

// Browser helper: draw the video small and return its luminance.
export function grabGray(video, canvas, width = 320) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return null;
  const w = width, h = Math.round((vh / vw) * width);
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  c.drawImage(video, 0, 0, w, h);
  const rgba = c.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { gray, w, h };
}
