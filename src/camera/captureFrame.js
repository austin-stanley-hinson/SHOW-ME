// Captures exactly what the user sees (CONTRACT.md v2.1 "Which image").
//
// The <video> is shown with object-fit: cover, so the browser crops the camera image to the
// screen's aspect ratio. We apply the same centered crop here, so normalized [x, y] from
// Gemini map 1:1 onto the screen.
//
// Returns a canvas at the camera's native resolution for the visible region
// (askApi.js downscales it to 1024px before upload).

export function captureFrame(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const dw = video.clientWidth;
  const dh = video.clientHeight;
  if (!vw || !vh || !dw || !dh) return null;

  // Same math as object-fit: cover (centered).
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
