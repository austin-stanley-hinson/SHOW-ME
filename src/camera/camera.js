// Rear camera stream. getUserMedia needs HTTPS (or localhost).

export async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('Camera API unavailable');
    err.name = 'NoCameraApi';
    throw err;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Plain-language message for the caption area.
export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera access was blocked. On iPhone: Settings → Safari → Camera → Allow, then reload.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found on this device.';
    case 'NotReadableError':
      return 'The camera is being used by another app. Close it and try again.';
    case 'NoCameraApi':
      return 'This page needs a secure (https://) address to use the camera.';
    default:
      return 'Could not start the camera. Please reload and try again.';
  }
}
