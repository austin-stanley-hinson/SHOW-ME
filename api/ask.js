// POST /api/ask  { image: "<base64 JPEG, no data: prefix>", question: "...", previous?: { question, response } }
// 200 -> contract JSON (CONTRACT.md).  4xx/5xx -> { error: "..." }.
// The camera frame is never stored or logged.

import { askModel } from './_lib/model.js';

// Gemini can take ~50 s under load; give the function room (Vercel caps by plan).
export const maxDuration = 60;

const MAX_AUDIO_CHARS = 1_400_000; // ~1 MB of audio, ~60 s of compressed speech
const AUDIO_MIME = /^audio/(mp4|m4a|x-m4a|aac|mpeg|mp3|wav|x-wav|webm|ogg)(;.*)?$/;
const MAX_IMAGE_CHARS = 2_800_000; // Vercel body limit is ~4.5 MB; keep frames ~1024px JPEG.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { image, question, previous, audio, audio_mime } = req.body || {};
  // Optional spoken question: base64 audio (no data: prefix). Gemini hears it directly; no separate speech-to-text.
  const hasAudio = typeof audio === 'string' && audio.length > 0;
  if (hasAudio && audio.length > MAX_AUDIO_CHARS) return res.status(413).json({ error: 'audio too long' });
  if (hasAudio && !AUDIO_MIME.test(audio_mime || '')) return res.status(400).json({ error: 'unsupported audio type' });
  if (typeof image !== 'string' || !image) return res.status(400).json({ error: 'missing image' });
  if (image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'image too large' });
  const text = typeof question === 'string' ? question.trim() : '';
  if (!text && !hasAudio) return res.status(400).json({ error: 'missing question' });

  const result = await askModel(image.replace(/^data:image\/\w+;base64,/, ''), text.slice(0, 500), previous, 'image/jpeg', hasAudio ? { data: audio.replace(/^data:[^,]+,/, ''), mimeType: audio_mime.split(';')[0] } : null);
  if (!result.ok) {
    console.error('ask failed:', result.error); // error text only, never the image
    return res.status(result.status || (result.error === 'timed out' ? 504 : 502)).json({ error: result.error });
  }
  return res.status(200).json(result.value);
}
