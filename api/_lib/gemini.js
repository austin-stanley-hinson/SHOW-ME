// Calls Gemini with one image + one question and returns a contract-valid object.
// Used by api/ask.js (Vercel) and api/_dev/try.mjs (local testing).

import { SYSTEM_PROMPT } from './prompt.js';
import { validateResponse } from './validate.js';
import { RESPONSE_SCHEMA } from './schema.js';

// Tried in order; the next one is used if a model is busy (429/503) or gone (404).
const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-3.6-flash', 'gemini-flash-latest']; // not lite: it produced runaway output in testing
const TIMEOUT_MS = 55_000;
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
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
      maxOutputTokens: 2048, // stops runaway output fast
      thinkingConfig: { thinkingLevel: 'minimal' }, // faster; we only need positions + estimates
    },
  };

  // One time budget for all attempts. Gemini is slow under load (~50 s seen), so keep this under
  // the Vercel function limit but generous. Client timeout (askApi.js) must be a bit longer.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res;
  for (const model of MODELS) {
    try {
      res = await fetch(urlFor(model), {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, error: e.name === 'TimeoutError' ? 'timed out' : 'could not reach Gemini' };
    }
    if (![404, 429, 503].includes(res.status)) break;
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
