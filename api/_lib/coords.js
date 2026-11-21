// Convert a model reply from its native coordinate convention to the contract's [x, y] 0-1.
// Only numeric pairs are converted; point-id strings are left alone. Runs before validate.js.

const POS_FIELDS = ['at', 'from', 'to'];

function convertPair(p, conv) {
  if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number')) return p;
  if (conv === 'yx1000') return [p[1] / 1000, p[0] / 1000];
  return p;
}

export function toContractCoords(data, conv) {
  if (!data || typeof data !== 'object' || conv === 'xy01') return data;
  const out = { ...data };
  if (Array.isArray(data.points)) out.points = data.points.map((pt) => (pt && typeof pt === 'object' ? { ...pt, at: convertPair(pt.at, conv) } : pt));
  if (Array.isArray(data.draw)) {
    out.draw = data.draw.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const copy = { ...item };
      for (const f of POS_FIELDS) if (f in copy) copy[f] = convertPair(copy[f], conv);
      if (conv === 'yx1000' && typeof copy.r === 'number') copy.r = copy.r / 1000;
      return copy;
    });
  }
  return out;
}
