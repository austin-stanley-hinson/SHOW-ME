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

  const tokenRes = await fetch('/api/live-token', { method: 'POST' });
  if (!tokenRes.ok) throw new Error(`token: HTTP ${tokenRes.status}`);
  const { token, model: LIVE_MODEL_NAME } = await tokenRes.json();

  const tools = createLiveTools();

  // ---- tracking: keep drawings on the real spots as the phone moves (src/tracking/sceneTracker.js) ----
  const st = createSceneTracker(video);
  let lastSentFrameId = -1;
  // Re-finding: optical flow can't recover after a fast swing or when the object leaves the view, so
  // every few seconds the precise model re-locates each labelled thing on the newest frame. Things it
  // can't find are hidden instead of left on the wrong spot; they come back when they're in view again.
  const RESNAP_MS = 2500;
  const snapTargets = new Map(); // id -> label
  const hidden = new Set(); // ids not visible right now (or unsure after a big motion)
  let resnapBusy = false;
  let calmSince = 0;
  const trackedScene = () => {
    const s = st.current(tools.scene);
    if (!hidden.size) return s;
    return { ...s, items: s.items.map((i) => (hidden.has(i.id) || Object.values(i.refs || {}).some((r) => hidden.has(r)) ? { ...i, stale: true, hidden: true } : i)) };
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
      for (const tg of targets) snapTargets.set(tg.id, tg.label);
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
    if (!video.videoWidth) return;
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
      if (muted) return;
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
      const functionResponses = m.toolCall.functionCalls.map((fc) => {
        const { response, update } = tools.handle(fc);
        log.event('tool', { name: fc.name, args: fc.args, response, frameId: lastSentFrameId });
        if (update?.scene) {
          st.place(update.scene, lastSentFrameId);
          onScene?.(update.scene);
          if (fc.name === 'show') {
            const pointIds = (fc.args?.points || []).map((p) => p?.id).filter(Boolean);
            refinePositions(lastSentFrameId, tools.targetsFor(response.shown || [], pointIds));
          }
        }
        if (update?.gesture) onGesture?.(update.gesture);
        if (update?.procedure) onProcedure?.(update.procedure);
        if (update?.calc) onCalc?.(update.calc);
        return { id: fc.id, name: fc.name, response };
      });
      send({ toolResponse: { functionResponses } });
    }
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        stopPlayback();
        said = '';
      }
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) play(p.inlineData.data);
      if (sc.turnComplete && said) log.event('said', said);
      if (sc.outputTranscription?.text) {
        said += sc.outputTranscription.text;
        onSaid?.(said, false);
      }
      if (sc.inputTranscription?.text) {
        log.event('heard', sc.inputTranscription.text);
        onHeard?.(sc.inputTranscription.text);
      }
      if (sc.turnComplete && said) {
        onSaid?.(said, true);
        said = '';
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

  function cleanup() {
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
  const resnapTimer = setInterval(resnap, RESNAP_MS);
  const motionTimer = setInterval(() => {
    const m = st.tracker.motion;
    if (m > 18) {
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
      if (text) send({ realtimeInput: { text } });
    },
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
