export default function StartScreen({ onStart, busy, message }) {
  return (
    <main className="start-screen">
      <h1>Show Me</h1>
      <p>Other AI assistants tell you. This one shows you.</p>
      <button type="button" className="big-button" onClick={onStart} disabled={busy}>
        {busy ? 'Starting…' : 'Start'}
      </button>
      <p className="start-note" role="status" aria-live="polite">
        {message || 'Uses your camera and motion sensors. Frames are only sent when you ask a question.'}
      </p>
    </main>
  );
}
