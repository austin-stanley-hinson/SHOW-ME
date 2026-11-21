// Gemini structured-output schema (generationConfig.responseSchema).
// Machine version of CONTRACT.md: any contract change must update this file in the same PR.
// Draw items are one flat object with optional fields (no anyOf); validate.js enforces per-type rules.

const XY = { type: 'ARRAY', items: { type: 'NUMBER' }, minItems: 2, maxItems: 2 };

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    followup_question: { type: 'STRING', nullable: true },
    physics: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        model: { type: 'STRING', enum: ['wall_mount', 'tripod_stand'] },
        inputs: {
          type: 'OBJECT',
          properties: {
            mass_kg: { type: 'NUMBER' },
            lever_arm_m: { type: 'NUMBER' },
            bolt_spacing_m: { type: 'NUMBER' },
            bolt_count: { type: 'INTEGER' },
            stand_mass_kg: { type: 'NUMBER' },
            leg_radius_m: { type: 'NUMBER' },
            com_height_m: { type: 'NUMBER' },
            push_height_m: { type: 'NUMBER' },
          },
        },
        assumptions: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 4 },
      },
      required: ['model', 'inputs', 'assumptions'],
    },
    draw: {
      type: 'ARRAY',
      maxItems: 12,
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['arrow', 'line', 'point', 'label', 'step', 'panel'] },
          id: { type: 'STRING' },
          from: XY,
          to: XY,
          at: XY,
          n: { type: 'INTEGER' },
          label: { type: 'STRING' },
          quantity: {
            type: 'STRING',
            enum: ['weight', 'shear_per_bolt', 'moment', 'top_bolt_tension', 'wall_reaction', 'mass_kg', 'lever_arm_m', 'bolt_spacing_m', 'bolt_count',
              'leg_load', 'tip_margin_m', 'tip_moment', 'tip_force', 'tip_angle_deg',
              'stand_mass_kg', 'leg_radius_m', 'com_height_m', 'push_height_m'],
          },
          color: { type: 'STRING' },
          text: { type: 'STRING' },
          content: { type: 'STRING', enum: ['physics'] },
        },
        required: ['type', 'id'],
      },
    },
  },
  required: ['answer', 'followup_question', 'physics', 'draw'],
  propertyOrdering: ['answer', 'followup_question', 'physics', 'draw'],
};
