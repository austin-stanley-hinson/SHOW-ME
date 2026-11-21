# Response Contract (v3)

The one JSON shape that **the model returns**, the **server validates** (`api/_lib/validate.js`) and **the renderer draws**.
Change it here first, in its own PR, with both humans' OK.

**Core idea: the AI works in your view with you.** It answers, draws on the real objects, narrates out loud while
gesturing at things, edits what's already on screen, guides tasks step by step, and builds checkable calculations.
Any model can drive it (`MODEL_PROVIDER`); every device renders the same JSON (phone now, AR glasses later).

**Core rule: the model computes, our code checks.** The model has full freedom to model reality and do the math, but
shows its work as a calc sheet. `src/physics/calc.js` re-computes every step (✓ / ⚠), checks the yes/no verdict, and
audits numbers in free text. Live changes (sliders, teammates, measurements) re-run the model's own formulas.

## Top-level object

```json
{
  "answer": "string",
  "followup_question": "string or null",
  "points": [ { "id": "hinge_left", "at": [0.42, 0.62] } ],
  "calc": { ... } or null,
  "draw": [ ...draw items... ],
  "narration": [ { "say": "...", "gesture": { "type": "pulse", "target": "hinge_left" } } ],
  "clear": true,
  "remove": [ "old_item_id" ],
  "procedure": { ... } or null
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `answer` | string | yes | 1–3 sentences. The caption. |
| `followup_question` | string \| null | no (→ null) | What the AI wants to ask (more info, another view). |
| `points` | array | no (→ []) | Named real, visible spots: `{ id, at: [x,y] }`, max 16. Ids: letters, digits, `_`. |
| `calc` | object \| null | no (→ null) | Calculation sheet, see **Calc**. |
| `draw` | array | yes | Items to draw, max 12 (prompt asks for ≤ 8). |
| `narration` | array | no (→ []) | Lines to speak in order, each optionally with a gesture. Max 8, ≤ 200 chars each. |
| `clear` | boolean | no (→ true) | `true`: fresh view. `false`: keep what's on screen and edit it (see **Editing the view**). |
| `remove` | string[] | no (→ []) | With `clear: false`: ids of items to take off the screen. |
| `procedure` | object \| null | no (→ null) | Step-by-step guidance state, see **Procedures**. |

## Coordinates

`[x, y]`, each 0–1 of the image: `[0,0]` top-left, `[1,1]` bottom-right, y goes **down**.
- The frame sent to the model is exactly what the user sees (same crop as the screen).
- Text should stay within y 0.05–0.92 (browser bars cover the edges).
- **Anchors:** `at` is the center for `point`, `circle`, `step`, `label`; the top-left corner for `panel`.
- **2D → 3D:** at capture the renderer saves camera orientation + FOV; each `[x,y]` becomes a ray, and items sit on a
  plane ~1.5 m in front of the capture-time camera (rotation only, so distance doesn't change what you see).
- Any position may be a **point id** instead of `[x,y]` (e.g. `"from": "seat_front"`). The validator resolves it to
  coordinates and keeps `item.refs = { from: "seat_front" }`, so a device that measures 3D can attach to the real spot.

## Draw items

Common fields: `type`, `id` (unique, snake_case), optional `label` (≤ 30 chars), `color` (hex), `quantity` (a calc
name; the renderer appends its value via `formatLabel`).

| Type | Fields | Meaning |
|---|---|---|
| `arrow` | `from`, `to` | A force, a motion, or pointing at something |
| `line` | `from`, `to` | A distance, edge, axis |
| `point` | `at` | A dot on a spot |
| `circle` | `at`, `r` | Highlight a part. `r` = radius as a fraction of image width, clamped 0.01–0.3 |
| `label` | `at`, `label` (required) | Text only |
| `step` | `at`, `n` (integer), `label` (required) | A numbered instruction on the part to act on |
| `panel` | `at`, `text`, optional `content: "calc"` | Text box (≤ 200 chars). With `content: "calc"`, append the calc lines and assumptions |

Colors: weight `#ff3b30`, support/reaction `#34c759`, applied/tension `#0a84ff`, geometry `#ffffff`, highlight `#ffcc00`.

## Narration and gestures

The AI talks while it points. The renderer speaks `narration` lines in order (speech synthesis) and, **while a line
is spoken**, plays its gesture on the target (a draw item id, a point id, or an item already on screen):

