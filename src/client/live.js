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
  const status = (s) => onStatus(s);
  status('connecting');

  // Audio must be created inside the user's tap on iOS.
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  const ctx = new AC();
  await ctx.resume();

  const tokenRes = await fetch('/api/live-token', { method: 'POST' });
  if (!tokenRes.ok) throw new Error(`token: HTTP ${tokenRes.status}`);
  const { token } = await tokenRes.json();

  const tools = createLiveTools();

  // ---- tracking: keep drawings on the real spots as the phone moves (src/tracking/sceneTracker.js) ----
  const st = createSceneTracker(video);
  let lastSentFrameId = -1;
  const trackedScene = () => st.current(tools.scene);
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
    const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    frameCanvas.width = Math.round(video.videoWidth * scale);
    frameCanvas.height = Math.round(video.videoHeight * scale);
    frameCanvas.getContext('2d').drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    const data = frameCanvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    send({ realtimeInput: { video: { data, mimeType: 'image/jpeg' } } });
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
        if (update?.scene) {
          st.place(update.scene, lastSentFrameId);
          onScene?.(update.scene);
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
      if (sc.outputTranscription?.text) {
        said += sc.outputTranscription.text;
        onSaid?.(said, false);
      }
      if (sc.inputTranscription?.text) onHeard?.(sc.inputTranscription.text);
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
    clearInterval(frameTimer);
    st.stop();
    stopPlayback();
    micNode?.disconnect();
    micStream?.getTracks().forEach((t) => t.stop());
  }

  return {
    say(text) {
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
