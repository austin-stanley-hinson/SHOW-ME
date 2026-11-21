// Which calc inputs get a "what if" slider, and its range (CONTRACT v3: inputs with
// `adjustable {min, max}` get one; we also let people correct the AI's estimates).
// Pure, so it's tested without React.

const ESTIMATE_RANGE = [0.25, 3]; // an estimate can be dragged from ¼× to 3× the AI's guess

// A round step giving roughly 100 notches across the range (1, 2 or 5 × a power of ten).
export function niceStep(span) {
  if (!(span > 0)) return 1;
  const raw = span / 100;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : 5) * p;
}

// Snap v to a multiple of step. `nudge` absorbs float error (e.g. 99.9999999 notches floors to 100).
const snap = (fn, nudge) => (v, step) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((fn(v / step + nudge) * step).toFixed(decimals));
};
const roundTo = snap(Math.round, 0);
const floorTo = snap(Math.floor, 1e-9);
const ceilTo = snap(Math.ceil, -1e-9);

// sheet: the AI's calc; result: evaluateCalc(sheet, …, overrides). Returns
// [{ name, label, unit, min, max, step, value, original, estimated, changed }], adjustable ones first.
export function sliderSpecs(sheet, result) {
  const out = [];
  for (const inp of Array.isArray(sheet?.inputs) ? sheet.inputs : []) {
    const q = result?.quantities?.[inp?.name];
    if (!q || typeof inp.value !== 'number' || !Number.isFinite(inp.value)) continue;
    const adj = inp.adjustable;
    let min;
    let max;
    if (adj && Number.isFinite(adj.min) && Number.isFinite(adj.max) && adj.max > adj.min) {
      [min, max] = [adj.min, adj.max];
    } else if (inp.est !== false && inp.value > 0) {
      [min, max] = [inp.value * ESTIMATE_RANGE[0], inp.value * ESTIMATE_RANGE[1]];
    } else continue; // a known fact (or a zero/negative estimate): no slider
    const step = niceStep(max - min);
    out.push({
      name: inp.name,
      label: inp.label || inp.name,
      unit: inp.unit || '',
      min: floorTo(min, step), // widen to round numbers, never narrow
      max: ceilTo(max, step),
      step,
      value: q.value,
      original: inp.value,
      estimated: !adj && inp.est !== false,
      changed: Boolean(q.set),
    });
  }
  return out.sort((a, b) => a.estimated - b.estimated);
}

export function formatValue(v, step) {
  return String(roundTo(v, step));
}
