// Shared live sessions (lane B). Teammates on any device see the same world document,
// and any input change re-runs the calc everywhere.
//
//   import { createSession, joinSession } from './client/session.js';
//   const id = await createSession(data);                  // phone, after an answer: share link = ?s=<id>
//   const s = joinSession(id, ({ doc, inputs }) => {        // every device, including the creator
//     const result = evaluateCalc(doc.calc, null, inputs);  // inputs = live overrides { name: { value, by } }
//     render(doc, result);
//   });
//   s.setInput('m_person', 120, 'austin');                  // a slider moved
//   s.setDoc(newData);                                      // a new AI answer replaces the model
//   s.close();
//
// The relay URL comes from VITE_SESSION_URL (not a secret). Camera frames are never sent here.

const BASE = (import.meta.env?.VITE_SESSION_URL || '').replace(/\/$/, '');

const stripImage = (doc) => {
  const { image, ...rest } = doc || {};
  return rest;
};

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`session ${res.status}`);
  return res.json();
}

export const sessionsEnabled = () => Boolean(BASE);

export async function createSession(doc) {
  const { id } = await post('/s', { doc: stripImage(doc) });
  return id;
}

// onState({ doc, inputs, version }) fires on connect and on every change. EventSource reconnects by itself.
export function joinSession(id, onState) {
  const es = new EventSource(`${BASE}/s/${encodeURIComponent(id)}/events`);
  let last = -1;
  es.addEventListener('state', (e) => {
    const state = JSON.parse(e.data);
    if (state.version < last) return; // ignore stale replays
    last = state.version;
    onState(state);
  });
  // Coalesce slider drags: at most one POST per animation frame per input.
  const pending = new Map();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    for (const [name, { value, by }] of pending) post(`/s/${id}`, { type: 'input', name, value, by }).catch(() => {});
    pending.clear();
  };
  return {
    setInput(name, value, by) {
      pending.set(name, { value, by });
      if (!scheduled) {
        scheduled = true;
        (globalThis.requestAnimationFrame || setTimeout)(flush);
      }
    },
    setDoc: (doc) => post(`/s/${id}`, { type: 'doc', doc: stripImage(doc) }),
    close: () => es.close(),
  };
}
