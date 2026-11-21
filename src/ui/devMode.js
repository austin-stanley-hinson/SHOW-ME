// Dev/test switches from the URL, so the renderer can be tested without Gemini or a camera.
//   ?fixture=chair | what | fold | fold-live | nothing   → answers come from api/fixtures/v3
//   &nocam=1                                             → no camera; a placeholder frame is frozen
//
// Fixtures are raw model output, so they go through the server's validator first (it resolves
// point ids to coordinates), exactly like a real /api/ask answer.
// Production use has no query string, so none of this is active.

import { validateResponse } from '../../api/_lib/validate.js';
import chair from '../../api/fixtures/v3/chair-tip.json';
import what from '../../api/fixtures/v3/what-is-this.json';
import fold from '../../api/fixtures/v3/fold-step1.json';
import foldLive from '../../api/fixtures/v3/fold-live-gemini.json';
import nothing from '../../api/fixtures/v3/nothing.json';

const FIXTURES = { chair, what, fold, 'fold-live': foldLive, nothing };
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

export const fixtureName = FIXTURES[params.get('fixture')] ? params.get('fixture') : null;
export const noCamera = params.get('nocam') === '1';

export function fixtureAnswer() {
  const v = validateResponse(structuredClone(FIXTURES[fixtureName]));
  const result = v.ok ? { ok: true, data: v.value } : { ok: false, error: v.error };
  return new Promise((resolve) => setTimeout(() => resolve(result), 1200));
}

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
