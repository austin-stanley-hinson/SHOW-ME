// "Phone put down" detection (lane B). Pure logic: feed it orientation + motion samples, it tells you when
// the phone is parked (lying flat and still) and when it's been picked back up.
//
//   const pd = createParkDetector({ onPark, onPickup });
//   addEventListener('deviceorientation', (e) => pd.orientation(e.beta, e.gamma, performance.now()));
//   addEventListener('devicemotion', (e) => pd.motion(e.accelerationIncludingGravity, performance.now()));
//
// Flat = within ~25° of face-up or face-down. Still = acceleration barely changing. Parked after 1.2 s of
// both; picked up as soon as it's clearly tilted up or moved (so feedback starts right away).

const FLAT_DEG = 25;
const PARK_AFTER_MS = 1200;
const STILL_JERK = 0.6; // m/s^2 change between samples counted as "still"
const MOVED_JERK = 2.5; // a clear pickup

export function isFlat(beta, gamma) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return false;
  const faceUp = Math.abs(beta) < FLAT_DEG && Math.abs(gamma) < FLAT_DEG;
  const faceDown = Math.abs(beta) > 180 - FLAT_DEG && Math.abs(gamma) < FLAT_DEG;
  return faceUp || faceDown;
}

export function createParkDetector({ onPark = () => {}, onPickup = () => {} } = {}) {
  let flat = false;
  let lastAcc = null;
  let stillSince = null;
  let parked = false;

  function update(now) {
    if (!parked && flat && stillSince !== null && now - stillSince >= PARK_AFTER_MS) {
      parked = true;
      onPark();
    }
  }

  return {
    orientation(beta, gamma, now) {
      flat = isFlat(beta, gamma);
      if (parked && !flat) {
        parked = false;
        stillSince = null;
        onPickup('tilted');
      }
      update(now);
    },
    motion(acc, now) {
      if (!acc || !Number.isFinite(acc.x)) return;
      const a = [acc.x, acc.y, acc.z];
      const jerk = lastAcc ? Math.hypot(a[0] - lastAcc[0], a[1] - lastAcc[1], a[2] - lastAcc[2]) : 0;
      lastAcc = a;
      if (jerk > MOVED_JERK && parked) {
        parked = false;
        stillSince = null;
        onPickup('moved');
        return;
      }
      if (jerk < STILL_JERK) {
        if (stillSince === null) stillSince = now;
      } else stillSince = null;
      update(now);
    },
    get parked() {
      return parked;
    },
  };
}
