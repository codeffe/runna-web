// Port of `app/Runna/Domain/Engine/RaceMath.swift`.
//
// MARK: - Race time equivalence
//
// Runna exposes `getEstimatedRaceTimeInternal { fast slow }` — a predicted
// finish range rather than a single number. We produce that range by combining
// two independent estimators:
//
//   * Riegel's endurance model:  T2 = T1 * (D2 / D1) ^ 1.06
//   * Daniels' VDOT model:       solve for the time at which the athlete can
//                                sustain the required fraction of VO2max
//
// The two rarely agree exactly, so the spread between them becomes the
// fast/slow band we surface to the athlete.

/** Nominal race distances in metres, mirroring `Goal.raceDistance`. */
export const RACE_DISTANCES = Object.freeze({
  fiveK: 5000,
  tenK: 10000,
  halfMarathon: 21097.5,
  marathon: 42195,
  ultra: 50000,
});

// MARK: Riegel

/**
 * Riegel's formula. `exponent` drifts up for longer races.
 *
 * @param {number} seconds time over `fromMeters`
 * @param {number} fromMeters distance actually raced
 * @param {number} toMeters distance to predict
 * @returns {number} predicted time in seconds, or 0 for degenerate input
 */
export function riegel(seconds, fromMeters, toMeters) {
  if (!(seconds > 0) || !(fromMeters > 0) || !(toMeters > 0)) return 0;
  const exponent = riegelExponent(toMeters);
  return seconds * Math.pow(toMeters / fromMeters, exponent);
}

/**
 * Endurance exponent, tuned by race distance (Riegel 1.06 is the classic
 * middle-distance value; longer races reward durability slightly more).
 */
export function riegelExponent(meters) {
  if (meters < 3000) return 1.04;
  if (meters < 10000) return 1.06;
  if (meters < 21097.5) return 1.07;
  if (meters < 42195) return 1.08;
  return 1.09;
}

// MARK: Daniels VDOT

/**
 * Oxygen cost (ml/kg/min) of running at `velocity` metres per minute.
 */
export function vo2(velocity) {
  return -4.6 + 0.182258 * velocity + 0.000104 * velocity * velocity;
}

/** Alias matching the Swift label `vo2(forVelocity:)`. */
export const vo2ForVelocity = vo2;

/**
 * Fraction of VO2max an athlete can sustain for `minutes`.
 */
export function sustainableFraction(minutes) {
  if (!(minutes > 0)) return 1;
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * minutes) +
    0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}

/**
 * Velocity (m/min) that costs exactly `targetVO2`.
 * Solves the oxygen-cost quadratic `a·v² + b·v + c = 0` for its positive root.
 */
export function velocityForVO2(targetVO2) {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + targetVO2);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  return (-b + Math.sqrt(disc)) / (2 * a);
}

/**
 * VDOT — Daniels' effective VO2max — implied by a race performance.
 *
 * @param {number} distanceMeters
 * @param {number} seconds
 */
export function vdot(distanceMeters, seconds) {
  if (!(distanceMeters > 0) || !(seconds > 0)) return 0;
  const minutes = seconds / 60;
  const velocity = distanceMeters / minutes;
  const cost = vo2(velocity);
  const fraction = sustainableFraction(minutes);
  if (!(fraction > 0)) return 0;
  return cost / fraction;
}

/**
 * Time (seconds) to cover `distanceMeters` at a given VDOT.
 *
 * @param {number} distanceMeters
 * @param {number} vdotValue
 */
export function time(distanceMeters, vdotValue) {
  if (!(distanceMeters > 0) || !(vdotValue > 0)) return 0;
  // Binary search on time: the athlete's sustainable fraction falls as the
  // race gets longer, so achievable velocity is monotonically decreasing.
  let low = 1;
  let high = 60 * 600; // 10 hours
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const minutes = mid / 60;
    const achievableVO2 = vdotValue * sustainableFraction(minutes);
    const v = velocityForVO2(achievableVO2);
    const covered = v * minutes;
    if (covered < distanceMeters) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The fast/slow band Runna shows, seconds.
 *
 * @returns {{ fast: number, slow: number }}
 */
export function estimatedRaceTime(fromDistance, fromTime, toDistance) {
  if (!(fromDistance > 0) || !(fromTime > 0) || !(toDistance > 0)) {
    return { fast: 0, slow: 0 };
  }
  const r = riegel(fromTime, fromDistance, toDistance);
  const d = time(toDistance, vdot(fromDistance, fromTime));
  if (!(r > 0) || !(d > 0)) return { fast: r, slow: r };
  const fast = Math.min(r, d);
  const slow = Math.max(r, d);
  // Widen slightly at longer distances — predictions get less certain.
  const uncertainty = toDistance >= 21097.5 ? 0.035 : 0.02;
  return { fast: fast * (1 - uncertainty), slow: slow * (1 + uncertainty) };
}

/** The whole namespace, for callers that prefer `RaceMath.vdot(...)`. */
export const RaceMath = Object.freeze({
  riegel,
  riegelExponent,
  vo2,
  vo2ForVelocity,
  sustainableFraction,
  velocityForVO2,
  vdot,
  time,
  estimatedRaceTime,
  RACE_DISTANCES,
});
