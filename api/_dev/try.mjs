// Test the Gemini prompt from your laptop, no app needed.
//
//   node --env-file=.env.local api/_dev/try.mjs photo.jpg "Why isn't it falling?"
//
// Prints Gemini's validated JSON, then what the panel/labels would show after calc.js.

import { readFileSync } from 'node:fs';
import { askModel } from '../_lib/model.js';
import { evaluateCalc, formatLabel } from '../../src/physics/calc.js';

const [imagePath, question] = process.argv.slice(2);
if (!imagePath || !question) {
  console.log('usage: node --env-file=.env.local api/_dev/try.mjs <photo.jpg> "<question>"');
  process.exit(1);
}

const t0 = Date.now();
const ext = imagePath.split('.').pop().toLowerCase();
const mime = { heic: 'image/heic', heif: 'image/heif', png: 'image/png', webp: 'image/webp' }[ext] || 'image/jpeg';
const result = await askModel(readFileSync(imagePath).toString('base64'), question, null, mime);
console.log(`(${Date.now() - t0} ms)`);
if (!result.ok) {
  console.error('FAILED:', result.error);
  process.exit(1);
}

const data = result.value;
console.log(JSON.stringify(data, null, 2));

const physics = evaluateCalc(data.calc);
console.log('\n--- On screen ---');
console.log('Caption:', data.answer);
if (data.followup_question) console.log('Follow-up:', data.followup_question);
for (const item of data.draw) {
  console.log(`[${item.type}] ${item.id}: ${formatLabel(item.label, item.quantity, physics)}`);
  if (item.type === 'panel' && item.content === 'calc') {
    console.log('   ' + item.text.replace(/\n/g, '\n   '));
    for (const line of physics.lines) console.log('   ' + line);
    if (physics.assumptions.length) console.log('   Assumptions: ' + physics.assumptions.join('; '));
  }
}
if (physics.verdict) console.log('VERDICT: ' + physics.verdict.text + ' [' + physics.verdict.check + ']');
import('../../src/physics/calc.js').then(({ auditText }) => {
  const loose = [data.answer, ...data.draw.map((i) => i.text || '')].flatMap((t) => auditText(t, physics, data.calc));
  if (data.calc) console.log(loose.length ? 'TEXT AUDIT: untraced numbers ⚠ ' + loose.map((x) => x.text).join(', ') : 'TEXT AUDIT: all numbers in the text trace to checked values ✓');
});
if (data.calc) console.log(physics.verified ? 'CHECKER: all steps verified ✓' : 'CHECKER: ' + physics.mismatches.length + ' mismatch(es) ⚠ ' + JSON.stringify(physics.mismatches));
if (physics.errors.length) console.log('CALC ERRORS: ' + physics.errors.join('; '));
if (data.calc && !data.draw.some((i) => i.content === 'calc')) for (const line of physics.lines) console.log('   ' + line);
