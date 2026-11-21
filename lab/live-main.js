// Live Lab: a bare test page for live mode (lane B). The real app UI is lane A; this page exists so the
// team can try live narration on a phone and give feedback while it's being built.
import { startLive } from '../src/client/live.js';
import { formatLabel } from '../src/physics/calc.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const g2d = canvas.getContext('2d');
let live = null;
let scene = { items: [], points: [] };
let calcResult = null;
const gestures = new Map(); // target id -> { type, start, until }

// Contract [x, y] 0-1 of the full video frame -> canvas pixels (video uses object-fit: contain).
function frameRect() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const s = Math.min(cw / vw, ch / vh);
  return { x: (cw - vw * s) / 2, y: (ch - vh * s) / 2, w: vw * s, h: vh * s };
}
const pointById = (id) => scene.points.find((p) => p.id === id);
function toPx(pos, r) {
  const p = typeof pos === 'string' ? pointById(pos)?.at : pos;
  return p ? [r.x + p[0] * r.w, r.y + p[1] * r.h] : null;
}

function arrow(ctx, a, b, color, w) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - 18 * Math.cos(ang - 0.45), b[1] - 18 * Math.sin(ang - 0.45));
  ctx.lineTo(b[0] - 18 * Math.cos(ang + 0.45), b[1] - 18 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}
function text(ctx, s, x, y, color) {
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color || '#fff';
  ctx.fillText(s, x, y);
}
function ring(ctx, p, radius, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(p[0], p[1], radius, 0, Math.PI * 2);
  ctx.stroke();
}

function draw(now) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(canvas.clientWidth * dpr)) {
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }
  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  g2d.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const r = frameRect();

  for (const it of scene.items) {
    const color = it.color || '#ffcc00';
    const g = gestures.get(it.id) || Object.values(it.refs || {}).map((id) => gestures.get(id)).find(Boolean);
    const active = Boolean(g && g.until > now);
    const pulse = active && g.type === 'pulse' ? 1 + 0.3 * Math.sin(now / 90) : 1;
    const label = formatLabel(it.label, it.quantity, calcResult);

    if (it.type === 'arrow' || it.type === 'line') {
      const a = toPx(it.from, r);
      const b = toPx(it.to, r);
      if (!a || !b) continue;
      if (it.type === 'arrow') arrow(g2d, a, b, color, 5 * pulse);
      else {
        g2d.strokeStyle = color;
        g2d.lineWidth = 4 * pulse;
        g2d.beginPath();
        g2d.moveTo(a[0], a[1]);
        g2d.lineTo(b[0], b[1]);
        g2d.stroke();
      }
      if (active && g.type === 'trace') {
        const t = ((now - g.start) % 1200) / 1200;
        g2d.fillStyle = '#fff';
        g2d.beginPath();
        g2d.arc(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 9, 0, Math.PI * 2);
        g2d.fill();
      }
      if (label) text(g2d, label, (a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 8, color);
      continue;
    }

    const p = toPx(it.at, r);
    if (!p) continue;
    if (it.type === 'panel') {
      text(g2d, it.label || '', p[0], p[1] + 16);
      text(g2d, (it.text || '').slice(0, 90), p[0], p[1] + 36, '#ddd');
      continue;
    }
    if (it.type === 'circle') ring(g2d, p, (it.r || 0.04) * r.w * pulse, color, 4);
    if (it.type === 'point') {
      g2d.fillStyle = color;
      g2d.beginPath();
      g2d.arc(p[0], p[1], 7 * pulse, 0, Math.PI * 2);
      g2d.fill();
    }
    if (it.type === 'step') {
      g2d.fillStyle = '#ffcc00';
      g2d.beginPath();
      g2d.arc(p[0], p[1], 16 * pulse, 0, Math.PI * 2);
      g2d.fill();
      g2d.fillStyle = '#000';
      g2d.font = '700 16px system-ui, sans-serif';
      g2d.textAlign = 'center';
      g2d.fillText(String(it.n), p[0], p[1] + 6);
      g2d.textAlign = 'start';
    }
    if (label) text(g2d, label, p[0] + 16, p[1] - 12, color);
    if (active && (g.type === 'point' || g.type === 'circle')) ring(g2d, p, 26 + 6 * Math.sin(now / 120), '#fff', 3);
  }

  // Gestures aimed at bare named points (not drawn as items).
  for (const [id, g] of gestures) {
    if (g.until < now || scene.items.some((i) => i.id === id)) continue;
    const p = toPx(id, r);
    if (p) ring(g2d, p, 22 + 6 * Math.sin(now / 120), '#fff', 3);
  }
  requestAnimationFrame(draw);
}

async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

function showProcedure(p) {
  const lines = [`${p.title || 'Step'}: ${p.current}${p.total ? ' of ' + p.total : ''}`];
  for (const s of p.safety || []) lines.push('⚠ ' + s);
  if (p.done_when) lines.push('Done when: ' + p.done_when);
  if (p.complete) lines.push('✓ Complete');
  $('math').textContent = lines.join('\n');
}

$('go').onclick = async () => {
  $('go').disabled = true;
  try {
    await openCamera();
    live = await startLive({
      video,
      onScene: (s) => {
        scene = s;
      },
      onGesture: (g) => {
        const t = performance.now();
        gestures.set(g.target, { ...g, start: t, until: t + 2500 });
      },
      onProcedure: showProcedure,
      onCalc: ({ result }) => {
        calcResult = result;
        $('math').textContent = result.lines.join('\n') + (result.verdict ? `\n→ ${result.verdict.text}` : '');
      },
      onSaid: (t) => {
        $('said').textContent = t;
      },
      onHeard: (t) => {
        $('heard').textContent = 'You: ' + t;
      },
      onStatus: (s) => {
        $('status').textContent = s;
      },
      onError: (e) => {
        $('status').textContent = e.message;
      },
    });
    $('start').style.display = 'none';
    requestAnimationFrame(draw);
  } catch (e) {
    $('go').disabled = false;
    $('start').querySelector('p').textContent = 'Could not start: ' + e.message;
  }
};
$('send').onclick = () => {
  live?.say($('typed').value.trim());
  $('typed').value = '';
};
$('typed').onkeydown = (e) => {
  if (e.key === 'Enter') $('send').onclick();
};
$('mute').onclick = () => {
  const on = $('mute').textContent === 'Mute mic';
  live?.mute(on);
  $('mute').textContent = on ? 'Unmute' : 'Mute mic';
};
$('end').onclick = () => {
  live?.stop();
  $('status').textContent = 'Ended. Reload to start again.';
};
