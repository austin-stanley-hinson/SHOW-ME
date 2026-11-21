// Calls Gemini with one image + one question and returns a contract-valid object.
// Used by api/ask.js (Vercel) and api/_dev/try.mjs (local testing).

import { SYSTEM_PROMPT } from './prompt.js';
import { validateResponse } from './validate.js';
import { RESPONSE_SCHEMA } from './schema.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// imageBase64: JPEG as base64, no "data:" prefix.
// previous (optional): { question, response } from the last turn, so follow-up answers have context.
// Returns { ok: true, value } or { ok: false, error }.
export async function askGemini(imageBase64, question, previous = null) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set' };

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
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: question }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  };

  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'could not reach Gemini' };
  }
  if (!res.ok) return { ok: false, error: `Gemini HTTP ${res.status}` };

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let data;
  try {
    // Strip code fences in case the model adds them anyway.
    data = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
  } catch {
    return { ok: false, error: 'Gemini did not return valid JSON' };
  }
  return validateResponse(data);
}
