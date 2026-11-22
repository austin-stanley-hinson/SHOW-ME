import { useEffect, useMemo, useRef, useState } from 'react';
import { joinSession } from '../client/session.js';
import { evaluateCalc } from '../physics/calc.js';
import { buildScene } from '../overlay/scene.js';
import AnnotationLayer from '../overlay/AnnotationLayer.jsx';
import { AnswerText, CalcText } from './AnswerParts.jsx';
import CalcSliders from './CalcSliders.jsx';

const NO_STATE_MS = 8000;

// Someone opened a "Share live" link (?s=<id>): a remote helper, teacher or teammate.
// They see the same annotated answer and checked math, live, through the session relay on Vultr
// (server/relay.js). Their "what if" slider moves sync back to the phone, and vice versa.
// The camera image is never shared: only the answer, its drawings and the slider values.
export default function SharedView({ id }) {
  const [state, setState] = useState(null);
  const [lost, setLost] = useState(false);
  const [whatIfOpen, setWhatIfOpen] = useState(true);
  const session = useRef(null);
  const gotState = useRef(false);
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);

  useEffect(() => {
    const s = joinSession(id, (st) => {
      gotState.current = true;
      setState(st);
      setLost(false);
    });
    session.current = s;
    // An unknown or expired id never sends a state (EventSource just keeps retrying).
    const t = setTimeout(() => setLost(!gotState.current), NO_STATE_MS);
    return () => {
      clearTimeout(t);
      s.close();
    };
  }, [id]);

  useEffect(() => {
    const bar = barRef.current;
    const ro = new ResizeObserver(() => setBarHeight(bar.offsetHeight));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  const doc = state?.doc || null;
  const result = useMemo(() => (doc?.calc ? evaluateCalc(doc.calc, null, state.inputs || {}) : null), [doc, state]);
  const scene = useMemo(() => (doc ? buildScene(doc, doc.draw, result ? { calc: result } : {}) : null), [doc, result]);

  return (
    <main className="camera-screen shared-view">
      {scene && <AnnotationLayer scene={scene} bottomInset={barHeight} />}

      <div className="live-status listening" role="status">
        <span className="dot" aria-hidden="true" />
        {lost && !state ? 'Shared view not found' : state ? 'Live shared view' : 'Connecting…'}
      </div>

      <div className="bottom-bar" ref={barRef}>
        <div className="caption-area" hidden={whatIfOpen && Boolean(result)}>
          {scene?.title && <p className="answer-title">{scene.title}</p>}
          <p className="caption" aria-live="polite">
            {!state && !lost && <span className="spinner" aria-hidden="true" />}
            {scene ? (
              <AnswerText parts={scene.answerParts} fallback={scene.answer} />
            ) : lost ? (
              'This shared view has ended, or the link is wrong. Ask the person sharing for a new link.'
            ) : (
              'Joining the shared view…'
            )}
          </p>
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
          {scene && <p className="caption-detail">The camera image stays on the sharer’s phone; you see the answer and drawings.</p>}
        </div>

        {result && (
          <CalcSliders
            sheet={doc.calc}
            result={result}
            onChange={(name, value) => session.current?.setInput(name, value, 'helper')}
            onReset={() => session.current?.setDoc(doc)}
            open={whatIfOpen}
            onOpenChange={setWhatIfOpen}
          />
        )}
      </div>
    </main>
  );
}
