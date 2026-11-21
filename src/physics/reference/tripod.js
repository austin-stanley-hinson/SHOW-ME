// Josh's hand model of an object on a tripod stand: an independent reference
// for checking the formulas Gemini writes. Plain math, no rounding, no shared code with calc.js.
//
// Free-body diagram (front view, weakest direction):
//   - Total weight W = (m_object + m_stand) * g acts down through the pole.
//   - Feet are 120° apart at radius r. The closest tipping edge (line between two feet)
//     is r * cos(60°) = r / 2 from the pole.
//   - A sideways push F at height h tips it when F * h = W * (r / 2)  (moments about that edge).
//   - Leaning the whole thing, it falls when the center of mass (height h_cm) passes over
//     that edge: tan(theta) = (r / 2) / h_cm.
//   - Symmetric load: each leg carries W / 3.

export function tripodReference({ mass_kg, stand_mass_kg, leg_radius_m, com_height_m, push_height_m }) {
  const g = 9.81;
  const W = (mass_kg + stand_mass_kg) * g;
  const e = leg_radius_m / 2;
  return {
    weight_N: W,
    leg_load_N: W / 3,
    tip_force_N: (W * e) / push_height_m,
    tip_angle_deg: (Math.atan(e / com_height_m) * 180) / Math.PI,
  };
}
