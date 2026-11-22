// Gemini Live session config: the model, instructions and tools. The server bakes this into a one-use
// token (api/live-token.js), so the phone never sees the API key and can't change the setup.

export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

export const LIVE_PROMPT = `You are "Show Me": a friendly expert standing next to the user. You see their live camera (about one frame per second) and hear them. Help with whatever they're looking at: explain it, teach it, guide them through hands-on tasks. Mostly by TALKING, naturally and concisely, like a great teacher who knows the subject. Always answer out loud; never go quiet while you work something out.

You can also draw on their view when it genuinely helps (pointing at a part, showing which way something moves). You don't need to draw for every sentence. When the user asks you to show, point at or draw something, do it right away. Give every drawing a short label, and say what it is as it appears ("this red arrow is the chair's weight").
Force vectors / free-body diagrams: draw an arrow for each force, starting where it acts (anchor "tail"), in its direction, labelled (Weight, Normal force, Your push, Friction...). Use red for weight, green for support forces and blue for applied forces. Add calc if numbers help.
- show: circle, arrow, label, line, rotate (twisting), step (numbered), panel. Positions are [y, x], 0-1000, in the latest frame. Arrows: anchor "tip" to point at a part, "tail" for a motion or force that starts on the part. The app snaps drawings onto the exact part and keeps them there.
- gesture: pulse/point/trace/circle something while you say "this" or "here". remove: take drawings away.

Optional help from the app, use it when it's useful:
- plan(task): starts a careful expert check of how to do a hands-on task. Keep talking while it runs. Checked steps arrive later as an "[app]" note: use them to correct or refine your guidance.
- procedure: keep track of the current step of a multi-step task.
- calc: for physics or engineering numbers, write the formulas and your results; they're checked and you hear what's verified.
- Google Search: for facts about the specific product.

Messages in brackets come from the app, not the user:
- "[auto-check]": the user is working on a step. If it's visibly done, say so briefly and move on; if something's wrong, say what. Otherwise call wait and say nothing.
- "[app] ...": notes from the app (expert steps, phone put down or picked up). Follow them.
- A procedure call that comes back "rejected" means the step isn't done yet: say what you actually see.

A few rules: speak English. Think about the forces: when the user pushes or pulls one part, tell them what to hold so the rest doesn't move. For tools, electricity, heat or heights, give the key safety point first. Don't repeat yourself.`;

const POS = { type: 'ARRAY', items: { type: 'NUMBER' }, description: '[y, x] 0-1000' };
const ITEM = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['arrow', 'line', 'point', 'circle', 'rotate', 'label', 'step', 'panel'] },
    dir: { type: 'STRING', enum: ['cw', 'ccw'], description: 'rotate: clockwise or counterclockwise as seen in the image' },
    id: { type: 'STRING' },
    at: POS,
    from: POS,
    to: POS,
    at_point: { type: 'STRING', description: 'use a named point instead of at' },
    from_point: { type: 'STRING' },
    to_point: { type: 'STRING' },
    r: { type: 'NUMBER', description: 'circle radius, 0-1000 of image width' },
    n: { type: 'INTEGER', description: 'step number' },
    label: { type: 'STRING' },
    text: { type: 'STRING', description: 'panel text' },
    color: { type: 'STRING' },
    quantity: { type: 'STRING', description: 'a calc name; its checked value is appended to the label' },
    content: { type: 'STRING', enum: ['calc'] },
    anchor: { type: 'STRING', enum: ['tip', 'tail'], description: 'arrows: which end touches the real part. tip = pointing at it; tail = a motion or force applied to it (the arrow shows the direction)' },
  },
  required: ['type', 'id'],
};

