import { sliderSpecs, formatValue } from './sliders.js';

const MAX_SLIDERS = 4;

// "What if…": drag a value (your push, the chair's mass…) and the checked math re-runs instantly.
// The verdict, the panel lines and the labels on the object all update (evaluateCalc overrides).
// sheet: the AI's calc; result: evaluateCalc with the current overrides; onChange(name, value).
// open/onOpenChange: controlled, so the screen can fold the answer text away while sliders are open.
export default function CalcSliders({ sheet, result, onChange, onReset, open, onOpenChange }) {
  const specs = sliderSpecs(sheet, result).slice(0, MAX_SLIDERS);
  if (!specs.length) return null;
  const anyChanged = specs.some((s) => s.changed);
  const v = result.verdict;

  return (
    <section className="what-if" aria-label="What if">
      <button type="button" className="toggle what-if-toggle" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        {open ? 'Close what if' : 'What if…? Change the numbers'}
      </button>
      {open && (
        <div className="what-if-body">
          {/* The verdict right above the sliders, announced when it changes. */}
          {v?.text && (
            <p className={`what-if-verdict ${anyChanged ? 'changed' : ''}`} aria-live="polite">
              {v.text}
            </p>
          )}
          {specs.map((s) => {
            const id = `slider-${s.name}`;
            const shown = `${formatValue(s.value, s.step)}${s.unit ? ` ${s.unit}` : ''}`;
            return (
              <div key={s.name} className="slider-row">
                <label htmlFor={id}>
                  {s.label}
                  {s.estimated && !s.changed ? ' (AI’s estimate)' : ''}: <strong>{shown}</strong>
                </label>
                <input
                  id={id}
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={s.value}
                  aria-valuetext={shown}
                  onChange={(e) => onChange(s.name, Number(e.target.value))}
                />
              </div>
            );
          })}
          {anyChanged && (
            <button type="button" className="toggle" onClick={onReset}>
              Reset to the AI’s numbers
            </button>
          )}
        </div>
      )}
    </section>
  );
}
