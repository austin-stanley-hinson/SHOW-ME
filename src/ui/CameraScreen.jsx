import { useEffect, useRef, useState } from 'react';
import { captureFrame } from '../camera/captureFrame.js';
import { ask } from '../client/askApi.js';
import { emptyScene, applyResponse, previousFor } from '../client/view.js';
import { buildScene } from '../overlay/scene.js';
import AnnotationLayer from '../overlay/AnnotationLayer.jsx';
import { fixtureName, fixtureAnswer, placeholderFrame } from './devMode.js';

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
  const [scene, setScene] = useState(null);
  const [view, setView] = useState(emptyScene);
  const [question, setQuestion] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [textHidden, setTextHidden] = useState(false);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);
  const controlsRef = useRef(null);
  const [controlsBox, setControlsBox] = useState(null);
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
    setScene(next);
    setTextHidden(false);
    setDrawingsHidden(false);
    setStatus('result');
    setCaption(next.answer || 'Here’s what I found.');
  }

  function handleLive() {
    requestId.current++;
    if (stream) setFrame(null);
    setScene(null);
    setView(emptyScene());
    setErrorDetail('');
    setStatus('live');
    setCaption('Point at something and ask a question.');
  }

  const thinking = status === 'thinking';

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
                Drawings {drawingsHidden ? 'off' : 'on'}
              </button>
              <button
                type="button"
                className="toggle"
                aria-pressed={!textHidden}
                onClick={() => setTextHidden((v) => !v)}
              >
                Text {textHidden ? 'off' : 'on'}
              </button>
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
        <div className="caption-area" hidden={textHidden}>
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

// The answer, with numbers the checker couldn't trace to the calc marked (CONTRACT v3).
function AnswerText({ parts, fallback }) {
  if (!parts.length) return fallback;
  return parts.map((p, i) =>
    p.unchecked ? (
      <mark key={i} className="unchecked" title="This number wasn’t checked">
        {p.text}
        <span className="sr-only"> (not checked)</span>
      </mark>
    ) : (
      p.text
    ),
  );
}

// Verdict + check status + explanation + assumptions are always visible here (the canvas panel
// shows only the math). The math is repeated for screen readers, and shown visibly if no panel drew it.
function CalcText({ scene }) {
  const { calc, explanation, calcPanelDrawn } = scene;
  const v = calc.verdict;
  return (
    <div className="physics-text">
      {v?.text && (
        <p className={`verdict ${v.check === 'mismatch' ? 'warn' : ''}`}>
          {v.check === 'mismatch' ? `⚠ The AI said “${v.text}”, but the numbers say: ${v.expected}` : `${v.text}${v.check === 'ok' ? ' ✓' : ''}`}
        </p>
      )}
      {calc.ok && (
        <p className={`check-status ${calc.verified ? 'ok' : 'warn'}`}>
          {calc.verified
            ? '✓ Math checked: every step re-computed by our code'
            : `⚠ ${calc.mismatches.length} step${calc.mismatches.length === 1 ? '' : 's'} didn’t check out (marked ⚠)`}
        </p>
      )}
      {explanation && <p className="explanation">{explanation}</p>}
      {calc.lines.length > 0 && (
        <ul className={calcPanelDrawn ? 'sr-only' : undefined}>
          {calc.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {calc.assumptions.length > 0 && <p className="assumptions">Estimates are based on: {calc.assumptions.join('; ')}</p>}
    </div>
  );
}