export const LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'show',
        // Non-blocking and only answered when something was dropped: answering every show made the model
        // continue its turn and say the same sentence again (heard twice, sometimes in another voice).
        behavior: 'NON_BLOCKING',
        description: 'Draw on the live view. Items with an existing id are replaced (moved/changed).',
        parameters: {
          type: 'OBJECT',
          properties: {
            items: { type: 'ARRAY', items: ITEM },
            points: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, at: POS }, required: ['id', 'at'] } },
            clear: { type: 'BOOLEAN', description: 'true = remove everything first' },
          },
        },
      },
      {
        name: 'remove',
        behavior: 'NON_BLOCKING',
        description: 'Take items off the view.',
        parameters: { type: 'OBJECT', properties: { ids: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['ids'] },
      },
      {
        name: 'gesture',
        behavior: 'NON_BLOCKING',
        description: 'Animate an item or point while you talk about it.',
        parameters: {
          type: 'OBJECT',
          properties: { type: { type: 'STRING', enum: ['point', 'pulse', 'trace', 'circle'] }, target: { type: 'STRING' } },
          required: ['type', 'target'],
        },
      },
      {
        name: 'procedure',
        description: 'Track a step-by-step task.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            current: { type: 'INTEGER' },
            total: { type: 'INTEGER' },
            done_when: { type: 'STRING' },
            complete: { type: 'BOOLEAN' },
            safety: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['current'],
        },
      },
      {
        name: 'plan',
        // Non-blocking: the model keeps talking; the checked steps arrive later as an [app] note.
        behavior: 'NON_BLOCKING',
        description: 'Start a careful expert check of how to do a hands-on task with the object in view. Keep talking meanwhile; the checked steps arrive as an [app] note.',
        parameters: { type: 'OBJECT', properties: { task: { type: 'STRING', description: 'e.g. "fold this chair", "refill the stapler"' } }, required: ['task'] },
      },
      {
        name: 'wait',
        // NON_BLOCKING and never answered (see live.js): answering made the model continue and call wait
        // again about once a second. Unanswered, it's one wait per auto-check and silence.
        behavior: 'NON_BLOCKING',
        description: 'Say nothing this turn (used for [auto-check] turns when the step is not done yet and nothing is wrong).',
        parameters: { type: 'OBJECT', properties: { seen: { type: 'STRING', description: 'a few words on what you see, for the log' } } },
      },
      {
        name: 'calc',
        description: 'Submit your calculation for checking. Returns which steps are verified and the checked verdict.',
        parameters: {
          type: 'OBJECT',
          properties: {
            inputs: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  value: { type: 'NUMBER' },
                  unit: { type: 'STRING' },
                  label: { type: 'STRING' },
                  est: { type: 'BOOLEAN' },
                  adjustable: { type: 'OBJECT', properties: { min: { type: 'NUMBER' }, max: { type: 'NUMBER' } } },
                },
                required: ['name', 'value'],
              },
            },
            steps: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  expr: { type: 'STRING', description: 'formula: numbers, earlier names, g, pi, + - * / ^ ( ), sqrt sin cos tan atan deg rad min max abs' },
                  value: { type: 'NUMBER', description: 'your result' },
                  unit: { type: 'STRING' },
                  label: { type: 'STRING' },
                },
                required: ['name', 'expr', 'value'],
              },
            },
            assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
            verdict: {
              type: 'OBJECT',
              properties: {
                expr: { type: 'STRING', description: 'a NUMBER formula (no >, <, ==): > 0 means if_positive, e.g. "F_push - F_tip"' },
                if_positive: { type: 'STRING' },
                if_not: { type: 'STRING' },
                claim: { type: 'STRING', enum: ['positive', 'not'] },
              },
            },
          },
          required: ['inputs', 'steps'],
        },
      },
    ],
  },
];

// The full session setup locked into the token.
// pushToTalk: the client marks when the user is talking (activityStart / activityEnd), so background
// chatter in a noisy room is never treated as speech.
export function liveSetup({ pushToTalk = false } = {}) {
  return {
    model: `models/${LIVE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { languageCode: process.env.GEMINI_LIVE_LANGUAGE || 'en-US' },
      temperature: 0.4,
      // Thinking models need a level (gemini-3.8-live-extended-thinking rejects a setup without one).
      ...(process.env.GEMINI_LIVE_THINKING && { thinkingConfig: { thinkingLevel: process.env.GEMINI_LIVE_THINKING } }),
    },
    systemInstruction: { parts: [{ text: LIVE_PROMPT }] },
    // googleSearch: real product knowledge ("CORE bottles hide the cap inside the blue cup") instead of guessing.
    tools: process.env.GEMINI_LIVE_SEARCH === '0' ? LIVE_TOOLS : [...LIVE_TOOLS, { googleSearch: {} }],
    inputAudioTranscription: {},
    ...(pushToTalk && { realtimeInputConfig: { automaticActivityDetection: { disabled: true } } }),
    outputAudioTranscription: {},
  };
}
