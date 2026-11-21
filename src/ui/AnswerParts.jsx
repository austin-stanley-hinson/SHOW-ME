// Shared answer UI for photo and live mode.

// The answer, with numbers the checker couldn't trace to the calc marked (CONTRACT v3).
export function AnswerText({ parts, fallback }) {
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
export function CalcText({ scene }) {
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
