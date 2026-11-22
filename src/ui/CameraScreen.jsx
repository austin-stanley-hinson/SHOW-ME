import { useEffect, useMemo, useRef, useState } from 'react';
import { captureFrame } from '../camera/captureFrame.js';
import { ask } from '../client/askApi.js';
import { emptyScene, applyResponse, previousFor } from '../client/view.js';
import { buildScene } from '../overlay/scene.js';
import AnnotationLayer from '../overlay/AnnotationLayer.jsx';
import { AnswerText, CalcText } from './AnswerParts.jsx';
import CalcSliders from './CalcSliders.jsx';
import { evaluateCalc } from '../physics/calc.js';
import { sessionsEnabled, createSession, joinSession } from '../client/session.js';
import ShareBox from './ShareBox.jsx';
import { fixtureName, fixtureAnswer, placeholderFrame, fakeLive, fakeStartLive } from './devMode.js';
import { startLive } from '../client/live.js';
import { createLiveStore } from './liveStore.js';
import LiveMode from './LiveMode.jsx';

const PRESETS = ['Why isn’t it falling?', 'How do I use this?', 'What is this?'];
const ERROR_CAPTION = 'Sorry, I couldn’t figure that out. Try again.';

// Live camera → Ask freezes the frame → "Looking…" → answer drawn on the frozen frame.
// Further questions while frozen go to the same frame. The view is a persistent scene
// (src/client/view.js): the AI sees what's on screen and can add, move or remove items.
// stream may be null in ?nocam=1 dev mode: a placeholder frame is used instead.
export default function CameraScreen({ stream, orientation }) {
  const videoRef = useRef(null);
  const frozenRef = useRef(null);
  const requestId = useRef(0);
  const [frame, setFrame] = useState(null); // frozen canvas, or null when live
  const [status, setStatus] = useState('live'); // live | thinking | result | error
  const [answer, setAnswer] = useState(null); // { data, items }: the latest answer and the view it applies to
  const [overrides, setOverrides] = useState({}); // "what if" slider values, by calc input name
  const [whatIfOpen, setWhatIfOpen] = useState(false); // sliders open: the answer text folds away
  const [view, setView] = useState(emptyScene);
  const [liveSession, setLiveSession] = useState(null); // { store, live } while in live mode
  const liveRef = useRef(null);
  const [question, setQuestion] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [textHidden, setTextHidden] = useState(false);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);
  const controlsRef = useRef(null);
  const [controlsBox, setControlsBox] = useState(null);
  // The scene is derived, so dragging a slider re-checks the math and redraws the labels.
  const calcResult = useMemo(
    () => (answer?.data?.calc ? evaluateCalc(answer.data.calc, null, overrides) : null),
    [answer, overrides],
  );
  const scene = useMemo(
    () => (answer ? buildScene(answer.data, answer.items, calcResult ? { calc: calcResult } : {}) : null),
    [answer, calcResult],
  );
  // "Share live" (session relay on Vultr): others see this answer and its sliders, synced both ways.
  const [share, setShare] = useState(null); // { status: 'creating' | 'live' | 'error', url?, error? }
  const sessionRef = useRef(null);
  const sharedDoc = (a) => ({ ...a.data, draw: a.items }); // the whole current view, never the image

  const setOverride = (name, value) => {
    sessionRef.current?.setInput(name, value, 'phone');
    setOverrides((o) => ({ ...o, [name]: { value, by: sessionRef.current ? 'phone' : 'you' } }));
  };
  const resetOverrides = () => {
    if (sessionRef.current && answer) sessionRef.current.setDoc(sharedDoc(answer)); // the relay resets inputs
    setOverrides({});
  };

  async function startShare() {
    if (!answer || share) return;
    setShare({ status: 'creating' });
    try {
      const id = await createSession(sharedDoc(answer));
      sessionRef.current = joinSession(id, ({ inputs }) => setOverrides(inputs || {}));
      setShare({ status: 'live', url: `${window.location.origin}${window.location.pathname}?s=${id}` });
    } catch (e) {
      setShare({ status: 'error', error: e.message });
    }
  }
  function stopShare() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setShare(null);
  }
  useEffect(() => () => sessionRef.current?.close(), []);

  const [caption, setCaption] = useState(
    orientation === 'denied'
      ? 'Motion sensors are off, so drawings won’t follow the phone. Point at something and ask.'
      : 'Point at something and ask a question.',
  );

  useEffect(() => {
    if (!stream) return;
    const video = videoRef.current;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // No camera (dev mode): freeze a placeholder right away.
  useEffect(() => {
    if (!stream) setFrame(placeholderFrame(window.innerWidth, window.innerHeight));
  }, [stream]);

  // Track the bottom bar's height so canvas text stays above it.
  useEffect(() => {
    const bar = barRef.current;
    const ro = new ResizeObserver(() => setBarHeight(bar.offsetHeight));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // Track the top-right controls' footprint so the panel/labels avoid it.
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return setControlsBox(null);
    const measure = () => {
      const r = el.getBoundingClientRect();
      setControlsBox({ w: window.innerWidth - r.left + 8, h: r.bottom + 8 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene, stream]);

  // Show the captured canvas itself, so what's on screen is exactly what gets sent.
  useEffect(() => {
    frozenRef.current?.replaceChildren(...(frame ? [frame] : []));
  }, [frame]);

  async function handleAsk(text) {
    // Empty box → a sensible default, so Ask always does something.
    const q = (text ?? question).trim() || 'What is this?';
    if (status === 'thinking') return;

    let canvas = frame;
    if (!canvas) {
      canvas = captureFrame(videoRef.current);
      if (!canvas) {
        setCaption('The camera isn’t ready yet. Try again in a second.');
        return;
      }
      setFrame(canvas);
    }

    const id = ++requestId.current;
    setStatus('thinking'); // the current drawings stay up while the follow-up is answered
    setErrorDetail('');
    setQuestion('');
    setCaption(`Looking… “${q}”`);

    const result = fixtureName ? await fixtureAnswer() : await ask(canvas, q, previousFor(view));
    if (id !== requestId.current) return; // user went back to live meanwhile

    if (!result.ok) {
      setStatus('error');
      setCaption(ERROR_CAPTION);
      setErrorDetail(result.error || '');
      return;
    }
    const nextView = applyResponse(view, result.data, q);
    const next = buildScene(result.data, nextView.items);
    setView(nextView);
    setAnswer({ data: result.data, items: nextView.items });
    setOverrides({});
    setWhatIfOpen(false);
    sessionRef.current?.setDoc(sharedDoc({ data: result.data, items: nextView.items }));
    setTextHidden(false);
    setDrawingsHidden(false);
    setStatus('result');
    setCaption(next.answer || 'Here’s what I found.');
  }

  // Live mode must start inside this tap (iOS only allows audio from a user gesture).
  function goLive() {
    const store = createLiveStore();
    const start = fakeLive ? fakeStartLive : startLive;
    // Hold-to-talk: an always-open mic picks up nearby chatter (the venue is loud).
    const pending = start({ video: videoRef.current, pushToTalk: true, ...store.handlers });
    handleLive();
    setLiveSession({ store, live: null });
    pending
      .then((live) => {
        liveRef.current = live;
        setLiveSession((cur) => (cur?.store === store ? { store, live } : (live.stop(), cur)));
      })
      .catch((e) => store.set({ status: 'error', error: `Couldn’t start live mode: ${e.message}` }));
  }

  function endLive() {
    liveRef.current?.stop();
    liveRef.current = null;
    setLiveSession(null);
  }

  // Leaving the screen ends any live session.
  useEffect(() => () => liveRef.current?.stop(), []);

  function handleLive() {
    requestId.current++;
    if (stream) setFrame(null);
    setAnswer(null);
    setOverrides({});
    setWhatIfOpen(false);
    stopShare();
    setView(emptyScene());
    setErrorDetail('');
    setStatus('live');
    setCaption('Point at something and ask a question.');
  }

  const thinking = status === 'thinking';

  if (liveSession) {
    return (
      <main className="camera-screen">
        {stream && <video ref={videoRef} className="camera-video" playsInline muted autoPlay />}
        <LiveMode session={liveSession} video={stream ? videoRef.current : null} onExit={endLive} />
      </main>
    );
  }

  return (
    <main className="camera-screen">
      {stream && <video ref={videoRef} className="camera-video" playsInline muted autoPlay />}
      <div ref={frozenRef} className="frozen-frame" hidden={!frame} />
      {scene && !drawingsHidden && <AnnotationLayer scene={scene} bottomInset={textHidden ? 0 : barHeight} topRight={controlsBox} />}

      {/* Result controls: show/hide the drawings and the text independently, or close the result. */}
      {(scene || (frame && stream && status !== 'live')) && (
        <div className="result-controls" role="toolbar" aria-label="Answer display" ref={controlsRef}>
          {scene && (
            <>
              <button
                type="button"
                className="toggle"
                aria-pressed={!drawingsHidden}
                onClick={() => setDrawingsHidden((v) => !v)}
              >
                Drawings
              </button>
              <button
                type="button"
                className="toggle"
                aria-pressed={!textHidden}
                onClick={() => setTextHidden((v) => !v)}
              >
                Text
              </button>
              {sessionsEnabled() && !share && (
                <button type="button" className="toggle" onClick={startShare}>
                  Share
                </button>
              )}
            </>
          )}
          {stream && (
            <button type="button" className="toggle close" onClick={handleLive} aria-label="Close answer and go back to the live camera">
              ✕
            </button>
          )}
        </div>
      )}

      <div className="bottom-bar" ref={barRef}>
        <div className="caption-area" hidden={textHidden || (whatIfOpen && !thinking)}>
          {scene?.title && !thinking && <p className="answer-title">{scene.title}</p>}
          <p className="caption" role="status" aria-live="polite">
            {thinking && <span className="spinner" aria-hidden="true" />}
            {status === 'result' && scene ? <AnswerText parts={scene.answerParts} fallback={caption} /> : caption}
          </p>
          {errorDetail && <p className="caption-detail">({errorDetail})</p>}

          {scene?.followup && (
            <p className="followup">
              <strong>Question for you:</strong> {scene.followup}
            </p>
          )}

          {scene?.steps.length > 0 && (
            <ol className="steps-list">
              {scene.steps.map((s) => (
                <li key={s.n} value={s.n}>
                  {s.text}
                </li>
              ))}
            </ol>
          )}

          {scene?.hasCalc && <CalcText scene={scene} />}
        </div>

        {!textHidden && <ShareBox share={share} onStop={stopShare} />}

        {/* Outside the scrolling caption, so the verdict and sliders stay in view while dragging. */}
        {calcResult && !thinking && !textHidden && (
          <CalcSliders
            sheet={answer.data.calc}
            result={calcResult}
            onChange={setOverride}
            onReset={resetOverrides}
            open={whatIfOpen}
            onOpenChange={setWhatIfOpen}
          />
        )}

        {!thinking && !scene && !textHidden && (stream || fakeLive) && (
          <button type="button" className="big-button live-button" onClick={goLive}>
            <span className="dot" aria-hidden="true" /> Go live: talk with the AI
          </button>
        )}

        {!thinking && !scene && !textHidden && (
          <div className="presets" aria-label="Example questions">
            {PRESETS.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => handleAsk(p)}>
                {p}
              </button>
            ))}
          </div>
        )}

        <form
          hidden={textHidden}
          className="ask-row"
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
        >
          <label className="sr-only" htmlFor="question">
            Your question
          </label>
          <input
            id="question"
            className="question-input"
            type="text"
            enterKeyHint="send"
            autoComplete="off"
            placeholder={scene?.followup ? 'Answer or ask more…' : 'Ask about what you see…'}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={thinking}
          />
          <button type="submit" className="big-button ask-button" disabled={thinking}>
            Ask
          </button>
        </form>

      </div>
    </main>
  );
}
