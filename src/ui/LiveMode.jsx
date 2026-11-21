import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import LiveAnnotationLayer from '../overlay/LiveAnnotationLayer.jsx';
import { guideState, doneQuestion } from '../client/guide.js';
import { CalcText } from './AnswerParts.jsx';
import CalcSliders from './CalcSliders.jsx';

const STATUS_TEXT = {
  connecting: 'Connecting…',
  live: 'Listening',
  listening: 'Listening',
  speaking: 'Speaking',
  closed: 'Ended',
  ready: 'Ready',
};

const TAP_MS = 350; // a press shorter than this is a tap: the mic stays open until the next tap

// Live mode: the AI watches the camera, listens, talks, and draws on the live view.
// session = { store, live } where live comes from startLive() (src/client/live.js, lane B),
// started inside the "Go live" tap. The camera <video> keeps playing underneath.
export default function LiveMode({ session, video, onExit }) {
  const { store, live } = session;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const [typed, setTyped] = useState('');
  const [muted, setMuted] = useState(false);
  const [talking, setTalking] = useState(false);
  const [latched, setLatched] = useState(false); // tapped (not held): talking until the next tap
  const [typing, setTyping] = useState(false); // hold-to-talk mode: the text field opens on demand
  const [handsFree, setHandsFree] = useState(true); // during a task, the AI checks your progress by itself
  const [whatIfOpen, setWhatIfOpen] = useState(false); // sliders open: the captions fold away
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [textHidden, setTextHidden] = useState(false);
  const [trackingLost, setTrackingLost] = useState(false);
  const press = useRef({ t: 0, ignoreUp: false });
  const barRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);
  const controlsRef = useRef(null);
  const [controlsBox, setControlsBox] = useState(null);

  useEffect(() => {
    const bar = barRef.current;
    const ro = new ResizeObserver(() => setBarHeight(bar.offsetHeight));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = controlsRef.current;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setControlsBox({ w: window.innerWidth - r.left + 8, h: r.bottom + 8 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Feature-detected, so this works with any live.js: pushToTalk/talkStart since #18;
  // watch(on) is the hands-free step checker requested from lane B.
  const ptt = Boolean(live?.pushToTalk && live.talkStart);
  const canWatch = typeof live?.watch === 'function';
  const guide = guideState(state.procedure);
  const stepActive = Boolean(guide && !guide.complete);
  const watching = canWatch && handsFree && stepActive;

  useEffect(() => {
    if (!canWatch) return;
    live.watch(watching);
  }, [live, canWatch, watching]);

  const rawStatus = state.status.startsWith('error') ? 'error' : state.status;
  const status = ptt && talking ? 'listening' : ptt && (rawStatus === 'live' || rawStatus === 'listening') ? 'ready' : rawStatus;
  const statusText = status === 'error' ? 'Connection problem' : STATUS_TEXT[status] || status;

  // If the AI drew a calc panel, the canvas shows the math; the caption keeps verdict + assumptions.
  const panelDrawn = Boolean(live?.scene?.items?.some((i) => i.type === 'panel' && i.content === 'calc'));
  const calcScene = state.calc ? { calc: state.calc, explanation: '', calcPanelDrawn: panelDrawn } : null;

  function send(e) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || !live) return;
    live.say(text);
    store.set({ heard: text });
    setTyped('');
  }

  function talk(on) {
    if (!ptt || on === talking) return;
    if (on) live.talkStart();
    else live.talkEnd();
    setTalking(on);
    if (!on) setLatched(false);
  }

  // Hold = talk while held. Tap = mic stays open (hands busy with the task) until the next tap.
  function pressDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (latched) {
      press.current.ignoreUp = true;
      talk(false);
      return;
    }
    press.current.t = performance.now();
    talk(true);
  }
  function pressUp() {
    if (press.current.ignoreUp) {
      press.current.ignoreUp = false;
      return;
    }
    if (performance.now() - press.current.t < TAP_MS) setLatched(true);
    else talk(false);
  }
  // Keyboard / switch access: Space or Enter held down = talking.
  const talkKey = (on) => (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      talk(on);
    }
  };

  function toggleMute() {
    const next = !muted;
    live?.mute(next);
    setMuted(next);
  }

  const talkLabel = talking ? (latched ? 'Listening… tap to send' : 'Listening… let go when done') : 'Hold or tap to talk';

  return (
    <>
      <LiveAnnotationLayer
        live={live}
        store={store}
        video={video}
        hidden={drawingsHidden}
        bottomInset={textHidden ? 0 : barHeight}
        topRight={controlsBox}
        onTracking={setTrackingLost}
      />

      <div className={`live-status ${status}`} role="status">
        <span className="dot" aria-hidden="true" />
        {statusText}
        {trackingLost && status !== 'connecting' && <span className="track-lost"> · hold still to re-anchor</span>}
      </div>

      <div className="result-controls" role="toolbar" aria-label="Live controls" ref={controlsRef}>
        <button type="button" className="toggle" aria-pressed={!drawingsHidden} onClick={() => setDrawingsHidden((v) => !v)}>
          Drawings
        </button>
        <button type="button" className="toggle" aria-pressed={!textHidden} onClick={() => setTextHidden((v) => !v)}>
          Text
        </button>
        <button type="button" className="toggle close" onClick={onExit} aria-label="End live mode">
          ✕
        </button>
      </div>

      <div className="bottom-bar live-bar" ref={barRef}>
        <div className="caption-area" hidden={textHidden || whatIfOpen}>
          {state.heard && <p className="heard">You: {state.heard}</p>}
          {/* Visual caption updates word by word; screen readers get each finished sentence once. */}
          <p className="caption" aria-hidden="true">
            {status === 'connecting' && <span className="spinner" />}
            {state.said ||
              (status === 'connecting'
                ? 'Starting live mode…'
                : ptt
                  ? 'I’m watching. Hold or tap the button and ask me anything about what you see.'
                  : 'I’m watching. Ask me anything about what you see.')}
          </p>
          <p className="sr-only" aria-live="polite">
            {state.saidFinal}
          </p>
          {state.error && <p className="caption-detail">({state.error})</p>}

          {guide && (
            <div className="procedure-card">
              <p className="procedure-title">
                {guide.title ? `${guide.title}: ` : ''}
                {guide.complete ? 'All done ✓' : guide.progress}
              </p>
              {guide.safety.map((s) => (
                <p key={s} className="procedure-safety">
                  ⚠ {s}
                </p>
              ))}
            </div>
          )}

          {calcScene && <CalcText scene={calcScene} />}
        </div>

        {state.calcSheet && state.calc && !textHidden && (
          <CalcSliders
            sheet={state.calcSheet}
            result={state.calc}
            onChange={store.setOverride}
            onReset={() => store.setOverride(null)}
            open={whatIfOpen}
            onOpenChange={setWhatIfOpen}
          />
        )}

        {/* The main action during a task: always visible, outside the scrolling caption area.
            Hands-free, the AI notices by itself; the button stays as a sure way to move on. */}
        {/* What the AI is waiting to see, always in view while you work. */}
        {stepActive && !textHidden && guide.done_when && (
          <div className="watch-row">
            <p className={watching ? 'procedure-watching' : 'procedure-when'}>
              {watching ? '👀 Watching for: ' : 'Done when: '}
              {guide.done_when}
            </p>
            {canWatch && (
              <button type="button" className="toggle" aria-pressed={handsFree} onClick={() => setHandsFree((v) => !v)}>
                Hands-free
              </button>
            )}
          </div>
        )}

        {stepActive && !textHidden && (
          <button
            type="button"
            className={`big-button done-button ${watching ? 'secondary' : ''}`}
            onClick={() => live?.say(doneQuestion(guide))}
          >
            ✓ Done with step {guide.current}
          </button>
        )}

        {ptt && !textHidden && (
          <div className="talk-row">
            <button
              type="button"
              className={`big-button talk-button ${talking ? 'talking' : ''}`}
              aria-pressed={talking}
              onPointerDown={pressDown}
              onPointerUp={pressUp}
              onPointerCancel={() => !latched && talk(false)}
              onKeyDown={talkKey(true)}
              onKeyUp={talkKey(false)}
              onContextMenu={(e) => e.preventDefault()}
              disabled={status === 'connecting' || status === 'closed'}
            >
              {talkLabel}
            </button>
            <button type="button" className="toggle keyboard-button" aria-expanded={typing} onClick={() => setTyping((v) => !v)}>
              Type
            </button>
          </div>
        )}

        <form className="ask-row" hidden={textHidden || (ptt && !typing)} onSubmit={send}>
          <label className="sr-only" htmlFor="live-typed">
            Type to the AI
          </label>
          <input
            id="live-typed"
            className="question-input"
            type="text"
            enterKeyHint="send"
            autoComplete="off"
            placeholder={ptt ? 'Type to the AI…' : 'Just talk, or type here…'}
            autoFocus={ptt && typing}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {!ptt && (
            <button type="button" className="toggle mic-button" aria-pressed={!muted} onClick={toggleMute}>
              {muted ? 'Mic off' : 'Mic on'}
            </button>
          )}
          <button type="submit" className="big-button ask-button" disabled={!typed.trim()}>
            Send
          </button>
        </form>
      </div>
    </>
  );
}
