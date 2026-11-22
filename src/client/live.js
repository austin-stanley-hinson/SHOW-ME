// Live session in the browser (lane B): streams the camera (~1 fps) and mic to Gemini Live, plays its voice,
// and turns its tool calls into scene updates via liveTools.js. Lane A renders the scene.
//
//   import { startLive } from './client/live.js';
//   const live = await startLive({ video,            // the <video> showing the camera (already playing)
//     onScene: (scene) => render(scene),             // { items, points } in contract coords
//     onGesture: (g) => animate(g),                  // { type, target }
//     onProcedure: (p) => showStep(p),
//     onCalc: ({ sheet, result }) => showMath(result),
//     onSaid: (text, final) => caption(text),        // what Gemini is saying (live transcript)
//     onHeard: (text) => showYou(text),              // what it heard you say
//     onStatus: (s) => setStatus(s),                 // 'connecting' | 'live' | 'speaking' | 'listening' | 'closed' | 'error: ...'
//   });                                              // MUST be called from a user tap (iOS audio rules)
//   live.say('typed question');  live.mute(true);  live.stop();
//   live.trackedScene()   // call every animation frame: the scene with positions moved to where those spots
//                         // are NOW in the camera view (optical-flow tracking); items get stale: true if lost.

import { createLiveTools } from './liveTools.js';
import { createSceneTracker } from '../tracking/sceneTracker.js';
import { createDebugLog } from './debugLog.js';
import { createParkDetector } from './parked.js';

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
const FRAME_MS = 1000;
const FRAME_MAX_SIDE = 768;
const MIC_RATE = 16000;
const OUT_RATE = 24000;

