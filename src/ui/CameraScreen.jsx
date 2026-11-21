import { useEffect, useRef, useState } from 'react';
import { captureFrame } from '../camera/captureFrame.js';

// Live camera, full screen. "Ask" freezes the frame that would be sent to Gemini.
// The overlay (three.js) and the real ask flow come in later branches.
export default function CameraScreen({ stream, orientation }) {
  const videoRef = useRef(null);
  const frozenRef = useRef(null);
  const [frozen, setFrozen] = useState(null); // canvas or null
  const [caption, setCaption] = useState(
    orientation === 'granted' ? 'Point at something and tap Ask.' : 'Motion sensors are off, so drawings won’t follow the phone.',
  );

  useEffect(() => {
    const video = videoRef.current;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Show the captured canvas itself, so what's on screen is exactly what gets sent.
  useEffect(() => {
    const box = frozenRef.current;
    if (!box) return;
    box.replaceChildren(...(frozen ? [frozen] : []));
  }, [frozen]);

  function handleAsk() {
    const canvas = captureFrame(videoRef.current);
    if (!canvas) {
      setCaption('The camera isn’t ready yet. Try again in a second.');
      return;
    }
    setFrozen(canvas);
    setCaption(`Frozen frame: ${canvas.width}×${canvas.height}. This is what Gemini would see.`);
  }

  function handleLive() {
    setFrozen(null);
    setCaption('Point at something and tap Ask.');
  }

  return (
    <main className="camera-screen">
      <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
      <div ref={frozenRef} className="frozen-frame" hidden={!frozen} />

      <div className="bottom-bar">
        <p className="caption" role="status" aria-live="polite">
          {caption}
        </p>
        {frozen ? (
          <button type="button" className="big-button" onClick={handleLive}>
            Back to live
          </button>
        ) : (
          <button type="button" className="big-button" onClick={handleAsk}>
            Ask
          </button>
        )}
      </div>
    </main>
  );
}
