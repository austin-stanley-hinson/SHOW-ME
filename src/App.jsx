import { useEffect, useState } from 'react';
import StartScreen from './ui/StartScreen.jsx';
import CameraScreen from './ui/CameraScreen.jsx';
import { openCamera, stopCamera, cameraErrorMessage } from './camera/camera.js';
import { requestOrientationPermission, requestMotionPermission } from './orientation/permission.js';
import { noCamera } from './ui/devMode.js';
import SharedView from './ui/SharedView.jsx';

// "Share live" links: ?s=<id> opens the shared view directly (no camera needed).
const sharedId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('s') : null;
const validSharedId = /^[a-z0-9]{6}$/.test(sharedId || '') ? sharedId : null;

export default function App() {
  const [started, setStarted] = useState(false);
  const [stream, setStream] = useState(null);
  const [orientation, setOrientation] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => () => stopCamera(stream), [stream]);

  async function handleStart() {
    // iOS: both motion permissions must be requested synchronously inside the tap (before any await).
    // Motion = devicemotion, used by live mode to notice the phone being put down / picked up.
    const orientationPromise = requestOrientationPermission();
    const motionPromise = requestMotionPermission();
    setBusy(true);
    setMessage('');
    try {
      if (!noCamera) setStream(await openCamera());
      setOrientation(await orientationPromise);
      await motionPromise; // if denied, live mode simply never treats the phone as put down
      setStarted(true);
    } catch (err) {
      setMessage(cameraErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (validSharedId) return <SharedView id={validSharedId} />;
  if (!started) return <StartScreen onStart={handleStart} busy={busy} message={message} />;
  return <CameraScreen stream={stream} orientation={orientation} />;
}
