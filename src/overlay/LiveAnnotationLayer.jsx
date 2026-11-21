import { useEffect, useRef } from 'react';
import { drawScene } from './drawScene.js';
import { buildScene } from './scene.js';
import { coverRect } from './coverRect.js';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Live mode overlay: redraws every animation frame from live.trackedScene() (positions follow the
// real spots via Josh's tracker), with the AI's gestures animating on top.
// The live session sends Gemini the WHOLE video frame, while the screen shows it cropped
// (object-fit: cover), so the frame rect comes from coverRect().
export default function LiveAnnotationLayer({ live, store, video, hidden, bottomInset = 0, topRight = null, onTracking }) {
  const ref = useRef(null);
  const opts = useRef({});
  opts.current = { bottomInset, topRight, hidden, onTracking };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let lastLost = null;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const o = opts.current;
      if (!live || o.hidden) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      const tracked = live.trackedScene();
      const lost = Boolean(tracked.tracking?.lost);
      if (lost !== lastLost) {
        lastLost = lost;
        o.onTracking?.(lost);
      }
      const scene = buildScene({ draw: tracked.items }, null, { calc: store.get().calc ?? undefined });
      drawScene(ctx, scene, w, h, {
        frame: video ? coverRect(video.videoWidth, video.videoHeight, w, h) : null,
        bottomInset: o.bottomInset,
        topRight: o.topRight,
        gestures: store.gestures,
        points: tracked.points,
        now,
        reduceMotion: reduceMotion(),
      });
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, store, video]);

  return <canvas ref={ref} className="annotation-layer" aria-hidden="true" />;
}
