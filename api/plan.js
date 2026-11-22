// POST /api/plan  { image: "<base64 JPEG>", task: "fold this chair" }
//   -> 200 { title, steps: [{ n, say, part, motion, done_when, mistake }] }
//
// The live model is fast at conversation but weak at mechanical reasoning (it told Josh to "pull the
// backrest forward to release the lock" on a folding chair). Before guiding a task, it calls the plan tool;
// this careful call (thinking + Google Search for the specific product) writes physically correct steps
// that the live model then teaches one at a time. The frame is never stored or logged.

const MODEL = process.env.GEMINI_PLAN_MODEL || 'gemini-3.6-flash';
const MAX_IMAGE_CHARS = 1_500_000;

const PROMPT = `You are an expert technician writing hands-on instructions for the object in the image, for someone holding it right now.
First identify exactly what it is (type, and brand/model if visible) and how its mechanism actually works (hinges, pivots, latches, threads, which part moves relative to which). Use Google Search if you're not sure how this specific product works. Then write the steps.
Rules:
- 2 to 6 steps, in order. Each step is ONE physical action a beginner can do.
- "say": what to say out loud: short, concrete, under 18 words, names the exact part and the direction ("Grab the front edge of the seat and lift it straight up toward the backrest.").
- "part": the exact part to touch or move, as it would be labelled on the object ("front edge of the seat").
- "motion": the movement in plain words ("lift up toward the backrest", "twist counterclockwise").
- "done_when": what the OBJECT visibly looks like when the step is done (checkable from a photo of the object alone, never about the user's hands, which are often out of frame).
- Every step must change the object. Fold supporting actions into the step that needs them ("Holding the backrest, pull the front edge of the seat up toward it.") instead of making "hold X" its own step.
- "mistake": the most common mistake on this step, or "" if none.
- Only include steps that are physically correct for this mechanism. No safety lectures unless there's a real pinch/cut/shock/heat risk; then put it in that step's "mistake".
Reply with only JSON: {"title": "...", "object": "what it is", "steps": [{"n":1,"say":"...","part":"...","motion":"...","done_when":"...","mistake":"..."}]}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
  const { image, task } = req.body || {};
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'bad image' });
  if (typeof task !== 'string' || !task.trim()) return res.status(400).json({ error: 'missing task' });

  const call = async (withSearch) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: image.replace(/^data:[^,]+,/, '') } }, { text: 'Task: ' + task.slice(0, 300) }] }],
        ...(withSearch && { tools: [{ googleSearch: {} }] }),
        // JSON mode can't be combined with search; the prompt asks for JSON and we parse it.
        generationConfig: { ...(withSearch ? {} : { responseMimeType: 'application/json' }), temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'medium' } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON');
    return JSON.parse(m[0]);
  };

  try {
    let plan;
    try {
      plan = await call(true);
    } catch {
      plan = await call(false); // search unavailable or unparsable: plan without it
    }
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const steps = (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 6).map((s, i) => ({
      n: i + 1,
      say: str(s.say, 160),
      part: str(s.part, 80),
      motion: str(s.motion, 80),
      done_when: str(s.done_when, 160),
      mistake: str(s.mistake, 160),
    })).filter((s) => s.say);
    if (!steps.length) return res.status(502).json({ error: 'no steps' });
    return res.status(200).json({ title: str(plan.title, 60) || task.slice(0, 60), object: str(plan.object, 80), steps });
  } catch (e) {
    return res.status(502).json({ error: e.name === 'TimeoutError' ? 'timed out' : 'plan failed' });
  }
}
