// End-to-end Gemini Live test from a laptop (no phone needed): token -> session -> frames -> question(s)
// -> tool calls through the real liveTools -> prints what the phone would show and say.
//
//   node --env-file=.env.local api/_dev/live.mjs frame.jpg "What is this?" ["next question" ...]
//
// The frame should be small (~768 px), like the phone sends. Audio replies are counted, not played.

import { readFileSync } from 'node:fs';
import handler from '../live-token.js';
import pointHandler from '../point.js';
import { createLiveTools } from '../../src/client/liveTools.js';

const [framePath, ...questions] = process.argv.slice(2);
if (!framePath || !questions.length) {
  console.log('usage: node --env-file=.env.local api/_dev/live.mjs <frame.jpg> "<question>" ["<question>" ...]');
  process.exit(1);
}
const frame = readFileSync(framePath).toString('base64');

// 1) Mint a token through our own endpoint handler.
const token = await new Promise((resolve, reject) => {
  const res = { statusCode: 200, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { (this.statusCode === 200 ? resolve : reject)(b); } };
  handler({ method: 'POST', headers: {} }, res);
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
log('token ok, model', token.model);

// 2) Live session.
const tools = createLiveTools();
const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.token)}`);
let said = '';
// AUTOCHECKS=n: after the questions, send n "[auto-check]" turns (like live.watch(true)) and report whether
// the model stays quiet (calls wait) when the step isn't done.
let autochecks = Number(process.env.AUTOCHECKS || 0);
let step = null;
let waitCalled = false;
let audio = 0;
let q = 0;
let frames;
function nextTurn() {
  if (++q < questions.length) return ask();
  if (autochecks-- > 0 && step) {
    waitCalled = false;
    const check = `[auto-check] Step ${step.current}${step.total ? ' of ' + step.total : ''}${step.done_when ? ': done when ' + step.done_when : ''}.`;
    log('AUTO-CHECK:', check);
    ws.send(JSON.stringify({ realtimeInput: { text: check } }));
    clearTimeout(globalThis.__next);
    globalThis.__next = setTimeout(() => (log(waitCalled ? '   -> quiet (wait called, nothing said)' : '   -> no reply'), nextTurn()), 9000);
    return;
  }
  ws.close();
}
const ask = () => {
  log('YOU:', questions[q]);
  ws.send(JSON.stringify({ realtimeInput: { text: questions[q] } }));
};
ws.onopen = () => ws.send(JSON.stringify({ setup: {} }));
ws.onmessage = async (ev) => {
  const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8'));
  if (m.setupComplete) {
    log('connected; streaming frames at 1 fps');
    frames = setInterval(() => ws.send(JSON.stringify({ realtimeInput: { video: { data: frame, mimeType: 'image/jpeg' } } })), 1000);
    setTimeout(ask, 2500);
  }
  if (m.toolCall) clearTimeout(globalThis.__next);
  if (m.serverContent?.modelTurn) clearTimeout(globalThis.__next);
  if (m.toolCall) {
    const responses = m.toolCall.functionCalls.map((fc) => {
      const { response, update } = tools.handle(fc);
      log(`TOOL ${fc.name}`, JSON.stringify(fc.args).slice(0, 220));
      if (update?.scene) log('   on screen:', update.scene.items.map((i) => `${i.type}:${i.id}@${JSON.stringify(i.at || [i.from, i.to])}${i.label ? ` "${i.label}"` : ''}`).join('  '));
      if (update?.gesture) log('   GESTURE', update.gesture.type, '→', update.gesture.target);
      if (update?.procedure) (log('   PROCEDURE', JSON.stringify(update.procedure)), (step = update.procedure));
      if (fc.name === 'wait') (waitCalled = true), log('   WAIT', JSON.stringify(fc.args));
      if (update?.calc) for (const l of update.calc.result.lines) log('   CALC', l);
      if (response.error || response.dropped) log('   tool response:', JSON.stringify(response));
      if (fc.name === 'show') {
        const targets = tools.targetsFor(response.shown || [], (fc.args?.points || []).map((p) => p?.id).filter(Boolean));
        if (targets.length) {
          const t1 = Date.now();
          const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) {
            if (b.points) {
              const s = tools.refine(b.points);
              log(`   PRECISE (${Date.now() - t1} ms):`, b.points.map((p) => `${p.id} ${JSON.stringify(targets.find((x) => x.id === p.id)?.at)} -> ${JSON.stringify(p.at)}`).join('  '));
            } else log('   precise failed:', JSON.stringify(b));
          } };
          pointHandler({ method: 'POST', body: { image: frame, targets } }, res);
        }
      }
      return { id: fc.id, name: fc.name, response };
    });
    // wait is non-blocking: replying to it restarts generation (it loops), so it gets no reply.
    const replies = responses.filter((r) => r.name !== 'wait');
    if (replies.length) ws.send(JSON.stringify({ toolResponse: { functionResponses: replies } }));
  }
  const sc = m.serverContent;
  if (sc && process.env.LIVE_DEBUG) log('  sc keys:', Object.keys(sc).join(','), sc.outputTranscription ? JSON.stringify(sc.outputTranscription).slice(0, 80) : '');
  if (sc) {
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData) audio += p.inlineData.data.length;
      if (p.executableCode || p.codeExecutionResult) log('   (model ran code)');
    }
    if (sc.groundingMetadata) log('   SEARCHED:', JSON.stringify(sc.groundingMetadata.webSearchQueries || sc.groundingMetadata).slice(0, 160));
    if (sc.outputTranscription?.text) said += sc.outputTranscription.text;
    if (sc.turnComplete && !(said || audio)) {
      clearTimeout(globalThis.__next);
      globalThis.__next = setTimeout(nextTurn, 9000);
    }
    if (sc.turnComplete && (said || audio)) {
      log(`GEMINI SAID (${Math.round((audio * 3) / 4 / 48000)} s of audio)${waitCalled ? ' [wait was called: the app would DROP this]' : ''}:`, JSON.stringify(said.trim()));
      said = '';
      audio = 0;
      // The model may keep going in another turn (e.g. after searching): wait for quiet before moving on.
      clearTimeout(globalThis.__next);
      globalThis.__next = setTimeout(nextTurn, 9000);
    }
  }
  if (m.goAway) log('goAway', JSON.stringify(m.goAway));
};
ws.onclose = (e) => {
  clearInterval(frames);
  log('closed', e.code, (e.reason || '').slice(0, 160));
  process.exit(0);
};
setTimeout(() => (log('timeout'), process.exit(1)), 25_000 * questions.length + 15_000 + 12_000 * Number(process.env.AUTOCHECKS || 0));
