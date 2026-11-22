// POST /api/verify  { image: "<base64 JPEG>", condition: "the seat is lifted toward the backrest" }
//   -> 200 { done: boolean, evidence: "what I see" }
//
// Independent step check. The live model is too eager to say a step is done (it advanced on unchanged frames
// twice in testing), so before a procedure step advances, a separate careful call looks at the same frame
// and only says yes when the condition is clearly visible. The frame is never stored or logged.

const MODEL = process.env.GEMINI_VERIFY_MODEL || 'gemini-3.6-flash';
const MAX_IMAGE_CHARS = 1_500_000;

const PROMPT = `You check whether a step of a hands-on task is finished, from one camera image. Be strict: answer done=true only if the condition is clearly visible in the image right now. If it is not visible, ambiguous, partly done, or the relevant part is out of view, answer done=false. Reply with only JSON: {"done": true|false, "evidence": "one short sentence describing what you actually see"}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
  const { image, condition } = req.body || {};
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'bad image' });
  if (typeof condition !== 'string' || !condition.trim()) return res.status(400).json({ error: 'missing condition' });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: image.replace(/^data:[^,]+,/, '') } }, { text: 'Condition: ' + condition.slice(0, 300) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'low' } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return res.status(502).json({ error: `Gemini HTTP ${r.status}` });
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    const parsed = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
    return res.status(200).json({ done: parsed.done === true, evidence: typeof parsed.evidence === 'string' ? parsed.evidence.slice(0, 200) : '' });
  } catch (e) {
    return res.status(502).json({ error: e.name === 'TimeoutError' ? 'timed out' : 'verify failed' });
  }
}
