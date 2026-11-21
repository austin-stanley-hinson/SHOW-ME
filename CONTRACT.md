# Response Contract (v1)

This is the one JSON shape that **Gemini must return** and that **the renderer must accept**.
If you change it, change it here first and tell the other person.

## Top-level object

```json
{
  "answer": "string",
  "followup_question": "string or null",
  "draw": [ ...draw items... ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `answer` | string | yes | Short spoken-style answer (1–3 sentences). Shown in the UI. |
| `followup_question` | string \| null | yes | A question the AI wants to ask the user, or `null`. |
| `draw` | array | yes | Things to draw. Can be empty `[]`. Max 12 items. |

No other top-level fields. No markdown, no code fences, no comments. Just the JSON.

## Coordinates

All positions are **normalized image coordinates**: `[x, y]`, each a number from `0` to `1`.

- `[0, 0]` = top-left of the camera frame
- `[1, 1]` = bottom-right
- `x` goes right, `y` goes **down**

Example: `[0.5, 0.5]` is the center of the image.

## Draw items

Every item has these common fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | string | yes | One of `arrow`, `line`, `point`, `label`, `panel` |
| `id` | string | yes | Unique within this response, e.g. `"weight"`, `"bolt_top"` |
| `label` | string | no | Short text shown next to the item (max ~30 chars) |
| `color` | string | no | Hex color like `"#ff3b30"`. Renderer picks a default if missing. |

Extra fields per type:

| Type | Extra fields | Meaning |
|---|---|---|
| `arrow` | `from: [x,y]`, `to: [x,y]` | Arrow pointing from `from` to `to`. Use for forces and "look here". |
| `line` | `from: [x,y]`, `to: [x,y]` | Plain line, no head. Use for distances, edges, lever arms. |
| `point` | `at: [x,y]` | A dot marking a spot (bolt, pivot, button). |
| `label` | `at: [x,y]` | Text only, no shape. `label` is **required** for this type. |
| `panel` | `at: [x,y]`, `text: string` | Floating text box. `label` is the panel title. `text` is the body (may use `\n` for new lines, max ~300 chars). |

### Suggested colors

| Meaning | Color |
|---|---|
| Gravity / weight | `#ff3b30` (red) |
| Support / reaction forces | `#34c759` (green) |
| Tension / bolt forces | `#0a84ff` (blue) |
| Geometry, distances | `#ffffff` (white) |
| Highlights, "look here" | `#ffcc00` (yellow) |

## Renderer rules (for Austin)

- Ignore items with an unknown `type` or missing required fields. Never crash.
- Clamp coordinates to `0–1`.
- If `id` repeats, keep the first one.
- Draw in array order (later items on top).

## Example 1: Speaker statics demo

User looks at a wall speaker from the side (wall on the left) and asks: *"Why isn't it falling?"*

```json
{
  "answer": "That's a bookshelf speaker on a wall bracket, about 5 kg. Its 49 N weight is held up by two bolts in shear, and because it sticks out from the wall, the top bolt is pulled while the bottom of the bracket pushes into the wall.",
  "followup_question": "Do you know what kind of wall it is: drywall, wood stud, or brick?",
  "draw": [
    {
      "type": "point",
      "id": "center_of_mass",
      "at": [0.62, 0.50],
      "label": "Center of mass",
      "color": "#ffffff"
    },
    {
      "type": "arrow",
      "id": "weight",
      "from": [0.62, 0.50],
      "to": [0.62, 0.78],
      "label": "W = 49 N",
      "color": "#ff3b30"
    },
    {
      "type": "arrow",
      "id": "bolt_shear",
      "from": [0.30, 0.62],
      "to": [0.30, 0.42],
      "label": "Bolt shear 2 × 24.5 N",
      "color": "#0a84ff"
    },
    {
      "type": "arrow",
      "id": "bolt_top_tension",
      "from": [0.38, 0.40],
      "to": [0.24, 0.40],
      "label": "Top bolt pull ≈ 61 N",
      "color": "#0a84ff"
    },
    {
      "type": "arrow",
      "id": "wall_reaction",
      "from": [0.24, 0.60],
      "to": [0.38, 0.60],
      "label": "Wall push ≈ 61 N",
      "color": "#34c759"
    },
    {
      "type": "line",
      "id": "lever_arm",
      "from": [0.26, 0.50],
      "to": [0.62, 0.50],
      "label": "d ≈ 0.10 m",
      "color": "#ffffff"
    },
    {
      "type": "panel",
      "id": "statics_math",
      "at": [0.70, 0.15],
      "label": "Why it stays up",
      "text": "Mass ≈ 5 kg → W = 5 × 9.8 = 49 N\nUp: 2 bolts × 24.5 N = 49 N ✓\nTurning: M = W × d = 49 × 0.10 = 4.9 N·m\nBolt spacing 0.08 m → T = 4.9 / 0.08 ≈ 61 N\nTop bolt pulls in, wall pushes out at bottom.\nAll forces and moments balance → no motion."
    }
  ]
}
```

## Example 2: Simple "where is it" question

User looks at the back of a TV and asks: *"Which port is HDMI?"*

```json
{
  "answer": "The HDMI port is the wide, flat, trapezoid-shaped one on the left side of the panel.",
  "followup_question": null,
  "draw": [
    {
      "type": "point",
      "id": "hdmi_port",
      "at": [0.31, 0.56],
      "color": "#ffcc00"
    },
    {
      "type": "arrow",
      "id": "hdmi_pointer",
      "from": [0.15, 0.30],
      "to": [0.29, 0.53],
      "label": "HDMI 1",
      "color": "#ffcc00"
    },
    {
      "type": "label",
      "id": "usb_port",
      "at": [0.55, 0.58],
      "label": "USB (not HDMI)",
      "color": "#ffffff"
    }
  ]
}
```

## Example 3: Nothing to draw

```json
{
  "answer": "I can't see anything clearly. Try moving closer and holding the phone still.",
  "followup_question": null,
  "draw": []
}
```
