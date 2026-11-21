// Where a video frame sits on screen when shown with object-fit: cover (centered crop).
// Returns { x, y, w, h } in px; x/y can be negative (the frame is bigger than the screen).
export function coverRect(videoW, videoH, boxW, boxH) {
  if (!videoW || !videoH) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}
