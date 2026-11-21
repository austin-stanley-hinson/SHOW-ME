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
const TIMEOUT_MS = 60_000; // a bit longer than the server's 55 s Gemini budget
const MAX_SIDE = 768; // px; smaller upload for venue Wi-Fi (issue #11). TODO: confirm point accuracy on device.

// canvas: an HTMLCanvasElement holding exactly what the user sees (same crop as the screen).
// previous (optional): { question, response } from the last successful ask.
// audio (optional): a Blob from MediaRecorder (iOS Safari records audio/mp4). Then question may be ''.
export async function ask(canvas, question, previous = null, audio = null) {
  if (USE_FIXTURE) return { ok: true, data: speakerFixture };

  let res;
  try {
    res = await fetch('/api/ask', {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: toJpegBase64(canvas),
        question: question || '',
        ...(previous && { previous }),
        ...(audio && { audio: await blobToBase64(audio), audio_mime: audio.type || 'audio/mp4' }),
      }),
    });
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'timed out' : 'network error' };
  }

  // Vercel error pages (413, 504) are HTML, not JSON.
  let data = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    try {
      data = await res.json();
    } catch {}
  }
  if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
  if (!data) return { ok: false, error: 'bad response' };
  return { ok: true, data };
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
  return src.toDataURL('image/jpeg', 0.7).split(',')[1];
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
