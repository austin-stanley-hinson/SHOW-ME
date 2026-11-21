// Calls Gemini with one image + one question and returns a contract-valid object.
// Used by api/ask.js (Vercel) and api/_dev/try.mjs (local testing).

import { SYSTEM_PROMPT } from './prompt.js';
import { validateResponse } from './validate.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// imageBase64: JPEG as base64, no "data:" prefix.
// Returns { ok: true, value } or { ok: false, error }.
export async function askGemini(imageBase64, question) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set' };

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: question }],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
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
