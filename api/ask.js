// POST /api/ask  { image: "<base64 JPEG, no data: prefix>", question: "...", previous?: { question, response } }
// 200 -> contract JSON (CONTRACT.md).  4xx/5xx -> { error: "..." }.
// The camera frame is never stored or logged.

import { askGemini } from './_lib/gemini.js';

// Gemini can take ~50 s under load; give the function room (Vercel caps by plan).
export const maxDuration = 60;

const MAX_IMAGE_CHARS = 4_000_000; // Vercel body limit is ~4.5 MB; keep frames ~1024px JPEG.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { image, question, previous } = req.body || {};
  if (typeof image !== 'string' || !image) return res.status(400).json({ error: 'missing image' });
  if (image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'image too large' });
  if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'missing question' });

  const result = await askGemini(image.replace(/^data:image\/\w+;base64,/, ''), question.slice(0, 500), previous);
  if (!result.ok) {
    console.error('ask failed:', result.error); // error text only, never the image
    return res.status(result.status || (result.error === 'timed out' ? 504 : 502)).json({ error: result.error });
  }
  return res.status(200).json(result.value);
}
