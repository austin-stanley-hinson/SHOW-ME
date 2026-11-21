// POST /api/live-token -> { token, model, expiresAt }
// Mints a one-use Gemini Live token with our model, instructions and tools locked in, so the phone can
// stream directly to Gemini without the API key. The phone connects to:
//   wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=<token>
// and sends { setup: {} } (the locked setup applies).

import { liveSetup, LIVE_MODEL } from './_lib/live.js';

// Optional: only mint for our own pages (comma-separated origins). Leave unset during development.
const ALLOWED = (process.env.LIVE_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (ALLOWED.length && !ALLOWED.includes(req.headers.origin)) return res.status(403).json({ error: 'origin not allowed' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });

  const now = Date.now();
  const expiresAt = new Date(now + 30 * 60_000).toISOString(); // a session can last up to 30 min
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(), // must connect within 2 min
        bidiGenerateContentSetup: liveSetup({ pushToTalk: req.body?.pushToTalk === true }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error('live-token failed:', r.status);
      return res.status(502).json({ error: `token HTTP ${r.status}` });
    }
    const { name } = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token: name, model: LIVE_MODEL, expiresAt });
  } catch (e) {
    return res.status(502).json({ error: e.name === 'TimeoutError' ? 'timed out' : 'could not reach Gemini' });
  }
}
