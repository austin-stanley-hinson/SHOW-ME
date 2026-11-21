// Guided procedures (lane B logic). After an answer with a "procedure", the UI shows Done / Next.
//
//   const g = guideState(data.procedure);          // null when there's no procedure
//   if (g) showButton(g.complete ? 'Finish' : `Done with step ${g.current}`); showSafety(g.safety);
//   doneButton.onclick = async () => {
//     const canvas = captureFrame(video);           // a NEW picture, so the AI can check the step
//     const res = await ask(canvas, doneQuestion(g), previousFor(scene)); // previousFor from ./view.js
//     scene = applyResponse(scene, res.data, doneQuestion(g));
//   };

export function guideState(procedure) {
  if (!procedure || !Number.isInteger(procedure.current)) return null;
  const { title = null, current, total = null, done_when = null, complete = false, safety = [] } = procedure;
  return {
    title,
    current,
    total,
    done_when,
    complete,
    safety,
    progress: total ? `Step ${current} of ${total}` : `Step ${current}`,
  };
}

// What we tell the model when the user taps Done. It checks the new picture against done_when itself.
export function doneQuestion(g) {
  const title = g.title ? ` of "${g.title}"` : '';
  const check = g.done_when ? ` You said it's done when: ${g.done_when}` : '';
  return `I think I finished step ${g.current}${title}. Check this new picture.${check} If it's right, show the next step; if not, show me what to fix.`;
}
