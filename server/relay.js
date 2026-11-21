// Session relay: teammates share one "world document" live.
// Plain Node, no dependencies. Server-Sent Events down, JSON POSTs up. Works in iPhone Safari.
//
//   POST /s                     { doc? }               -> { id }            create a session
//   GET  /s/:id/events                                  -> SSE stream        "state" on connect and on every change
//   POST /s/:id                 { type: "doc", doc }                        replace the document (after a new AI answer)
//                               { type: "input", name, value, by? }         set one calc input (e.g. a load slider)
//   GET  /health                                        -> "ok"
//
// State lives in memory only (sessions expire after SESSION_TTL_MS idle). Images are never accepted:
// the document is the contract JSON (answer, points, calc, draw), not the camera frame.

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
const MAX_BODY = 256 * 1024;
const MAX_SESSIONS = 200;
const MAX_CLIENTS = 25;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const KEEPALIVE_MS = 20_000;
const ID = /^[a-z0-9]{6}$/;
const NAME = /^(?!__)[A-Za-z_][A-Za-z0-9_]{0,31}$/;

// id -> { doc, inputs: { name: { value, by } }, version, clients: Set<res>, touched }
const sessions = new Map();

function newId() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

function cors(req, res) {
  const origin = req.headers.origin;
  const allow = ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : null;
  if (allow) res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c); // past the limit: keep draining, stop storing
    });
    req.on('end', () => {
      if (size > MAX_BODY) return resolve({ error: 'too large', status: 413 });
      try {
        resolve({ value: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
      } catch {
        resolve({ error: 'bad json' });
      }
    });
  });
}

const snapshot = (s) => ({ doc: s.doc, inputs: s.inputs, version: s.version });

function broadcast(s) {
  s.version++;
  s.touched = Date.now();
  const msg = `event: state\ndata: ${JSON.stringify(snapshot(s))}\n\n`;
  for (const res of s.clients) res.write(msg);
}

function isDoc(doc) {
  // Contract-shaped object without a camera frame in it.
  return doc && typeof doc === 'object' && !Array.isArray(doc) && !('image' in doc);
}

export function createServer() {
  const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean); // ["s", id, "events"]

    if (req.method === 'GET' && url.pathname === '/health') return res.writeHead(200).end('ok');

    if (req.method === 'POST' && url.pathname === '/s') {
      if (sessions.size >= MAX_SESSIONS) return send(res, 503, { error: 'too many sessions' });
      const body = await readJson(req);
      if (body.error) return send(res, body.status || 400, { error: body.error });
      const doc = body.value.doc ?? null;
      if (doc !== null && !isDoc(doc)) return send(res, 400, { error: 'bad doc' });
      let id;
      do id = newId();
      while (sessions.has(id));
      sessions.set(id, { doc, inputs: {}, version: 0, clients: new Set(), touched: Date.now() });
      return send(res, 201, { id });
    }

    if (parts[0] !== 's' || !ID.test(parts[1] || '')) return send(res, 404, { error: 'not found' });
    const s = sessions.get(parts[1]);
    if (!s) return send(res, 404, { error: 'no such session' });

    if (req.method === 'GET' && parts[2] === 'events' && parts.length === 3) {
      if (s.clients.size >= MAX_CLIENTS) return send(res, 503, { error: 'session full' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: state\ndata: ${JSON.stringify(snapshot(s))}\n\n`);
      s.clients.add(res);
      s.touched = Date.now();
      const ping = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);
      req.on('close', () => {
        clearInterval(ping);
        s.clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && parts.length === 2) {
      const body = await readJson(req);
      if (body.error) return send(res, body.status || 400, { error: body.error });
      const m = body.value;
      if (m.type === 'doc') {
        if (!isDoc(m.doc)) return send(res, 400, { error: 'bad doc' });
        s.doc = m.doc;
        s.inputs = {}; // a new model starts from its own values
      } else if (m.type === 'input') {
        if (typeof m.name !== 'string' || !NAME.test(m.name)) return send(res, 400, { error: 'bad name' });
        if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return send(res, 400, { error: 'bad value' });
        if (Object.keys(s.inputs).length >= 50 && !Object.hasOwn(s.inputs, m.name)) {
          return send(res, 400, { error: 'too many inputs' });
        }
        s.inputs[m.name] = { value: m.value, by: typeof m.by === 'string' ? m.by.slice(0, 24) : null };
      } else {
        return send(res, 400, { error: 'unknown type' });
      }
      broadcast(s);
      return send(res, 200, { version: s.version });
    }

    send(res, 404, { error: 'not found' });
  });

  // Drop idle sessions.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.clients.size === 0 && now - s.touched > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 60_000);
  sweep.unref();
  server.on('close', () => clearInterval(sweep));
  return server;
}

// Run directly: node server/relay.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('relay.js')) {
  createServer().listen(PORT, '127.0.0.1', () => console.log(`relay listening on 127.0.0.1:${PORT}`));
}
