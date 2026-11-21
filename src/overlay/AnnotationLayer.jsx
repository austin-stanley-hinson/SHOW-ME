import { useEffect, useRef } from 'react';
import { drawScene } from './drawScene.js';

// Transparent canvas over the frozen frame. Redraws on scene change, inset change and resize.
// bottomInset: height (px) of the UI covering the bottom of the screen; text stays above it.
export default function AnnotationLayer({ scene, bottomInset = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    function draw() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, scene, w, h, { bottomInset });
    }
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [scene, bottomInset]);

  // Decorative for screen readers: the same content is in the caption area as real text.
  return <canvas ref={ref} className="annotation-layer" aria-hidden="true" />;
}
