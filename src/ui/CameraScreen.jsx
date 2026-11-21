import { useEffect, useRef, useState } from 'react';
import { captureFrame } from '../camera/captureFrame.js';
import { ask } from '../client/askApi.js';
import { buildScene } from '../overlay/scene.js';
import AnnotationLayer from '../overlay/AnnotationLayer.jsx';
import { fixtureName, fixtureAnswer, placeholderFrame } from './devMode.js';

const PRESETS = ['Why isn’t it falling?', 'How do I use this?', 'What is this?'];
const ERROR_CAPTION = 'Sorry, I couldn’t figure that out. Try again.';

// Live camera → Ask freezes the frame → "Looking…" → answer drawn on the frozen frame.
// Further questions while frozen go to the same frame (with the previous turn as context).
// stream may be null in ?nocam=1 dev mode: a placeholder frame is used instead.
export default function CameraScreen({ stream, orientation }) {
  const videoRef = useRef(null);
  const frozenRef = useRef(null);
  const requestId = useRef(0);
  const [frame, setFrame] = useState(null); // frozen canvas, or null when live
  const [status, setStatus] = useState('live'); // live | thinking | result | error
  const [scene, setScene] = useState(null);
  const [lastTurn, setLastTurn] = useState(null);
  const [question, setQuestion] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [textHidden, setTextHidden] = useState(false);
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);
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
    setStatus('thinking');
    setScene(null);
    setErrorDetail('');
    setQuestion('');
    setCaption(`Looking… “${q}”`);

    const result = fixtureName ? await fixtureAnswer() : await ask(canvas, q, lastTurn);
    if (id !== requestId.current) return; // user went back to live meanwhile

    if (!result.ok) {
      setStatus('error');
      setCaption(ERROR_CAPTION);
      setErrorDetail(result.error || '');
      return;
    }
    const next = buildScene(result.data);
    setScene(next);
    setTextHidden(false);
    setStatus('result');
    setCaption(next.answer || 'Here’s what I found.');
    setLastTurn({ question: q, response: result.data });
  }

  function handleLive() {
    requestId.current++;
    if (stream) setFrame(null);
    setScene(null);
    setLastTurn(null);
    setErrorDetail('');
    setStatus('live');
    setCaption('Point at something and ask a question.');
  }

  const thinking = status === 'thinking';

  return (
    <main className="camera-screen">
      {stream && <video ref={videoRef} className="camera-video" playsInline muted autoPlay />}
      <div ref={frozenRef} className="frozen-frame" hidden={!frame} />
      {scene && <AnnotationLayer scene={scene} bottomInset={textHidden ? 0 : barHeight} />}

      <div className="bottom-bar" ref={barRef}>
        {scene && (
          <button
            type="button"
            className="toggle-text"
            aria-expanded={!textHidden}
            onClick={() => setTextHidden((v) => !v)}
          >
            {textHidden ? 'Show answer' : 'Hide answer to see drawing'}
          </button>
        )}
        <div className="caption-area" hidden={textHidden}>
          <p className="caption" role="status" aria-live="polite">
            {thinking && <span className="spinner" aria-hidden="true" />}
            {caption}
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

          {scene?.hasPhysics && <PhysicsText scene={scene} />}
        </div>

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

        {frame && stream && !textHidden && (
          <button type="button" className="secondary-button" onClick={handleLive}>
            Back to live camera
          </button>
        )}
      </div>
    </main>
  );
}

// Explanation + assumptions are always visible here (the canvas panel shows only the math).
// The math is repeated for screen readers, and shown visibly if no panel drew it.
function PhysicsText({ scene }) {
  const { physics, explanation, physicsPanelDrawn } = scene;
  return (
    <div className="physics-text">
      {explanation && <p className="explanation">{explanation}</p>}
      {physics.lines.length > 0 && (
        <ul className={physicsPanelDrawn ? 'sr-only' : undefined}>
          {physics.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {physics.assumptions.length > 0 && (
        <p className="assumptions">Estimates are based on: {physics.assumptions.join('; ')}</p>
      )}
    </div>
  );
}
