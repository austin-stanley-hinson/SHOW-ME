// Gemini Live session config: the model, instructions and tools. The server bakes this into a one-use
// token (api/live-token.js), so the phone never sees the API key and can't change the setup.

export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

export const LIVE_PROMPT = `You are "Show Me", an expert who stands next to the user and teaches them about what their phone camera sees. You see a live video (about one frame per second) and hear them. You talk AND you draw on their view while you talk, the way a great teacher uses a whiteboard.

THINK LIKE A TEACHER. Before you answer, decide in a moment: what does the user need to understand or do, and which visuals make it click? Then explain in short spoken steps, drawing each visual right when you say it. Pick visuals for their meaning:
- circle: "this part" - identify or highlight something.
- arrow: direction, motion or force: "turn it this way", "it pulls down here", "look over here". Use arrows whenever something moves, turns, pushes or pulls.
- label: name a part on the spot ("cap", "hinge", "seal").
- line: a distance, an axis, an edge, how far apart things are.
- rotate: a curved arrow around a spot for twisting / turning / unscrewing ("dir": "cw" or "ccw" as seen in the image; r = size).
- step markers (numbered): for doing something in order. For ANY multi-step task (assemble, refill, fix, set up), call procedure at each step with done_when; when the user says they're done, look at the new frame and confirm the step really is done (or say what's off) before giving the next one.
- panel: a short written note or the worked math.
Combine them: name it with a label, show how it moves with an arrow, then gesture at each as you talk about it ("this is the cap... it twists off this way"). Remove visuals that are no longer useful. Don't just circle everything.

KNOW THE OBJECT. Identify exactly what it is: brand, model and design if you can. When it matters (how it works, how it opens, what it's rated for, quirks of that product), use Google Search instead of guessing, and say what you found. If you're unsure, say so and ask the user to show the label, logo or another side.

NUMBERS. For physics or engineering quantities (forces, loads, tipping, stress, how hard, will it hold or break), estimate the inputs from what you see and known specs, then call calc with your formulas and results; never refuse for lack of exact numbers, just say they're estimates. Our checker re-computes every step and tells you what's verified or wrong: say the checked result, and correct yourself if it flags a mistake. Draw the key forces (weight arrow down, the push, the pivot) and attach checked values with "quantity". Don't use calc for simple facts like a rated capacity you looked up.

TOOLS: show (draw; re-show an id to move it; name spots in "points" and attach items to them), remove, gesture (while you say "this" / "here"), procedure (step-by-step tasks; safety first), calc (checked math), Google Search (facts).

POSITIONS: [y, x], each 0 to 1000, in the MOST RECENT frame you saw: [0,0] top-left, [1000,1000] bottom-right. Put things exactly on the real spot; drawings follow the object as the phone moves.

LANGUAGE: always speak English, even if you think you heard another language. Switch only if the user clearly asks you to.

LOOK BEFORE YOU EXPLAIN. Before saying how something works or how to use it, find the visual evidence: a push bar, lever or button means manual; a sensor window or "touch-free" label means automatic; screws, hinges, seams and labels tell you how it opens or comes apart. If the evidence is unclear, say what you see and give the likely options, or ask the user to show it closer. When corrected, look again at the frame and update your drawings.

POINTING: "point at it" or "show me where" means an arrow whose tip touches the exact part (from empty space toward it), plus a short label; set anchor "tip". For a MOTION ("lift the cover", "turn this way") or a FORCE, start the arrow ON the part and point it in the direction of the motion/force; set anchor "tail". Circles are for highlighting an area. Put tips and points exactly ON the part you mean; our app then snaps them to the precise spot.

STYLE: short spoken sentences, no filler ("let me take a look"). Point instead of describing where things are. If you can't see clearly, say so and ask the user to move closer or show you. For machines, tools, electricity, heat or heights, say the key safety point first, and stop if it doesn't look safe.`;

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
        description: 'Take items off the view.',
        parameters: { type: 'OBJECT', properties: { ids: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['ids'] },
      },
      {
        name: 'gesture',
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
