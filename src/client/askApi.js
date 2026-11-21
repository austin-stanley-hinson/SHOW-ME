// Browser-side wrapper for POST /api/ask. Lane B owns this; Lane A calls it.
//
//   import { ask } from './client/askApi.js';
//   const result = await ask(canvas, 'Why isn't it falling?');
//   if (result.ok) render(result.data) else showCaption(result.error);
//
// Follow-ups: pass the last turn so Gemini knows what "drywall" is answering:
//   await ask(canvas, 'drywall', { question: lastQuestion, response: lastData });
//
// Set USE_FIXTURE = true to get the speaker example without calling Gemini (no key needed).

import speakerFixture from '../../api/fixtures/speaker.json';

const USE_FIXTURE = false;
const MAX_SIDE = 1024; // px; keeps the upload small and fast

// canvas: an HTMLCanvasElement holding exactly what the user sees (same crop as the screen).
// previous (optional): { question, response } from the last successful ask.
export async function ask(canvas, question, previous = null) {
  if (USE_FIXTURE) return { ok: true, data: speakerFixture };

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: toJpegBase64(canvas), question, ...(previous && { previous }) }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

function toJpegBase64(canvas) {
  const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  let src = canvas;
  if (scale < 1) {
    src = document.createElement('canvas');
    src.width = Math.round(canvas.width * scale);
    src.height = Math.round(canvas.height * scale);
    src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height);
  }
  return src.toDataURL('image/jpeg', 0.8).split(',')[1];
}