// AudioWorklet that forwards raw mic samples to the main thread.
const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('tap', Tap);`;

function b64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Float32 at `fromRate` -> 16-bit PCM at 16 kHz (simple averaging downsampler).
function toPcm16(float32, fromRate) {
  const ratio = fromRate / MIC_RATE;
  const n = Math.floor(float32.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(float32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += float32[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export async function startLive(opts) {
  const { pushToTalk = false } = opts;
  const { onParked = () => {} } = opts; // (parked: boolean) -> e.g. show "Phone down, still listening"
  const { video, onScene, onGesture, onProcedure, onCalc, onSaid, onHeard, onStatus = () => {}, onError = () => {} } = opts;
  const log = createDebugLog();
  let lastStatus = null;
  const status = (s) => {
    if (s === lastStatus) return; // audio chunks would otherwise repeat "speaking" dozens of times
    lastStatus = s;
    log.event('status', s);
    onStatus(s);
  };
  status('connecting');

  // Audio must be created inside the user's tap on iOS.
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  const ctx = new AC();
  await ctx.resume();

  const tokenRes = await fetch('/api/live-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushToTalk }),
  });
  if (!tokenRes.ok) throw new Error(`token: HTTP ${tokenRes.status}`);
  const { token, model: LIVE_MODEL_NAME } = await tokenRes.json();

  const tools = createLiveTools();

  // ---- tracking: keep drawings on the real spots as the phone moves (src/tracking/sceneTracker.js) ----
  const st = createSceneTracker(video);
  let lastSentFrameId = -1;
  // Re-finding: optical flow can't recover after a fast swing or when the object leaves the view, so
  // every few seconds the precise model re-locates each labelled thing on the newest frame. Things it
  // can't find are hidden instead of left on the wrong spot; they come back when they're in view again.
  const RESNAP_MS = 2500; // while the phone is still
  const RESNAP_MOVING_MS = 1200; // while it's moving: correct drift sooner
  // Per tracked frame at 320 px wide. 4-level flow is accurate up to ~28 px/frame; beyond that it fails AND
  // under-reports (a 40 px pan reads ~29), so 26 catches real swings while normal pans (19-23 px) stay visible.
  const BIG_MOTION_PX = 26;
  let lastResnap = 0;
  const snapTargets = new Map(); // id -> label
  const hidden = new Set(); // ids not visible right now (or unsure after a big motion)
  const pending = new Map(); // id -> timeout: waiting for the precise snap, not drawn yet
  const PENDING_MAX_MS = 3000;
  let resnapBusy = false;
  let calmSince = 0;
  const trackedScene = () => {
    const s = st.current(tools.scene);
    if (!hidden.size && !pending.size) return s;
    const off = (id) => hidden.has(id) || pending.has(id);
    return { ...s, items: s.items.map((i) => (off(i.id) || Object.values(i.refs || {}).some(off) ? { ...i, stale: true, hidden: true } : i)) };
  };
  const sentFrames = new Map(); // frameId -> base64 JPEG (last few), for precise-point lookups

  // Precise placement: ask /api/point where exactly each new thing is on the SAME frame, then snap to it.
  async function refinePositions(frameId, targets) {
    const image = sentFrames.get(frameId);
    if (!image || !targets.length) return;
    const t = Date.now();
    try {
      const r = await fetch('/api/point', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, targets }) });
      const j = await r.json();
      log.event('refine', { frameId, targets, result: j, ms: Date.now() - t });
      if (!r.ok || closed) return;
      for (const tg of targets) {
        snapTargets.set(tg.id, tg.label);
        clearTimeout(pending.get(tg.id));
        pending.delete(tg.id);
      }
      const found = new Set((j.points || []).map((p) => p.id));
      for (const tg of targets) (found.has(tg.id) ? hidden.delete(tg.id) : hidden.add(tg.id));
      if (!j.points?.length) return;
      const scene = tools.refine(j.points);
      st.place(scene, frameId);
      onScene?.(scene);
    } catch (e) {
      log.event('refine-error', String(e.message || e));
    }
  }
  const ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(token)}`);
  let closed = false;
  let muted = false;
  // ---- watching (hands-free): periodic auto-check turns while a procedure step is active ----
  const WATCH_EVERY_MS = 4000;
  // Only auto-check when the view has visibly changed since the step was given / last checked: in testing,
  // an unchanged frame once got a false "done" and the procedure advanced. Tiny grayscale thumbnails, mean
  // absolute difference 0-255.
  const CHANGE_MIN = 8;
  const thumbCanvas = document.createElement('canvas');
  let baseThumb = null;
  function thumb() {
    if (!video.videoWidth) return null;
    thumbCanvas.width = 32;
    thumbCanvas.height = 24;
    const c = thumbCanvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(video, 0, 0, 32, 24);
    const d = c.getImageData(0, 0, 32, 24).data;
    const g = new Uint8Array(32 * 24);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }
  const changeSince = (a, b) => {
    if (!a || !b) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };
  let watching = false;
  let step = null; // the latest procedure from the model
  let busy = false; // a turn is in progress (we asked, or the user spoke)
  let lastTurnEnd = Date.now();
  let autoTurn = null; // { audio: [], said: '', decided: null | 'speak' | 'quiet' } while an auto-check reply is held back
  let talking = false;
  let frameTimer = null;
  let micStream = null;
  let micNode = null;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));

  // ---- playback: queue 24 kHz PCM chunks back to back; stop all on interruption ----
  let playAt = 0;
  const playing = new Set();
  function play(b64) {
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    playAt = Math.max(playAt, ctx.currentTime + 0.05);
    src.start(playAt);
    playAt += buf.duration;
    playing.add(src);
    src.onended = () => {
      playing.delete(src);
      if (!playing.size) status('listening');
    };
    status('speaking');
  }
  function stopPlayback() {
    for (const s of playing) try { s.stop(); } catch {}
    playing.clear();
    playAt = 0;
  }

  // ---- camera frames ----
  const frameCanvas = document.createElement('canvas');
  function sendFrame() {
    if (!video.videoWidth || parked) return; // phone down: don't stream the ceiling / the table
    lastSentFrameId = st.mark(); // the tracker's frame == the frame Gemini is about to see
    sendFrameImage(lastSentFrameId);
  }
  function sendFrameImage(frameId) {
    if (!video.videoWidth) return;
    const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    frameCanvas.width = Math.round(video.videoWidth * scale);
    frameCanvas.height = Math.round(video.videoHeight * scale);
    frameCanvas.getContext('2d').drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    const data = frameCanvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    send({ realtimeInput: { video: { data, mimeType: 'image/jpeg' } } });
    sentFrames.set(frameId, data);
    if (sentFrames.size > 6) sentFrames.delete(sentFrames.keys().next().value);
    log.frame(frameId, data);
  }

  // ---- microphone ----
  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const srcNode = ctx.createMediaStreamSource(micStream);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    micNode = new AudioWorkletNode(ctx, 'tap');
    let pending = [];
    let pendingLen = 0;
    micNode.port.onmessage = (e) => {
      if (muted || (pushToTalk && !talking)) return;
      pending.push(e.data);
      pendingLen += e.data.length;
      if (pendingLen < ctx.sampleRate / 10) return; // send ~100 ms chunks
      const all = new Float32Array(pendingLen);
      let o = 0;
      for (const p of pending) all.set(p, o), (o += p.length);
      pending = [];
      pendingLen = 0;
      const pcm = toPcm16(all, ctx.sampleRate);
      send({ realtimeInput: { audio: { data: b64FromBytes(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${MIC_RATE}` } } });
    };
    srcNode.connect(micNode);
  }

  // ---- messages ----
  let said = '';
  ws.onopen = () => send({ setup: {} }); // the locked setup from the token applies
  ws.onmessage = async (ev) => {
    const text = typeof ev.data === 'string' ? ev.data : await ev.data.text();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (m.setupComplete) {
      status('live');
      sendFrame();
      frameTimer = setInterval(sendFrame, FRAME_MS);
      st.start();
      startMic().catch((e) => onError(new Error('microphone: ' + e.message)));
      return;
    }
    if (m.toolCall) {
      // Step advances are checked by an independent verifier first (see verifyAdvance). procedure is a blocking
      // tool, so the model waits for this reply before speaking: a rejected advance never gets a "Great!".
      const verdicts = new Map();
      // plan: fetch expert steps for the task (several seconds) and start the procedure from them.
      // plan runs in the background (non-blocking, no reply): the model keeps talking, and the checked steps are
      // delivered as an [app] note when ready. (Blocking on it left the model silent for ~13 s and it never resumed.)
      for (const fc of m.toolCall.functionCalls) {
        if (fc.name === 'plan') planInBackground(fc.args?.task);
      }
      // Fill a step advance's missing details from the plan (the plan's done_when is far better).
      for (const fc of m.toolCall.functionCalls) {
        if (fc.name !== 'procedure' || !plan) continue;
        const k = fc.args?.current;
        const ps = Number.isInteger(k) ? plan.steps[k - 1] : null;
        if (ps) fc.args = { ...fc.args, title: fc.args.title || plan.title, total: plan.steps.length, done_when: ps.done_when, ...(ps.mistake && !fc.args.safety && { safety: [ps.mistake] }) };
      }
      for (const fc of m.toolCall.functionCalls) {
        if (!isAdvance(fc)) continue;
        // The user can override: if they insist the same step is done after one rejection (not during a silent
        // auto-check), let it through: the verifier is there to stop false "great!"s, not to block people.
        if (!autoTurn && rejectedStep === step.current) {
          log.event('verify-override', step.current);
          rejectedStep = null;
          continue;
        }
        const v = await verifyAdvance();
        verdicts.set(fc, v);
        if (v && !v.done && !autoTurn) rejectedStep = step.current;
        if (v?.done) rejectedStep = null;
      }
      if (autoTurn) {
        const names = m.toolCall.functionCalls.map((fc) => fc.name);
        const rejected = [...verdicts.values()].some((v) => v && !v.done);
        // On a pickup the user is showing their work: real feedback must be heard even if the model also calls
        // wait (it said "The seat is still down. Please lift it up." and called wait in the same turn). The
        // turn-complete check below keeps it only if it's substantive.
        if (names.includes('wait') && autoTurn.kind !== 'pickup-check') autoTurn.decided = 'quiet';
        else if (rejected && autoTurn.kind === 'watch-check') autoTurn.decided = 'quiet'; // mid-step: stay quiet
        else if (names.some((n) => ['procedure', 'show', 'gesture', 'remove', 'calc'].includes(n))) releaseAutoTurn();
      }
      const functionResponses = m.toolCall.functionCalls.map((fc) => {
        const v = verdicts.get(fc);
        if (v && !v.done) {
          log.event('verify-rejected', { args: fc.args, evidence: v.evidence });
          const quiet = autoTurn?.kind === 'watch-check';
          return {
            id: fc.id,
            name: fc.name,
            response: {
              rejected: true,
              reason: `Step ${step.current} is not done yet. An independent check of the newest frame says: "${v.evidence}"`,
              instruction: quiet
                ? 'Stay on the current step. Call wait and say nothing.'
                : 'Stay on the current step. Tell the user briefly what you see and what is still needed (show where).',
            },
          };
        }
        if (v) log.event('verify-ok', { args: fc.args, evidence: v.evidence });
        if (fc.name === 'plan') return { id: fc.id, name: fc.name, response: { started: true } };
        const { response, update } = tools.handle(fc);
        log.event('tool', { name: fc.name, args: fc.args, response, frameId: lastSentFrameId });
        if (update?.scene) {
          st.place(update.scene, lastSentFrameId);
          onScene?.(update.scene);
          if (fc.name === 'show') {
            const pointIds = (fc.args?.points || []).map((p) => p?.id).filter(Boolean);
            const targets = tools.targetsFor(response.shown || [], pointIds);
            if (fc.args?.clear) {
              for (const id of snapTargets.keys()) if (!targets.some((t) => t.id === id)) snapTargets.delete(id);
            }
            for (const t of targets) {
              clearTimeout(pending.get(t.id));
              pending.set(t.id, setTimeout(() => pending.delete(t.id), PENDING_MAX_MS));
            }
            // First snap: search the whole frame by label. The live model's guess is NOT passed as a hint: it was
            // usually wrong and steered the snap (it called the backrest corners "folding hinge"; unhinted, the
            // snap found the real pivots). Re-snaps later use tracked positions of already-precise drawings.
            refinePositions(lastSentFrameId, targets.map(({ at, ...t }) => t));
          }
        }
        if (fc.name === 'show' && response.shown?.length) turnDrew.push(...(fc.args?.items || []).filter((i) => response.shown.includes(i.id)).map((i) => i.label || i.id));
        if (update?.gesture) onGesture?.(update.gesture);
        if (update?.procedure) {
          step = update.procedure;
          baseThumb = thumb(); // what the scene looked like when this step was given
          onProcedure?.(update.procedure);
        }
        if (update?.wait) log.event('watch-quiet', update.wait.seen);
        if (update?.calc) onCalc?.(update.calc);
        return { id: fc.id, name: fc.name, response };
      });
      // wait is non-blocking and gets NO reply: replying makes the model continue and call wait again (it looped
      // about once a second in testing). Without a reply it calls wait once per auto-check and stays silent.
      // show / gesture / remove are non-blocking and only answered when something went wrong (answering every
      // one made the model repeat its last sentence).
      const quietOk = (r) => ['show', 'gesture', 'remove'].includes(r.name) && !r.response?.error && !r.response?.dropped?.length;
      const replies = functionResponses.filter((r) => r.name !== 'wait' && r.name !== 'plan' && !quietOk(r));
      if (replies.length) send({ toolResponse: { functionResponses: replies } });
    }
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        stopPlayback();
        said = '';
      }
      if (sc.modelTurn) busy = true;
      if (sc.modelTurn?.parts?.some((p) => p.inlineData?.data)) (lastSpokeAt = Date.now()), (turnSpoke = true);
      for (const p of sc.modelTurn?.parts || []) {
        if (!p.inlineData?.data) continue;
        if (autoTurn && autoTurn.decided !== 'speak') {
          if (autoTurn.decided !== 'quiet') autoTurn.audio.push(p.inlineData.data); // hold until we know
        } else play(p.inlineData.data);
      }
      if (sc.turnComplete && said) log.event('said', said);
      if (sc.outputTranscription?.text) {
        said += sc.outputTranscription.text;
        if (!autoTurn || autoTurn.decided === 'speak') onSaid?.(said, false);
      }
      if (sc.inputTranscription?.text) {
        log.event('heard', sc.inputTranscription.text);
        onHeard?.(sc.inputTranscription.text);
      }
      if (sc.turnComplete) {
        // Drew but didn't say anything (show gets no reply, so the turn can just end): ask for one short
        // spoken explanation of what's on screen. Not for silent app turns.
        if (turnDrew.length && !turnSpoke && !autoTurn && !closed) {
          const labels = [...new Set(turnDrew)].slice(0, 6).join(', ');
          log.event('narrate-nudge', labels);
          setTimeout(() => send({ realtimeInput: { text: `[app] Your drawings are on screen (${labels}). Now tell the user briefly, out loud, what they show.` } }), 100);
        }
        turnDrew = [];
        turnSpoke = false;
        if (autoTurn) {
          // No tool decided it: speak only if it actually said something substantive.
          const meaningful = said.trim().length > 20 && !/^(ok|okay|alright|all right|mm+|hmm+|got it)\b/i.test(said.trim());
          if (autoTurn.decided === 'quiet' || (autoTurn.decided === null && !meaningful)) {
            log.event('watch-dropped', said);
            said = '';
          } else releaseAutoTurn();
          autoTurn = null;
        }
        if (said) onSaid?.(said, true);
        said = '';
        busy = false;
        lastTurnEnd = Date.now();
      }
    }
    if (m.goAway) status('closing soon');
  };
  ws.onerror = () => onError(new Error('connection error'));
  ws.onclose = (e) => {
    closed = true;
    cleanup();
    status(e.code === 1000 ? 'closed' : `error: ${e.code} ${e.reason || ''}`.trim());
  };

  function releaseAutoTurn() {
    if (!autoTurn || autoTurn.decided === 'speak') return;
    autoTurn.decided = 'speak';
    for (const a of autoTurn.audio) play(a);
    autoTurn.audio = [];
    if (said) onSaid?.(said, false);
  }
  // ---- expert task plan (api/plan.js) ----
  let plan = null; // { title, object, steps: [{ n, say, part, motion, done_when, mistake }] }
  let lastSpokeAt = 0; // when the model last sent audio (for the plan nudge)
  let turnDrew = []; // labels drawn in the current model turn
  let turnSpoke = false; // whether the current model turn produced any audio
  let rejectedStep = null; // step number whose advance the verifier just rejected (for the user override)
  // Fetch the plan, then hand it to the model as an [app] note once nobody is talking.
  async function planInBackground(task) {
    // The model tends to go quiet until the plan arrives (~10 s). If it hasn't started speaking 2 s after
    // calling plan, nudge it to talk the user through the first step in its own words meanwhile.
    const saidAtCall = lastSpokeAt;
    setTimeout(() => {
      if (closed || lastSpokeAt !== saidAtCall || talking || playing.size) return;
      log.event('plan-nudge', task);
      busy = true;
      send({ realtimeInput: { text: '[app] The expert check is running (about 10 seconds). Meanwhile, talk the user through the first step now, in your own words.' } });
    }, 2000);
    const result = await fetchPlan(task);
    if (closed || !plan) return;
    const lines = plan.steps.map((s) => `${s.n}) ${s.say}${s.mistake ? ' (watch out: ' + s.mistake + ')' : ''}`).join(' ');
    const note = `[app] Expert-checked steps for "${task}": ${lines} Continue guiding from where you are, one step at a time, in your own words; correct anything you said that conflicts. The procedure is set to step 1.`;
    const deliver = (tries) => {
      if (closed) return;
      if ((busy || talking || playing.size || autoTurn) && tries > 0) return setTimeout(() => deliver(tries - 1), 400);
      busy = true;
      log.event('plan-note', note);
      send({ realtimeInput: { text: note } });
    };
    deliver(30);
    return result;
  }
  async function fetchPlan(task) {
    lastSentFrameId = st.mark();
    sendFrameImage(lastSentFrameId);
    const image = sentFrames.get(lastSentFrameId);
    const t = Date.now();
    try {
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, task: String(task || 'the task the user asked about') }),
        signal: AbortSignal.timeout(25000),
      });
      const j = await r.json();
      log.event('plan', { task, result: j, ms: Date.now() - t });
      if (!r.ok || !j.steps?.length) return { error: 'No plan available; guide carefully from what you can see.' };
      plan = j;
      // Start the procedure from the plan (step 1), so the UI and the checks use the expert's done_when.
      const first = j.steps[0];
      const { update } = tools.handle({ name: 'procedure', args: { title: j.title, current: 1, total: j.steps.length, done_when: first.done_when, ...(first.mistake && { safety: [first.mistake] }) } });
      if (update?.procedure) {
        step = update.procedure;
        baseThumb = thumb();
        onProcedure?.(update.procedure);
      }
      return {
        object: j.object,
        steps: j.steps,
        instruction: 'Teach these steps one at a time, in order, using the "say" wording. Say step 1 now and draw its part and motion. Then stop and let the user do it. The procedure is already set to step 1.',
      };
    } catch {
      log.event('plan-error', task);
      return { error: 'No plan available; guide carefully from what you can see.' };
    }
  }

  // ---- independent step verification ----
  const isAdvance = (fc) =>
    fc.name === 'procedure' && step && !step.complete && step.done_when &&
    ((Number.isInteger(fc.args?.current) && fc.args.current > step.current) || fc.args?.complete === true);
  async function verifyAdvance() {
    // Look at the very latest view: send a fresh frame (also seen by the model) and verify on it.
    lastSentFrameId = st.mark();
    sendFrameImage(lastSentFrameId);
    const image = sentFrames.get(lastSentFrameId);
    const t = Date.now();
    try {
      const r = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, condition: step.done_when }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      log.event('verify', { condition: step.done_when, result: j, ms: Date.now() - t });
      if (!r.ok) return null; // verifier unavailable: don't block the user
      return j;
    } catch {
      return null;
    }
  }

  // An app-generated turn whose reply is held back: released if the model acts or says something
  // substantive, dropped if it calls wait or just acknowledges.
  function sendAppTurn(text, kind) {
    autoTurn = { audio: [], decided: null, kind };
    busy = true;
    log.event(kind, text);
    send({ realtimeInput: { text } });
    setTimeout(() => {
      if (autoTurn && busy) {
        autoTurn = null;
        busy = false;
        lastTurnEnd = Date.now();
      }
    }, 15000);
  }

  // ---- phone put down / picked back up ("sloppy FaceTime" use) ----
  let parked = false;
  const park = createParkDetector({
    onPark() {
      parked = true;
      log.event('park', true);
      onParked(true);
      hidden.clear(); // drawings come back via the pickup re-snap
      for (const id of snapTargets.keys()) hidden.add(id);
      if (!busy && !talking) sendAppTurn('[app] The phone was put down; the camera is pointing away from the work. Keep listening and answer by voice; don\'t comment on the camera view until it is picked back up. Call wait now.', 'park-notice');
    },
    onPickup(why) {
      parked = false;
      log.event('pickup', why);
      onParked(false);
      // Let the camera settle, then look: fresh frame, re-find drawings, and give feedback on the step.
      setTimeout(() => {
        if (closed || parked) return;
        sendFrame();
        resnap();
        if (!step || step.complete) return;
        const tryCheck = (tries) => {
          if (closed || parked) return;
          if (busy || talking || playing.size || autoTurn) return tries > 0 && setTimeout(() => tryCheck(tries - 1), 500);
          baseThumb = thumb();
          sendAppTurn(`[app] The phone was picked back up and pointed at the work. Look at the newest frame. If you can see the task, check it against step ${step.current}${step.done_when ? ' (done when: ' + step.done_when + ')' : ''} and give short spoken feedback: if it's done, confirm and give the next step via procedure; if it's not done yet or done wrong, say what you see and what's still needed, and show where. Only if the task isn't in view at all, call wait.`, 'pickup-check');
        };
        setTimeout(() => tryCheck(10), 600); // a second frame has been sent by then
      }, 800);
    },
  });
  const onOrient = (e) => park.orientation(e.beta, e.gamma, performance.now());
  const onMotion = (e) => park.motion(e.accelerationIncludingGravity, performance.now());
  addEventListener('deviceorientation', onOrient);
  addEventListener('devicemotion', onMotion);

  const watchTimer = setInterval(() => {
    if (!watching || closed || busy || talking || playing.size || autoTurn || parked) return;
    if (!step || step.complete) return;
    if (Date.now() - lastTurnEnd < WATCH_EVERY_MS) return;
    if (st.tracker.motion > 6) return; // wait for the view to settle
    const now = thumb();
    const changed = changeSince(baseThumb, now);
    if (changed < CHANGE_MIN) return; // nothing visibly happened: no point asking (and no false "done")
    baseThumb = now; // next check needs a further change
    const check = `[auto-check] Step ${step.current}${step.total ? ' of ' + step.total : ''}${step.done_when ? ': done when ' + step.done_when : ''}.`;
    sendAppTurn(check, 'watch-check');
  }, 1000);

  function cleanup() {
    clearInterval(watchTimer);
    removeEventListener('deviceorientation', onOrient);
    removeEventListener('devicemotion', onMotion);
    clearInterval(sampleTimer);
    clearInterval(resnapTimer);
    clearInterval(motionTimer);
    clearInterval(frameTimer);
    st.stop();
    stopPlayback();
    micNode?.disconnect();
    micStream?.getTracks().forEach((t) => t.stop());
  }

  // Sample where the tracker shows each drawing, twice a second, for the debug report.
  // Periodic re-snap, plus an immediate one once the phone steadies after a big motion.
  async function resnap() {
    if (resnapBusy || closed || !snapTargets.size) return;
    const s = trackedScene();
    const live = new Set([...s.items.map((i) => i.id), ...s.points.map((p) => p.id)]);
    for (const id of snapTargets.keys()) if (!live.has(id)) snapTargets.delete(id);
    if (!snapTargets.size) return;
    const where = (id) => s.points.find((p) => p.id === id)?.at || s.items.find((i) => i.id === id)?.at || s.items.find((i) => i.id === id)?.to;
    const targets = [...snapTargets].map(([id, label]) => ({ id, label, ...(Array.isArray(where(id)) && !hidden.has(id) && { at: where(id) }) }));
    resnapBusy = true;
    try {
      lastSentFrameId = st.mark();
      sendFrameImage(lastSentFrameId); // a fresh frame for the lookup (also seen by the model)
      await refinePositions(lastSentFrameId, targets);
    } finally {
      resnapBusy = false;
    }
  }
  let movingUntil = 0;
  const resnapTimer = setInterval(() => {
    const every = Date.now() < movingUntil ? RESNAP_MOVING_MS : RESNAP_MS;
    if (Date.now() - lastResnap >= every) {
      lastResnap = Date.now();
      resnap();
    }
  }, 200);
  const motionTimer = setInterval(() => {
    const m = st.tracker.motion;
    if (m > 4 && m < Infinity) movingUntil = Date.now() + 800;
    if (m > BIG_MOTION_PX) {
      // Fast swing: flow is unreliable. Hide everything until it's re-found.
      if (!calmSince) log.event('big-motion', Math.round(m));
      for (const id of snapTargets.keys()) hidden.add(id);
      calmSince = -1;
    } else if (calmSince === -1 && m < 4) {
      calmSince = Date.now();
    } else if (calmSince > 0 && Date.now() - calmSince > 300) {
      calmSince = 0;
      resnap();
    }
  }, 100);

  const sampleTimer = setInterval(() => {
    const s = trackedScene();
    if (!s.items.length) return;
    log.event('tracked', {
      quality: Math.round(s.tracking.quality * 100) / 100,
      lost: s.tracking.lost,
      items: s.items.map((i) => ({ id: i.id, at: i.at, from: i.from, to: i.to, stale: i.stale || undefined })),
      points: s.points,
    });
  }, 500);

  return {
    // Everything from the last ~90 s as a JSON-able object (frames stay on the phone until shared).
    debugReport: (extra) => log.report({ model: LIVE_MODEL_NAME, video: { w: video.videoWidth, h: video.videoHeight }, ...extra }),
    say(text) {
      log.event('typed', text);
      busy = true;
      if (text) send({ realtimeInput: { text } });
    },
    // Push-to-talk: call talkStart() when the button goes down and talkEnd() when it comes up.
    // Hands-free: while on and a procedure step is active, the model checks the camera every few seconds,
    // confirms finished steps / warns about mistakes, and otherwise stays silent.
    // true while the phone is lying flat and still (frames paused, mic still open).
    get parked() {
      return parked;
    },
    watch(on) {
      watching = Boolean(on);
      log.event('watch', watching);
    },
    get watching() {
      return watching;
    },
    talkStart() {
      if (!pushToTalk || talking) return;
      if (autoTurn) {
        autoTurn.decided = 'quiet'; // the user talking wins over a held-back auto-check reply
        autoTurn = null;
      }
      talking = true;
      busy = true;
      stopPlayback(); // talking over the assistant interrupts it
      send({ realtimeInput: { activityStart: {} } });
      log.event('talk', 'start');
    },
    talkEnd() {
      if (!pushToTalk || !talking) return;
      talking = false;
      setTimeout(() => send({ realtimeInput: { activityEnd: {} } }), 150); // let the last mic chunk go out
      log.event('talk', 'end');
    },
    pushToTalk,
    mute(on) {
      muted = Boolean(on);
    },
    get scene() {
      return tools.scene;
    },
    trackedScene,
    stop() {
      if (closed) return;
      ws.close(1000);
      cleanup();
      ctx.close();
    },
  };
}
