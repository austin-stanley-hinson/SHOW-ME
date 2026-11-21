// Physics for "Show Me". Gemini estimates inputs; this file computes every derived number.
// See CONTRACT.md -> "Physics".

const G = 9.81; // m/s^2

// Each model: required inputs, and a function that returns derived quantities.
const MODELS = {
  wall_mount: {
    inputs: ['mass_kg', 'lever_arm_m', 'bolt_spacing_m', 'bolt_count'],
    compute({ mass_kg, lever_arm_m, bolt_spacing_m, bolt_count }) {
      const weight = mass_kg * G;
      const moment = weight * lever_arm_m;
      const top_bolt_tension = moment / bolt_spacing_m;
      return {
        weight: { value: weight, unit: 'N', name: 'Weight' },
        shear_per_bolt: { value: weight / bolt_count, unit: 'N', name: 'Shear per bolt' },
        moment: { value: moment, unit: 'N·m', name: 'Moment' },
        top_bolt_tension: { value: top_bolt_tension, unit: 'N', name: 'Top bolt tension' },
        wall_reaction: { value: top_bolt_tension, unit: 'N', name: 'Wall push' },
      };
    },
    // Worked math lines for the panel (content: "physics").
    lines(i, q) {
      return [
        `Mass ≈ ${fmt(i.mass_kg)} kg (est.) → W = ${fmt(i.mass_kg)} × 9.81 = ${fmt(q.weight.value)} N`,
        `Up: ${i.bolt_count} bolts × ${fmt(q.shear_per_bolt.value)} N = ${fmt(q.weight.value)} N ✓`,
        `Turning: M = ${fmt(q.weight.value)} × ${fmt(i.lever_arm_m)} = ${fmt(q.moment.value)} N·m`,
        `Top bolt: T = ${fmt(q.moment.value)} / ${fmt(i.bolt_spacing_m)} = ${fmt(q.top_bolt_tension.value)} N  ·  Wall push = ${fmt(q.wall_reaction.value)} N`,
      ];
    },
  },
};

const INPUT_INFO = {
  mass_kg: { unit: 'kg', name: 'Mass' },
  lever_arm_m: { unit: 'm', name: 'Lever arm' },
  bolt_spacing_m: { unit: 'm', name: 'Bolt spacing' },
  bolt_count: { unit: '', name: 'Bolts' },
};

// 3 significant figures, no trailing zeros: 49.05 -> "49.1", 4.905 -> "4.91", 0.1 -> "0.1", 5 -> "5".
export function fmt(n) {
  return String(Number(n.toPrecision(3)));
}

// physics: the "physics" object from Gemini (or null).
// Returns { ok, quantities, lines, assumptions }. Never throws.
export function computePhysics(physics) {
  const assumptions = Array.isArray(physics?.assumptions) ? physics.assumptions : [];
  const fail = { ok: false, quantities: {}, lines: [], assumptions };
  const model = MODELS[physics?.model];
  if (!model) return fail;

  const i = physics.inputs || {};
  for (const key of model.inputs) {
    if (typeof i[key] !== 'number' || !(i[key] > 0)) return fail;
  }

  const quantities = model.compute(i);
  for (const key of model.inputs) {
    quantities[key] = { value: i[key], ...INPUT_INFO[key], estimated: true };
  }
  return { ok: true, quantities, lines: model.lines(i, quantities), assumptions };
}

// Text for a draw item's label, per CONTRACT.md "How quantity is displayed".
export function formatLabel(label, quantityKey, result) {
  const q = quantityKey && result?.ok ? result.quantities[quantityKey] : null;
  if (!q) return label || '';
  const name = label || q.name;
  const unit = q.unit ? ` ${q.unit}` : '';
  return q.estimated ? `${name} ≈ ${fmt(q.value)}${unit} (est.)` : `${name} = ${fmt(q.value)}${unit}`;
}
