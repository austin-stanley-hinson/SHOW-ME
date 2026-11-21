import { useEffect, useState } from 'react';
import StartScreen from './ui/StartScreen.jsx';
import CameraScreen from './ui/CameraScreen.jsx';
import { openCamera, stopCamera, cameraErrorMessage } from './camera/camera.js';
import { requestOrientationPermission } from './orientation/permission.js';
import { noCamera } from './ui/devMode.js';

export default function App() {
  const [started, setStarted] = useState(false);
  const [stream, setStream] = useState(null);
  const [orientation, setOrientation] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => () => stopCamera(stream), [stream]);

  async function handleStart() {
    // iOS: the motion permission must be requested synchronously inside the tap.
    const orientationPromise = requestOrientationPermission();
    setBusy(true);
    setMessage('');
    try {
      if (!noCamera) setStream(await openCamera());
      setOrientation(await orientationPromise);
      setStarted(true);
    } catch (err) {
      setMessage(cameraErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!started) return <StartScreen onStart={handleStart} busy={busy} message={message} />;
  return <CameraScreen stream={stream} orientation={orientation} />;
}
