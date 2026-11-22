import { useState } from 'react';

// The "Share live" link, once the session exists on the relay. "Share link" opens the iOS share sheet
// (it must run directly in the tap); "Copy" is the fallback.
export default function ShareBox({ share, onStop }) {
  const [copied, setCopied] = useState(false);
  if (!share) return null;

  if (share.status === 'creating') {
    return (
      <div className="share-box" role="status">
        <span className="spinner" aria-hidden="true" /> Starting a live shared view…
      </div>
    );
  }
  if (share.status === 'error') {
    return (
      <div className="share-box" role="alert">
        <p>Couldn’t start sharing ({share.error}).</p>
        <button type="button" className="toggle" onClick={onStop}>
          OK
        </button>
      </div>
    );
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function copy() {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="share-box">
      <p className="share-title">
        <span className="dot" aria-hidden="true" /> Sharing live
      </p>
      <p className="share-detail">
        Anyone with the link sees this answer and can try the “what if” sliders with you. Your camera image isn’t shared.
      </p>
      <p className="share-url">{share.url}</p>
      <div className="share-actions">
        {canShare && (
          <button
            type="button"
            className="big-button"
            onClick={() => navigator.share({ title: 'Show Me', text: 'See this live with me', url: share.url }).catch(() => {})}
          >
            Share link
          </button>
        )}
        <button type="button" className="toggle" onClick={copy} aria-live="polite">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="toggle" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}
