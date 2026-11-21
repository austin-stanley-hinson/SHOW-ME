// Calls Gemini with one image + one question and returns a contract-valid object.
// Used by api/ask.js (Vercel) and api/_dev/try.mjs (local testing).

import { SYSTEM_PROMPT } from './prompt.js';
import { validateResponse } from './validate.js';

// Tried in order; the next one is used if a model is busy (429/503) or gone (404).
const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-3.6-flash', 'gemini-flash-latest']; // not lite: it produced runaway output in testing
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 55_000; // try.mjs can raise it for slow days
// "minimal" thinking is faster, but not every model accepts it (gemini-flash-latest returns 400).
const MINIMAL_THINKING = new Set(['gemini-3.6-flash']);
const withThinking = (body, model) =>
  MINIMAL_THINKING.has(model)
    ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingLevel: 'minimal' } } }
    : body;
const urlFor = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

// imageBase64: JPEG (or mimeType) as base64, no "data:" prefix.
// previous (optional): { question, response } from the last turn, so follow-up answers have context.
// Returns { ok: true, value } or { ok: false, error }.
export async function askGemini(imageBase64, question, previous = null, mimeType = 'image/jpeg') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set', status: 500 };

  // The earlier image is not resent; Gemini sees the earlier question and its own JSON reply.
  const history =
    previous && typeof previous.question === 'string' && previous.response
      ? [
          { role: 'user', parts: [{ text: previous.question.slice(0, 500) }] },
          { role: 'model', parts: [{ text: JSON.stringify(previous.response).slice(0, 8000) }] },
        ]
      : [];

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      ...history,
      {
        role: 'user',
        parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: question }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      // No responseSchema: with it, gemini-3.6-flash wrote runaway numbers ("3.5000000000000004000…")
      // until MAX_TOKENS in 5/5 tests; without it, 2/2 valid. validate.js checks every reply anyway.
      // schema.js stays as the machine-readable contract for when this is fixed.
      temperature: 0.3,
      maxOutputTokens: 2048, // stops runaway output fast
    },
  };

  // One time budget for all attempts. Gemini is slow under load (~50 s seen), so keep this under
  // the Vercel function limit but generous. Client timeout (askApi.js) must be a bit longer.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  // Busy (429/503) or gone (404): try the next model; after a full pass, wait and go again.
  let res;
  outer: for (let round = 0; round < 3; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, 1500 * round));
    for (const model of MODELS) {
      try {
        res = await fetch(urlFor(model), {
          signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(withThinking(body, model)),
        });
      } catch (e) {
        return { ok: false, error: e.name === 'TimeoutError' ? 'timed out' : 'could not reach Gemini' };
      }
      if (![404, 429, 503].includes(res.status)) break outer;
    }
  }
  if (!res.ok) return { ok: false, error: `Gemini HTTP ${res.status}` };

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') || '';
  let data;
  try {
    // Strip code fences in case the model adds them anyway.
    data = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
  } catch {
    return { ok: false, error: 'Gemini did not return valid JSON' };
  }
  return validateResponse(data);
}
