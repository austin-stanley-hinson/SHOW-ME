// Dev/test switches from the URL, so the renderer can be tested without Gemini or a camera.
//   ?fixture=speaker | tripod   → answers come from api/fixtures (no network, no key)
//   &nocam=1                    → no camera; a placeholder frame is frozen right away
//
// Production use has no query string, so none of this is active.

import speaker from '../../api/fixtures/speaker.json';
import tripod from '../../api/fixtures/tripod.json';

const FIXTURES = { speaker, tripod };
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

export const fixtureName = FIXTURES[params.get('fixture')] ? params.get('fixture') : null;
export const noCamera = params.get('nocam') === '1';

export function fixtureAnswer() {
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: FIXTURES[fixtureName] }), 1200));
}

// A neutral stand-in for a camera frame, sized like the screen.
export function placeholderFrame(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#3a3a3c');
  g.addColorStop(1, '#1c1c1e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 1; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo((w * i) / 10, 0);
    ctx.lineTo((w * i) / 10, h);
    ctx.moveTo(0, (h * i) / 10);
    ctx.lineTo(w, (h * i) / 10);
    ctx.stroke();
  }
  return c;
}