| Gesture | What the renderer does |
|---|---|
| `point` | Indicate the target (e.g. a short pointer or glow) |
| `pulse` | Make the target blink / grow-shrink |
| `trace` | Animate along an arrow or line from `from` to `to` (shows a motion: "lift this way") |
| `circle` | Draw a ring around the target |

Unknown targets are dropped by the validator (the line is still spoken). Captions show the line being spoken.

## Editing the view

What's on screen is a **scene**: a set of items by id. Each response edits it:
1. `clear: true` (default): empty the scene first.
2. Remove every id in `remove`.
3. Add each `draw` item; an item with an existing id **replaces** it (that's how the AI moves or changes something).

The client sends its **current scene** back as `previous.response` (the full list of items on screen), so the AI
knows the ids it can refer to.

## Procedures

For "guide me through it" tasks, one step at a time:

```json
"procedure": { "title": "Fold the chair", "current": 1, "total": 3,
               "done_when": "The seat is folded up flat against the backrest.",
               "complete": false, "safety": ["Keep fingers clear of the hinge."] }
```
- The current step is drawn (usually a `step` item on the real part) and narrated.
- The UI shows **Done / Next**. On tap it captures a new frame and asks again with `previous`. The AI checks the new
  picture against `done_when`, then corrects or moves on. `complete: true` ends it.
- `safety` (≤ 3) is always shown first, before the step.

## Calc

```json
"calc": {
  "inputs": [
    { "name": "m_person", "value": 113, "unit": "kg", "label": "Person", "est": false, "adjustable": { "min": 0, "max": 200 } },
    { "name": "d", "value": 0.2, "unit": "m", "label": "CG to rear feet",
      "measure": { "kind": "horizontal", "from": "foot_rear", "to": "seat_center" } }
  ],
  "steps": [
    { "name": "W", "expr": "(m_person + m_chair) * g", "value": 1140, "unit": "N", "label": "Total weight" }
  ],
  "assumptions": ["..."],
  "verdict": { "expr": "F_tip - 200", "if_positive": "...", "if_not": "...", "claim": "positive" }
}
```
- **inputs:** `value` is the model's estimate (`est: true`) or a known fact (`est: false`).
  `adjustable {min,max}` → the UI shows a slider. `measure {kind: horizontal|vertical|distance, from, to}` → a device
  that measures 3D points replaces `value` with the real length (otherwise the estimate is used).
- **steps:** `expr` is the formula, `value` is **the model's own result**. Allowed in `expr`: numbers, earlier names,
  `g` (9.81), `pi`, `+ - * / ^ ( )`, `sqrt abs exp ln log10 sin cos tan asin acos atan atan2 min max deg rad`.
- **verdict:** the formula that decides a yes/no question (> 0 → `if_positive`), plus the model's `claim`.

`evaluateCalc(calc, points3d?, overrides?)` returns
`{ ok, verified, mismatches, quantities, lines, assumptions, errors, verdict }`:
- each step: `check` = `ok` ✓ | `mismatch` ⚠ (model's value kept, ours in `expected`) | `updated` (an input changed,
  so we re-ran the formula) | `computed` (no value given).
- `lines`: e.g. `Push to tip: F = 6.17 / 0.75 = 9.5 N ⚠ checker gets 8.23 N`.
- `overrides`: `{ name: { value, by } }` from sliders / teammates, clamped to `adjustable`.
- `auditText(text, result, calc)` lists numbers in free text that don't trace to a checked value (with kg↔lb, N↔lbf).

**Renderer must:** show ✓ / ⚠ per line, show `verdict.text` (flag it if `verdict.check === "mismatch"`), mark
untraced numbers in the caption, label estimates `(est.)`, and always show assumptions when calc is shown.

## Request (`POST /api/ask`)

```json
{ "image": "<base64 JPEG, no data: prefix>", "question": "string",
  "previous": { "question": "string", "response": { "draw": [ ...current scene... ], "...": "last answer" } } }
```
200 → the object above. Errors → non-200 `{ "error": "..." }`; show a friendly caption and draw nothing.

## Example 1: "What is this?" (narrate a tour)

```json
{
  "answer": "It's a steel-frame folding chair with a plastic seat and backrest.",
  "followup_question": "Want me to show you how it folds?",
  "points": [{ "id": "seat", "at": [0.43, 0.6] }, { "id": "hinge_left", "at": [0.6, 0.67] }, { "id": "cross_bar", "at": [0.5, 0.86] }],
  "calc": null,
  "draw": [
    { "type": "circle", "id": "c_hinge", "at": "hinge_left", "r": 0.04, "color": "#ffcc00" },
    { "type": "label", "id": "l_bar", "at": [0.36, 0.9], "label": "Cross brace" }
  ],
  "narration": [
    { "say": "This is a standard folding chair.", "gesture": { "type": "point", "target": "seat" } },
    { "say": "It folds on this rivet joint.", "gesture": { "type": "pulse", "target": "c_hinge" } },
    { "say": "And this bar keeps the legs from spreading.", "gesture": { "type": "point", "target": "l_bar" } }
  ]
}
```

## Example 2: Guided step (fold the chair, step 1 of 3)

```json
{
  "answer": "Step 1: lift the front edge of the seat up toward the backrest.",
  "followup_question": null,
  "points": [{ "id": "seat_front", "at": [0.3, 0.6] }],
  "calc": null,
  "draw": [
    { "type": "step", "id": "step1", "at": "seat_front", "n": 1, "label": "Lift seat front" },
    { "type": "arrow", "id": "lift_motion", "from": [0.3, 0.6], "to": [0.42, 0.33], "color": "#ffcc00" }
  ],
  "narration": [
    { "say": "Grab the front edge of the seat here.", "gesture": { "type": "pulse", "target": "step1" } },
    { "say": "Then lift it up toward the backrest, like this.", "gesture": { "type": "trace", "target": "lift_motion" } }
  ],
  "procedure": { "title": "Fold the chair", "current": 1, "total": 3,
                 "done_when": "The seat is vertical against the backrest.", "complete": false,
                 "safety": ["Keep your fingers away from the hinge while it closes."] }
}
```

## Example 3: Engineering question with a checked calc

User asks: *"How hard can I push the top of the backrest before it tips backward?"*

```json
{
  "answer": "It tips backward around the rear feet; about an 8 N push at the top does it.",
  "followup_question": null,
  "points": [{ "id": "foot_rear", "at": [0.7, 0.84] }, { "id": "back_top", "at": [0.62, 0.21] }, { "id": "cg", "at": [0.5, 0.6] }],
  "calc": {
    "inputs": [
      { "name": "m", "value": 3.5, "unit": "kg", "label": "Chair mass", "est": true },
      { "name": "d", "value": 0.18, "unit": "m", "label": "CG ahead of rear feet", "est": true,
        "measure": { "kind": "horizontal", "from": "foot_rear", "to": "cg" } },
      { "name": "h", "value": 0.75, "unit": "m", "label": "Push height", "est": true,
        "measure": { "kind": "vertical", "from": "foot_rear", "to": "back_top" } },
      { "name": "F_push", "value": 5, "unit": "N", "label": "Your push", "est": false, "adjustable": { "min": 0, "max": 50 } }
    ],
    "steps": [
      { "name": "W", "expr": "m * g", "value": 34.3, "unit": "N", "label": "Weight" },
      { "name": "M", "expr": "W * d", "value": 6.17, "unit": "N·m", "label": "Restoring moment" },
      { "name": "F_tip", "expr": "M / h", "value": 8.23, "unit": "N", "label": "Push to tip" }
    ],
    "assumptions": ["Typical folding chair mass", "Pivot about the rear feet", "Horizontal push at the top"],
    "verdict": { "expr": "F_push - F_tip", "if_positive": "That push tips it over.", "if_not": "That push won't tip it.", "claim": "not" }
  },
  "draw": [
    { "type": "arrow", "id": "weight", "from": "cg", "to": [0.5, 0.78], "label": "W", "quantity": "W", "color": "#ff3b30" },
    { "type": "arrow", "id": "push", "from": [0.45, 0.21], "to": "back_top", "label": "Push to tip", "quantity": "F_tip", "color": "#0a84ff" },
    { "type": "circle", "id": "pivot", "at": "foot_rear", "r": 0.03, "label": "Pivot", "color": "#34c759" },
    { "type": "panel", "id": "math", "at": [0.05, 0.08], "label": "Why", "text": "The weight holds it down around the rear feet; your push tries to rotate it back.", "content": "calc" }
  ],
  "narration": [
    { "say": "It pivots on these rear feet.", "gesture": { "type": "pulse", "target": "pivot" } },
    { "say": "Push here, and about 8 newtons tips it.", "gesture": { "type": "trace", "target": "push" } }
  ]
}
```

## Example 4: Nothing to draw

```json
{ "answer": "I can't see it clearly. Move closer and hold still.", "followup_question": null, "draw": [] }
```
