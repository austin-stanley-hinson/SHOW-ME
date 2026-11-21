# Response Contract (v2.2)

This is the one JSON shape that **Gemini must return** and that **the renderer must accept**.
If you change it, change it here first, in its own PR, and get the other person's OK before merging.

**Core rule: Gemini estimates, our code calculates.**
Gemini supplies positions, *input* estimates (mass, distances), and the assumptions behind them.
Every *derived* number (forces, moments, tensions) is computed by `physics.js` and inserted by the renderer.
Gemini must never write a derived number anywhere in its output.

## Top-level object

```json
{
  "answer": "string",
  "followup_question": "string or null",
  "physics": { ... } or null,
  "draw": [ ...draw items... ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `answer` | string | yes | Short spoken-style answer (1–3 sentences). Shown as the caption and optionally read aloud. May mention estimates ("about 5 kg"), never derived numbers ("49 N"). |
| `followup_question` | string \| null | yes | A question the AI wants to ask the user, or `null`. |
| `physics` | object \| null | yes | Inputs for our physics code. `null` when the question isn't a physics question. See below. |
| `draw` | array | yes | Things to draw. Can be empty `[]`. Max 12 items. |

No other top-level fields. No markdown, no code fences, no comments. Just the JSON.

## Coordinates

All positions are **normalized image coordinates**: `[x, y]`, each a number from `0` to `1`.

- `[0, 0]` = top-left of the camera frame
- `[1, 1]` = bottom-right
- `x` goes right, `y` goes **down**

Example: `[0.5, 0.5]` is the center of the image.

**Which image:** the frame sent to Gemini must be exactly what the user sees on screen
(same crop). If the video is shown with `object-fit: cover`, crop the frame the same way
before sending, or the overlay will be shifted.

**Anchors (what `at` means):**

| Type | `at` is the... |
|---|---|
| `point`, `step` | center of the dot / marker |
| `label` | center of the text |
| `panel` | top-left corner of the box (so it doesn't spill off-screen) |

**From 2D to 3D:** when the frame is captured, the renderer saves the camera's
orientation and field of view. Each `[x, y]` becomes a ray from the camera through that
pixel, and the item is placed where the ray hits an invisible plane ~1.5 m in front of
the capture-time camera. Items then stay fixed in the world as the phone turns.

## Physics

```json
"physics": {
  "model": "wall_mount",
  "inputs": { "mass_kg": 5, "lever_arm_m": 0.10, "bolt_spacing_m": 0.08, "bolt_count": 2 },
  "assumptions": ["Bookshelf speakers this size are usually 4–6 kg", "Center of mass is near the middle of the box"]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `model` | string | yes | Which calculation to run: `wall_mount` or `tripod_stand`. |
| `inputs` | object | yes | Estimated input values for that model (numbers only, SI units in the key name). |
| `assumptions` | string[] | yes | 1–4 short reasons behind the estimates. The renderer always shows these. |

### Model `wall_mount`

An object bolted to a wall through a bracket. Bolts are stacked vertically.

| Input | Unit | Meaning |
|---|---|---|
| `mass_kg` | kg | Estimated mass of the object |
| `lever_arm_m` | m | Horizontal distance from the wall to the center of mass |
| `bolt_spacing_m` | m | Vertical distance between top and bottom bolt |
| `bolt_count` | integer | Number of bolts |

Computed by `physics.js` (g = 9.81 m/s²):

| Quantity key | Formula | Unit |
|---|---|---|
| `weight` | W = m·g | N |
| `shear_per_bolt` | W / bolt_count | N |
| `moment` | M = W · lever_arm | N·m |
| `top_bolt_tension` | T = M / bolt_spacing | N |
| `wall_reaction` | equal to T (horizontal balance) | N |

### Model `tripod_stand`

An object on a three-legged stand (speaker stand, light stand, camera tripod). Feet are evenly spaced around the pole.

| Input | Unit | Meaning |
|---|---|---|
| `mass_kg` | kg | Estimated mass of the object on top |
| `stand_mass_kg` | kg | Estimated mass of the stand |
| `leg_radius_m` | m | Horizontal distance from the pole to each foot |
| `com_height_m` | m | Height of the combined center of mass (object + stand) above the floor |
| `push_height_m` | m | Height where someone would bump it (usually the top of the object) |

Computed by `physics.js` (g = 9.81 m/s²). Tipping uses the weakest direction: the edge between two feet, which is `leg_radius / 2` from the pole.

| Quantity key | Formula | Unit |
|---|---|---|
| `weight` | W = (mass + stand_mass)·g | N |
| `leg_load` | W / 3 | N |
| `tip_margin_m` | e = leg_radius / 2 | m |
| `tip_moment` | M = W · e | N·m |
| `tip_force` | F = M / push_height (sideways push that starts tipping it) | N |
| `tip_angle_deg` | θ = atan(e / com_height) (lean before it falls) | ° |

Any input key can also be used as a quantity (`mass_kg`, `lever_arm_m`, …). It is shown as an estimate.

If `model` is unknown or an input is missing or not a positive number, the renderer draws everything **without** numbers and the panel shows the assumptions only. Never crash.

## Draw items

Every item has these common fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | string | yes | One of `arrow`, `line`, `point`, `label`, `step`, `panel` |
| `id` | string | yes | Unique within this response, e.g. `"weight"`, `"bolt_top"` |
| `label` | string | no | Short text shown next to the item (max ~30 chars). **No derived numbers.** |
| `quantity` | string | no | A quantity key from the physics section. The renderer appends the value to the label. |
| `color` | string | no | Hex color like `"#ff3b30"`. Renderer picks a default if missing. |

Extra fields per type:

| Type | Extra fields | Meaning |
|---|---|---|
| `arrow` | `from: [x,y]`, `to: [x,y]` | Arrow pointing from `from` to `to`. Use for forces and "look here". |
| `line` | `from: [x,y]`, `to: [x,y]` | Plain line, no head. Use for distances, edges, lever arms. |
| `point` | `at: [x,y]` | A dot marking a spot (bolt, pivot, button). |
| `label` | `at: [x,y]` | Text only, no shape. `label` is **required** for this type. |
| `step` | `at: [x,y]`, `n: integer` | Numbered marker (1, 2, 3…) on a button or part. `label` is **required**: the instruction for that step ("Press Power"). |
| `panel` | `at: [x,y]`, `text: string`, `content?: "physics"` | Floating text box. `label` is the title. `text` is plain explanation (may use `\n`, max ~300 chars, no derived numbers). With `"content": "physics"`, the renderer appends the worked math from `physics.js` and the assumptions below `text`. |

### How `quantity` is displayed

The renderer formats `label` + value from `physics.js`:

- Derived quantity: `"W"` + `weight` → **`W = 49 N`**
- Input estimate: `"d"` + `lever_arm_m` → **`d ≈ 0.10 m (est.)`**
- No label: the quantity's own name is used → **`Top bolt tension = 61 N`**
- No valid physics: the label is shown alone → **`W`**

### Suggested colors

| Meaning | Color |
|---|---|
| Gravity / weight | `#ff3b30` (red) |
| Support / reaction forces | `#34c759` (green) |
| Tension / bolt forces | `#0a84ff` (blue) |
| Geometry, distances | `#ffffff` (white) |
| Highlights, "look here", steps | `#ffcc00` (yellow) |

## Renderer rules (Austin)

- Ignore items with an unknown `type` or missing required fields. Never crash.
- Clamp coordinates to `0–1`.
- If `id` repeats, keep the first one.
- Draw in array order (later items on top).
- Every number shown on screen comes from `physics.js`. Never parse numbers out of Gemini's text.
- Estimated inputs are always marked `≈ … (est.)`, and the assumptions are always visible when physics is shown.
- Draw `step` items in order of `n`, and also list the step instructions in the caption area so they're readable without looking at the markers.
- Draw text onto a canvas texture (not a three.js font file) so symbols like `≈ × · ✓ –` render instead of showing as empty boxes.
- If the server returns an error, show a caption like "Sorry, I couldn't figure that out. Try again." and draw nothing.

## Server rules (Gemini side)

- Validate the response against this contract before returning it. If it's not valid JSON or required fields are missing, return an error status (not 200) with `{ "error": "..." }`. Never return half-valid JSON.
- The prompt must tell Gemini: estimate inputs only, never compute forces, moments, or totals.

## Example 1: Speaker statics demo

User looks at a wall speaker from the side (wall on the left) and asks: *"Why isn't it falling?"*

```json
{
  "answer": "That's a bookshelf speaker on a wall bracket, about 5 kg. Two bolts hold its weight, and because it sticks out from the wall, the top bolt is pulled while the bottom of the bracket presses into the wall.",
  "followup_question": "Do you know what kind of wall it is: drywall, wood stud, or brick?",
  "physics": {
    "model": "wall_mount",
    "inputs": { "mass_kg": 5, "lever_arm_m": 0.10, "bolt_spacing_m": 0.08, "bolt_count": 2 },
    "assumptions": [
      "Bookshelf speakers this size are usually 4–6 kg",
      "Center of mass is near the middle of the box",
      "Two bolts, one above the other, about 8 cm apart"
    ]
  },
  "draw": [
    { "type": "point", "id": "bolt_top", "at": [0.25, 0.40], "label": "Top bolt", "color": "#0a84ff" },
    { "type": "point", "id": "bolt_bottom", "at": [0.25, 0.60], "label": "Bottom bolt", "color": "#0a84ff" },
    { "type": "point", "id": "center_of_mass", "at": [0.62, 0.50], "label": "Center of mass", "color": "#ffffff" },
    { "type": "arrow", "id": "weight", "from": [0.62, 0.50], "to": [0.62, 0.78], "label": "W", "quantity": "weight", "color": "#ff3b30" },
    { "type": "arrow", "id": "bolt_shear", "from": [0.30, 0.62], "to": [0.30, 0.42], "label": "Shear per bolt", "quantity": "shear_per_bolt", "color": "#0a84ff" },
    { "type": "arrow", "id": "bolt_top_tension", "from": [0.38, 0.40], "to": [0.24, 0.40], "label": "Top bolt pull", "quantity": "top_bolt_tension", "color": "#0a84ff" },
    { "type": "arrow", "id": "wall_reaction", "from": [0.24, 0.60], "to": [0.38, 0.60], "label": "Wall push", "quantity": "wall_reaction", "color": "#34c759" },
    { "type": "line", "id": "lever_arm", "from": [0.26, 0.50], "to": [0.62, 0.50], "label": "d", "quantity": "lever_arm_m", "color": "#ffffff" },
    {
      "type": "panel",
      "id": "statics_math",
      "at": [0.70, 0.15],
      "label": "Why it stays up",
      "text": "The bolts carry the weight straight up.\nBecause the speaker sticks out, it tries to rotate down; the top bolt pulls and the wall pushes back to stop that.",
      "content": "physics"
    }
  ]
}
```

What the renderer shows in the panel (computed by `physics.js`, not Gemini):

```
Mass ≈ 5 kg (est.) → W = 5 × 9.81 = 49 N
Up: 2 bolts × 24.5 N = 49 N ✓
Turning: M = 49 × 0.10 = 4.9 N·m
Top bolt: T = 4.9 / 0.08 = 61 N  ·  Wall push = 61 N
Assumptions: Bookshelf speakers this size are usually 4–6 kg; …
```

## Example 1b: Tripod speaker (the live demo)

User looks at a speaker on a tripod stand from the front and asks: *"Why isn't it falling?"*

```json
{
  "answer": "It's a powered PA speaker, about 16 kg, on a tripod stand. Its weight goes straight down the pole and spreads across three feet, and it only tips if its center of mass gets pushed past the edge between two feet.",
  "followup_question": "Want to know how hard you'd have to push it to knock it over?",
  "physics": {
    "model": "tripod_stand",
    "inputs": { "mass_kg": 16, "stand_mass_kg": 4, "leg_radius_m": 0.55, "com_height_m": 1.4, "push_height_m": 1.75 },
    "assumptions": [
      "12-inch powered PA speakers are usually 14–18 kg",
      "Steel tripod stands are about 4 kg",
      "Feet spread about 1.1 m across"
    ]
  },
  "draw": [
    { "type": "point", "id": "center_of_mass", "at": [0.52, 0.30], "label": "Center of mass", "color": "#ffffff" },
    { "type": "arrow", "id": "weight", "from": [0.52, 0.30], "to": [0.52, 0.52], "label": "W", "quantity": "weight", "color": "#ff3b30" },
    { "type": "arrow", "id": "leg_left", "from": [0.36, 0.99], "to": [0.36, 0.88], "label": "Leg", "quantity": "leg_load", "color": "#34c759" },
    { "type": "arrow", "id": "leg_right", "from": [0.67, 0.99], "to": [0.67, 0.88], "label": "Leg", "quantity": "leg_load", "color": "#34c759" },
    { "type": "arrow", "id": "leg_back", "from": [0.56, 0.88], "to": [0.56, 0.78], "label": "Leg", "quantity": "leg_load", "color": "#34c759" },
    { "type": "line", "id": "tip_edge", "from": [0.36, 0.95], "to": [0.67, 0.98], "label": "Tip edge", "color": "#ffffff" },
    { "type": "arrow", "id": "push", "from": [0.22, 0.08], "to": [0.38, 0.08], "label": "Push to tip", "quantity": "tip_force", "color": "#ffcc00" },
    {
      "type": "panel",
      "id": "statics_math",
      "at": [0.70, 0.05],
      "label": "Why it stays up",
      "text": "The weight goes down the pole and is shared by three feet.\nIt only falls if the center of mass moves past the line between two feet.",
      "content": "physics"
    }
  ]
}
```

What the renderer shows in the panel (computed by `physics.js`):

```
Mass ≈ 16 + 4 = 20 kg (est.) → W = 20 × 9.81 = 196 N
Each leg: 196 / 3 = 65.3 N
Tip edge: e = 0.55 / 2 = 0.275 m from the pole
To tip it: M = 196 × 0.275 = 53.9 N·m
Push at the top: F = 53.9 / 1.75 = 30.8 N
Lean limit: tan θ = 0.275 / 1.4 → θ = 11.1°
```

## Example 2: "How do I use this?" (steps)

User points at a laundry machine and asks: *"How do I start this?"*

```json
{
  "answer": "Turn the dial to Normal, pick a temperature, then press Start.",
  "followup_question": null,
  "physics": null,
  "draw": [
    { "type": "step", "id": "dial", "at": [0.42, 0.35], "n": 1, "label": "Turn dial to Normal", "color": "#ffcc00" },
    { "type": "step", "id": "temp", "at": [0.63, 0.36], "n": 2, "label": "Choose Warm or Cold", "color": "#ffcc00" },
    { "type": "step", "id": "start", "at": [0.81, 0.38], "n": 3, "label": "Press Start", "color": "#ffcc00" }
  ]
}
```

## Example 3: Simple "where is it" question

User looks at the back of a TV and asks: *"Which port is HDMI?"*

```json
{
  "answer": "The HDMI port is the wide, flat, trapezoid-shaped one on the left side of the panel.",
  "followup_question": null,
  "physics": null,
  "draw": [
    { "type": "point", "id": "hdmi_port", "at": [0.31, 0.56], "color": "#ffcc00" },
    { "type": "arrow", "id": "hdmi_pointer", "from": [0.15, 0.30], "to": [0.29, 0.53], "label": "HDMI 1", "color": "#ffcc00" },
    { "type": "label", "id": "usb_port", "at": [0.55, 0.58], "label": "USB (not HDMI)", "color": "#ffffff" }
  ]
}
```

## Example 4: Nothing to draw

```json
{
  "answer": "I can't see anything clearly. Try moving closer and holding the phone still.",
  "followup_question": null,
  "physics": null,
  "draw": []
}
```
