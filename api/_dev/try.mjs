// Test the Gemini prompt from your laptop, no app needed.
//
//   node --env-file=.env.local api/_dev/try.mjs photo.jpg "Why isn't it falling?"
//
// Prints Gemini's validated JSON, then what the panel/labels would show after physics.js.

import { readFileSync } from 'node:fs';
import { askGemini } from '../_lib/gemini.js';
import { computePhysics, formatLabel } from '../../src/physics/physics.js';

const [imagePath, question] = process.argv.slice(2);
if (!imagePath || !question) {
  console.log('usage: node --env-file=.env.local api/_dev/try.mjs <photo.jpg> "<question>"');
  process.exit(1);
}

const t0 = Date.now();
const ext = imagePath.split('.').pop().toLowerCase();
const mime = { heic: 'image/heic', heif: 'image/heif', png: 'image/png', webp: 'image/webp' }[ext] || 'image/jpeg';
const result = await askGemini(readFileSync(imagePath).toString('base64'), question, null, mime);
console.log(`(${Date.now() - t0} ms)`);
if (!result.ok) {
  console.error('FAILED:', result.error);
  process.exit(1);
}

const data = result.value;
console.log(JSON.stringify(data, null, 2));

const physics = computePhysics(data.physics);
console.log('\n--- On screen ---');
console.log('Caption:', data.answer);
if (data.followup_question) console.log('Follow-up:', data.followup_question);
for (const item of data.draw) {
  console.log(`[${item.type}] ${item.id}: ${formatLabel(item.label, item.quantity, physics)}`);
  if (item.type === 'panel' && item.content === 'physics') {
    console.log('   ' + item.text.replace(/\n/g, '\n   '));
    for (const line of physics.lines) console.log('   ' + line);
    if (physics.assumptions.length) console.log('   Assumptions: ' + physics.assumptions.join('; '));
  }
}
if (data.physics && !physics.ok) console.log('(physics inputs invalid: numbers hidden)');
