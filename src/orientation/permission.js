// iOS 13+ requires DeviceOrientation permission, requested from inside a user tap.
// Call this FIRST in the tap handler, before any `await`, or iOS rejects it.
// Resolves to 'granted' | 'denied'. Never throws.

export function requestOrientationPermission() {
  const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
  if (!DOE) return Promise.resolve('denied');
  if (typeof DOE.requestPermission !== 'function') return Promise.resolve('granted'); // Android / desktop
  return DOE.requestPermission().catch(() => 'denied');
}

// iOS also gates DeviceMotion (devicemotion events) behind its own permission, requested the same way.
// Live mode needs it to notice the phone being put down / picked up (src/client/parked.js).
export function requestMotionPermission() {
  const DME = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined;
  if (!DME) return Promise.resolve('denied');
  if (typeof DME.requestPermission !== 'function') return Promise.resolve('granted'); // Android / desktop
  return DME.requestPermission().catch(() => 'denied');
}
