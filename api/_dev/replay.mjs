// Replay a Live Lab debug report: writes the frames the model saw, with its drawings (yellow) and the
// precise-point snaps (green) drawn on top, plus a readable timeline. For diagnosing "it pointed at the
// wall" vs "the tracker drifted".
//
//   node api/_dev/replay.mjs show-me-debug-....json out-dir
//
// Drawing on JPEGs uses Windows PowerShell (System.Drawing), so this runs on the team's Windows laptop.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const [file, outArg] = process.argv.slice(2);
if (!file) {
  console.log('usage: node api/_dev/replay.mjs <report.json> [out-dir]');
  process.exit(1);
}
const out = resolve(outArg || 'replay-out');
mkdirSync(out, { recursive: true });
const rep = JSON.parse(readFileSync(file, 'utf8'));
const lines = [`model ${rep.model}  video ${rep.video?.w}x${rep.video?.h}  ${rep.userAgent || ''}`, ''];
const shapes = {}; // frameId -> [{ kind, color, pts, label }]
const add = (fid, s) => (shapes[fid] ||= []).push(s);
const yx = (p) => (Array.isArray(p) ? [p[1] / 1000, p[0] / 1000] : null); // tool args are [y, x] 0-1000

for (const e of rep.events) {
  const t = (e.t / 1000).toFixed(1).padStart(6);
  if (e.type === 'tool') {
    lines.push(`${t}s TOOL ${e.data.name} (frame ${e.data.frameId}) ${JSON.stringify(e.data.args).slice(0, 300)}`);
    if (e.data.response?.error || e.data.response?.dropped) lines.push(`        -> ${JSON.stringify(e.data.response).slice(0, 200)}`);
    if (e.data.name === 'show') {
      const pts = Object.fromEntries((e.data.args.points || []).map((p) => [p.id, yx(p.at)]));
      for (const [id, at] of Object.entries(pts)) add(e.data.frameId, { kind: 'dot', color: 'Yellow', pts: [at], label: id });
      for (const it of e.data.args.items || []) {
        const at = yx(it.at) || pts[it.at_point];
        const from = yx(it.from) || pts[it.from_point];
        const to = yx(it.to) || pts[it.to_point];
        if (it.type === 'arrow' || it.type === 'line') from && to && add(e.data.frameId, { kind: 'arrow', color: 'Yellow', pts: [from, to], label: it.label || it.id });
        else if (at) add(e.data.frameId, { kind: it.type === 'circle' ? 'ring' : 'dot', color: 'Yellow', pts: [at], r: (it.r || 45) / 1000, label: it.label || it.id });
      }
    }
  } else if (e.type === 'refine') {
    lines.push(`${t}s PRECISE (frame ${e.data.frameId}, ${e.data.ms} ms) ${JSON.stringify(e.data.result).slice(0, 300)}`);
    for (const p of e.data.result?.points || []) add(e.data.frameId, { kind: 'dot', color: 'Lime', pts: [p.at], label: p.id + ' (snapped)' });
  } else if (e.type === 'tracked') {
    // summarize tracking once per ~2 s
    if (Math.round(e.t / 500) % 4 === 0) lines.push(`${t}s tracked q=${e.data.quality}${e.data.lost ? ' LOST' : ''} ${e.data.items.map((i) => `${i.id}${i.stale ? '(stale)' : ''}@${JSON.stringify(i.at || i.to)}`).join(' ')}`);
  } else {
    lines.push(`${t}s ${e.type.toUpperCase()} ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data).slice(0, 200)}`);
  }
}
writeFileSync(join(out, 'timeline.txt'), lines.join('\n'));

// Frames that had drawings: write JPEG + shapes, then draw with PowerShell.
const jobs = [];
for (const [fid, list] of Object.entries(shapes)) {
  const f = rep.frames[fid];
  if (!f) continue;
  const jpg = join(out, `frame-${fid}.jpg`);
  writeFileSync(jpg, Buffer.from(f.jpeg, 'base64'));
  jobs.push({ src: jpg, dst: join(out, `frame-${fid}-annotated.png`), shapes: list });
}
writeFileSync(join(out, 'jobs.json'), JSON.stringify(jobs));
const ps = `
Add-Type -AssemblyName System.Drawing
$jobs = Get-Content -Raw '${join(out, 'jobs.json').replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($j in $jobs) {
  $img = [System.Drawing.Image]::FromFile($j.src); $bmp = New-Object System.Drawing.Bitmap $img; $img.Dispose()
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'
  $W = $bmp.Width; $H = $bmp.Height; $font = New-Object System.Drawing.Font('Segoe UI', [Math]::Max(9, $W / 45), [System.Drawing.FontStyle]::Bold)
  foreach ($s in $j.shapes) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromName($s.color)), ([Math]::Max(2, $W / 160))
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromName($s.color))
    $p = $s.pts[0]; $x = $p[0] * $W; $y = $p[1] * $H
    if ($s.kind -eq 'arrow') { $q = $s.pts[1]; $pen.CustomEndCap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap 4, 4; $g.DrawLine($pen, [float]$x, [float]$y, [float]($q[0] * $W), [float]($q[1] * $H)); $x = $q[0] * $W; $y = $q[1] * $H }
    elseif ($s.kind -eq 'ring') { $r = $s.r * $W; $g.DrawEllipse($pen, [float]($x - $r), [float]($y - $r), [float](2 * $r), [float](2 * $r)) }
    else { $g.FillEllipse($brush, [float]($x - 6), [float]($y - 6), 12, 12) }
    $g.DrawString($s.label, $font, $brush, [float]($x + 8), [float]($y - 18))
  }
  $bmp.Save($j.dst, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}`;
if (jobs.length) execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
console.log(`timeline: ${join(out, 'timeline.txt')}\nannotated frames: ${jobs.map((j) => j.dst).join('\n  ')}`);
