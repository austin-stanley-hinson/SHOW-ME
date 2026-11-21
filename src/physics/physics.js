// Physics for "Show Me". Gemini estimates inputs; this file computes every derived number.
// See CONTRACT.md -> "Physics".

const G = 9.81; // m/s^2

// Each model: required inputs, and a function that returns derived quantities.
const MODELS = {
  wall_mount: {
    inputs: ['mass_kg', 'lever_arm_m', 'bolt_spacing_m', 'bolt_count'],
    // Each step uses the previous step's ROUNDED value, so every printed line checks out on a calculator.
    compute({ mass_kg, lever_arm_m, bolt_spacing_m, bolt_count }) {
      const weight = round3(mass_kg * G);
      const moment = round3(weight * lever_arm_m);
      const top_bolt_tension = round3(moment / bolt_spacing_m);
      return {
        weight: { value: weight, unit: 'N', name: 'Weight' },
        shear_per_bolt: { value: round3(weight / bolt_count), unit: 'N', name: 'Shear per bolt' },
        moment: { value: moment, unit: 'N·m', name: 'Moment' },
        top_bolt_tension: { value: top_bolt_tension, unit: 'N', name: 'Top bolt tension' },
        wall_reaction: { value: top_bolt_tension, unit: 'N', name: 'Wall push' },
      };
    },
    // Worked math lines for the panel (content: "physics").
    lines(i, q) {
      return [
        `Mass ≈ ${fmt(i.mass_kg)} kg (est.) → W = ${fmt(i.mass_kg)} × 9.81 = ${fmt(q.weight.value)} N`,
        `Each bolt holds: ${fmt(q.weight.value)} / ${i.bolt_count} = ${fmt(q.shear_per_bolt.value)} N`,
        `Turning: M = ${fmt(q.weight.value)} × ${fmt(i.lever_arm_m)} = ${fmt(q.moment.value)} N·m`,
        `Top bolt: T = ${fmt(q.moment.value)} / ${fmt(i.bolt_spacing_m)} = ${fmt(q.top_bolt_tension.value)} N  ·  Wall push = ${fmt(q.wall_reaction.value)} N`,
      ];
    },
  },

  // Object on a three-legged stand. Weakest tipping direction is the edge between two feet,
  // which is leg_radius / 2 from the pole (feet 120° apart).
  tripod_stand: {
    inputs: ['mass_kg', 'stand_mass_kg', 'leg_radius_m', 'com_height_m', 'push_height_m'],
    compute({ mass_kg, stand_mass_kg, leg_radius_m, com_height_m, push_height_m }) {
      const weight = round3((mass_kg + stand_mass_kg) * G);
      const tip_margin_m = round3(leg_radius_m / 2);
      const tip_moment = round3(weight * tip_margin_m);
      return {
        weight: { value: weight, unit: 'N', name: 'Weight' },
        leg_load: { value: round3(weight / 3), unit: 'N', name: 'Load per leg' },
        tip_margin_m: { value: tip_margin_m, unit: 'm', name: 'Tip margin' },
        tip_moment: { value: tip_moment, unit: 'N·m', name: 'Moment to tip' },
        tip_force: { value: round3(tip_moment / push_height_m), unit: 'N', name: 'Push to tip' },
        tip_angle_deg: {
          value: round3((Math.atan(tip_margin_m / com_height_m) * 180) / Math.PI),
          unit: '°',
          name: 'Lean limit',
        },
      };
    },
    lines(i, q) {
      const total = round3(i.mass_kg + i.stand_mass_kg);
      return [
        `Mass ≈ ${fmt(i.mass_kg)} + ${fmt(i.stand_mass_kg)} = ${fmt(total)} kg (est.) → W = ${fmt(total)} × 9.81 = ${fmt(q.weight.value)} N`,
        `Each leg: ${fmt(q.weight.value)} / 3 = ${fmt(q.leg_load.value)} N`,
        `Tip edge: e = ${fmt(i.leg_radius_m)} / 2 = ${fmt(q.tip_margin_m.value)} m from the pole`,
        `To tip it: M = ${fmt(q.weight.value)} × ${fmt(q.tip_margin_m.value)} = ${fmt(q.tip_moment.value)} N·m`,
        `Push at the top: F = ${fmt(q.tip_moment.value)} / ${fmt(i.push_height_m)} = ${fmt(q.tip_force.value)} N`,
        `Lean limit: tan θ = ${fmt(q.tip_margin_m.value)} / ${fmt(i.com_height_m)} → θ = ${fmt(q.tip_angle_deg.value)}°`,
      ];
    },
  },
};

const INPUT_INFO = {
  mass_kg: { unit: 'kg', name: 'Mass' },
  lever_arm_m: { unit: 'm', name: 'Lever arm' },
  bolt_spacing_m: { unit: 'm', name: 'Bolt spacing' },
  bolt_count: { unit: '', name: 'Bolts' },
  stand_mass_kg: { unit: 'kg', name: 'Stand mass' },
  leg_radius_m: { unit: 'm', name: 'Leg spread' },
  com_height_m: { unit: 'm', name: 'Center of mass height' },
  push_height_m: { unit: 'm', name: 'Push height' },
};

// 3 significant figures, no trailing zeros: 49.05 -> "49.1", 4.905 -> "4.91", 0.1 -> "0.1", 5 -> "5".
export function fmt(n) {
  return String(round3(n));
}

function round3(n) {
  return Number(n.toPrecision(3));
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
  const unit = !q.unit ? '' : q.unit === '°' ? '°' : ` ${q.unit}`;
  return q.estimated ? `${name} ≈ ${fmt(q.value)}${unit} (est.)` : `${name} = ${fmt(q.value)}${unit}`;
}
