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

// ?fakelive=1 → a scripted stand-in for startLive() (src/client/live.js), same API, no network/mic.
// Lets the live UI be tested and screenshotted without a Gemini Live connection.
export const fakeLive = params.get('fakelive') === '1';

export function fakeStartLive({ pushToTalk = false, ...h }) {
  const chairV = validateResponse(structuredClone(chair)).value;
  const foldV = validateResponse(structuredClone(fold)).value;
  let scene = { items: [], points: [] };
  let closed = false;
  let watched = false;
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(() => !closed && fn(), ms));
  const speak = (start, text) => {
    const words = text.split(' ');
    words.forEach((_, i) => at(start + i * 140, () => h.onSaid?.(words.slice(0, i + 1).join(' '), i === words.length - 1)));
    at(start, () => h.onStatus?.('speaking'));
    at(start + words.length * 140 + 300, () => h.onStatus?.('listening'));
  };

  h.onStatus?.('connecting');
  at(700, () => h.onStatus?.('listening'));
  at(1200, () => h.onHeard?.('How hard can I push the backrest before it tips?'));
  at(1600, async () => {
    const { evaluateCalc } = await import('../physics/calc.js');
    scene = { items: chairV.draw, points: chairV.points || [] };
    h.onCalc?.({ sheet: chairV.calc, result: evaluateCalc(chairV.calc) });
  });
  speak(1700, 'Its weight holds it down around the rear feet. A push of about eight newtons at the top tips it.');
  at(2200, () => h.onGesture?.({ type: 'trace', target: chairV.draw.find((i) => i.type === 'arrow')?.id }));
  at(3600, () => h.onGesture?.({ type: 'pulse', target: chairV.draw.find((i) => i.type === 'circle')?.id }));
  // A spot the tracker followed out of the frame: must not be drawn or labelled (no pinning to the edge).
  at(4000, () => {
    scene = { ...scene, items: [...scene.items, { type: 'point', id: 'offscreen', at: [1.3, 0.4], label: 'SHOULD NOT SHOW EITHER' }] };
  });
  at(4600, () => {
    // v3.1 extras: a twisting arrow, the "point" gesture, and an item the tracker can't see (hidden).
    scene = {
      ...scene,
      items: [
        ...scene.items,
        { type: 'rotate', id: 'knob', at: [0.72, 0.3], r: 0.07, dir: 'ccw', label: 'Loosen' },
        { type: 'label', id: 'gone', at: [0.5, 0.5], label: 'SHOULD NOT SHOW', hidden: true },
      ],
    };
    h.onGesture?.({ type: 'point', target: 'knob' });
  });
  if (params.get('fakestep') === '1') {
    at(6000, () => h.onHeard?.('Now how do I fold it?'));
    at(6400, () => {
      scene = { items: foldV.draw, points: foldV.points || [] };
      h.onProcedure?.(foldV.procedure);
    });
    speak(6500, foldV.answer);
    at(7000, () => h.onGesture?.({ type: 'pulse', target: 'step1' }));
  }

  const t0 = performance.now();
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          say: (text) => {
            h.onHeard?.(text);
            speak(300, `(simulated) You said: ${text}`);
          },
          mute: () => {},
          // Hands-free step checking: pretend the AI noticed step 1 was done a few seconds in.
          watch: (on) => {
            if (on && params.get('fakestep') === '1' && !watched) {
              watched = true;
              at(3000, () => {
                speak(0, 'Nice, the seat is up. Step 2: press the hinge release.');
                h.onProcedure?.({ ...foldV.procedure, current: 2, done_when: 'The seat clicks into the folded position.' });
              });
            }
          },
          pushToTalk,
          talkStart: () => h.onStatus?.('listening'),
          talkEnd: () => {
            h.onHeard?.('(simulated) your spoken question');
            speak(400, '(simulated) Here is my answer.');
          },
          get scene() {
            return scene;
          },
          // Small drift stands in for the tracker moving drawings with the phone.
          trackedScene: () => {
            const dx = Math.sin((performance.now() - t0) / 1500) * 0.01;
            const move = (p) => (Array.isArray(p) ? [p[0] + dx, p[1]] : p);
            return {
              items: scene.items.map((i) => ({ ...i, at: move(i.at), from: move(i.from), to: move(i.to) })),
              points: scene.points,
              tracking: { quality: 1, lost: false },
            };
          },
          stop: () => {
            closed = true;
            timers.forEach(clearTimeout);
            h.onStatus?.('closed');
          },
        }),
      300,
    ),
  );
}
