// POST /api/point  { image: "<base64 JPEG>", targets: [{ id, label, at? }] }
//   -> 200 { points: [{ id, at: [x, y] }] }    contract coords 0-1; targets it can't find are left out
//
// Precise placement. The live model is good at conversation but loose at pinpointing; a regular Gemini
// call on the SAME frame, asked only "where exactly is <label>?", is much more accurate. The client
// draws the live model's guess immediately, then snaps it to this answer (~1 s later).
// The frame is never stored or logged.

const MODEL = process.env.GEMINI_POINT_MODEL || 'gemini-3.6-flash';
const MAX_IMAGE_CHARS = 1_500_000;
const ID = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const PROMPT = `You locate things in an image precisely. For each target, return the single point [y, x] (each 0-1000, [0,0] = top-left) that is exactly ON that thing: for a button, lever, bar or handle, the middle of the surface you would press or grab. If "near" is given, it's a rough guess of where it is. If a target is not visible, leave it out.
Reply with only JSON: {"points": [{"id": "...", "at": [y, x]}]}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
  const { image, targets } = req.body || {};
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'bad image' });
  const list = (Array.isArray(targets) ? targets : [])
    .filter((t) => t && ID.test(t.id || '') && typeof t.label === 'string' && t.label.trim())
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      label: t.label.slice(0, 80),
      ...(Array.isArray(t.at) && t.at.length === 2 && t.at.every(Number.isFinite) && { near: [Math.round(t.at[1] * 1000), Math.round(t.at[0] * 1000)] }),
    }));
  if (!list.length) return res.status(400).json({ error: 'no targets' });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: image.replace(/^data:[^,]+,/, '') } }, { text: 'Targets: ' + JSON.stringify(list) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 512, thinkingConfig: { thinkingLevel: 'low' } },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return res.status(502).json({ error: `Gemini HTTP ${r.status}` });
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    const parsed = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
    const known = new Set(list.map((t) => t.id));
    const points = (Array.isArray(parsed.points) ? parsed.points : [])
      .filter((p) => known.has(p?.id) && Array.isArray(p.at) && p.at.length === 2 && p.at.every(Number.isFinite))
      .map((p) => ({ id: p.id, at: [Math.min(1, Math.max(0, p.at[1] / 1000)), Math.min(1, Math.max(0, p.at[0] / 1000))] }));
    return res.status(200).json({ points });
  } catch (e) {
    return res.status(502).json({ error: e.name === 'TimeoutError' ? 'timed out' : 'point lookup failed' });
  }
}
