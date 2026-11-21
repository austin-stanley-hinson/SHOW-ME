// Gemini provider. A provider only talks to its model: it sends the system prompt, the image and the
// question (plus the previous turn), and returns the model's raw text. Parsing and checking happen in
// ../model.js, the same for every provider.
//
//   generate({ systemPrompt, imageBase64, mimeType, question, previous, signal })
//     -> { ok: true, text, meta } | { ok: false, error, status?, meta }

// Tried in order; the next one is used if a model is busy (429/503) or gone (404).
const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-3.6-flash', 'gemini-flash-latest']; // not lite: it produced runaway output in testing
// No thinking on any model (faster). gemini-3.6-flash takes thinkingLevel; gemini-flash-latest rejects
// that (400) but accepts thinkingBudget: 0.
const THINKING = {
  'gemini-3.6-flash': { thinkingLevel: 'minimal' },
  'gemini-flash-latest': { thinkingBudget: 0 },
};
const withThinking = (body, model) =>
  THINKING[model] ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: THINKING[model] } } : body;
const urlFor = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

export const name = 'gemini';

export async function generate({ systemPrompt, imageBase64, mimeType, question, previous, signal }) {
  const key = process.env.GEMINI_API_KEY;
  const meta = { provider: name, attempts: [], model: null, usage: null };
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set', status: 500, meta };

  // The earlier image is not resent; the model sees the earlier question and its own JSON reply.
  const history = previous
    ? [
        { role: 'user', parts: [{ text: previous.question }] },
        { role: 'model', parts: [{ text: previous.responseText }] },
      ]
    : [];

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [...history, { role: 'user', parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: question }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      // No responseSchema: with it, gemini-3.6-flash wrote runaway numbers ("3.5000000000000004000…")
      // until MAX_TOKENS in 5/5 tests; without it, 3/3 valid. model.js validates every reply anyway.
      temperature: 0.3,
      maxOutputTokens: 2048, // stops runaway output fast
    },
  };

  // Busy (429/503) or gone (404): try the next model; after a full pass, wait and go again.
  let res;
  outer: for (let round = 0; round < 3; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 1500 * round));
    for (const model of MODELS) {
      const ta = Date.now();
      try {
        res = await fetch(urlFor(model), {
          signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(withThinking(body, model)),
        });
      } catch (e) {
        meta.attempts.push({ model, status: e.name, ms: Date.now() - ta });
        return { ok: false, error: e.name === 'TimeoutError' ? 'timed out' : 'could not reach Gemini', meta };
      }
      meta.attempts.push({ model, status: res.status, ms: Date.now() - ta });
      meta.model = model;
      if (![404, 429, 503].includes(res.status)) break outer;
    }
  }
  if (!res.ok) return { ok: false, error: `Gemini HTTP ${res.status}`, meta };

  const json = await res.json();
  const u = json?.usageMetadata || {};
  meta.usage = { prompt: u.promptTokenCount, output: u.candidatesTokenCount, thoughts: u.thoughtsTokenCount || 0 };
  meta.finish = json?.candidates?.[0]?.finishReason;
  const text = json?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') || '';
  return { ok: true, text, meta };
}
