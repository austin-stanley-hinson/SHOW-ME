// Model-agnostic entry point. Picks a provider (MODEL_PROVIDER, default "gemini"), sends one image +
// question, then parses and validates the reply the same way for every model.
// Adding a model = one file in ./providers exporting { name, generate }, plus one line below.
//
//   askModel(imageBase64, question, previous?, mimeType?) -> { ok: true, value, meta } | { ok: false, error, status?, meta }

import { buildPrompt } from './prompt.js';
import { toContractCoords } from './coords.js';
import { validateResponse } from './validate.js';
import * as gemini from './providers/gemini.js';

const PROVIDERS = { gemini };
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS) || 55_000;

export async function askModel(imageBase64, question, previous = null, mimeType = 'image/jpeg') {
  const provider = PROVIDERS[process.env.MODEL_PROVIDER || 'gemini'];
  if (!provider) return { ok: false, error: `unknown MODEL_PROVIDER "${process.env.MODEL_PROVIDER}"`, status: 500 };

  const t0 = Date.now();
  const prev =
    previous && typeof previous.question === 'string' && previous.response
      ? { question: previous.question.slice(0, 500), responseText: JSON.stringify(previous.response).slice(0, 8000) }
      : null;
  // One time budget for all attempts; the client timeout (askApi.js) must be a bit longer.
  const out = await provider.generate({
    systemPrompt: buildPrompt(provider.coords || 'xy01'),
    imageBase64,
    mimeType,
    question,
    previous: prev,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const meta = { ...out.meta, ms: Date.now() - t0 };
  console.log('model', JSON.stringify(meta)); // timings + token counts only, never the image or text

  if (!out.ok) return { ok: false, error: out.error, status: out.status, meta };
  let data;
  try {
    data = JSON.parse(out.text.replace(/^\s*```(?:json)?|```\s*$/g, '')); // strip fences if a model adds them
  } catch {
    return { ok: false, error: `model did not return valid JSON (finish: ${meta.finish}, ${out.text.length} chars)`, meta };
  }
  // The client sends its current scene as previous.response, so narration/edits may refer to items on screen.
  const previousIds = Array.isArray(previous?.response?.draw) ? previous.response.draw.map((i) => i?.id).filter((x) => typeof x === 'string') : [];
  if (provider.coords && provider.coords !== 'xy01') data = toContractCoords(data, provider.coords);
  return { ...validateResponse(data, { previousIds }), meta };
}
