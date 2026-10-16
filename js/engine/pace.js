// Port of `PaceTarget` + `PaceCalculator` from
// `app/Runna/Domain/Engine/RaceMath.swift`.
//
// Derives every training pace from a single fitness anchor (a recent race or
// the goal race), exactly as the Runna Engine does.

import { PACE_ZONES, TRAINING_ORDER } from './enums.js';
import { time as timeForVdot, velocityForVO2, vdot as vdotFor } from './raceMath.js';

/**
 * How wide each zone's band is around its mid pace. Easy/recovery get a wide
 * aerobic band; quality zones are tight. (`PaceCalculator.targets()`.)
 */
export const ZONE_SPREAD = Object.freeze({
  recovery: 0.075,
  easy: 0.065,
  steady: 0.04,
  tempo: 0.025,
  threshold: 0.02,
  interval: 0.02,
  repetition: 0.025,
  race: 0.0,
});

/**
 * A pace target — the JS form of the Swift `PaceTarget` struct.
 *
 * @param {string} zone PaceZone key
 * @param {number} fastSecondsPerKm faster bound (smaller number is faster)
 * @param {number} slowSecondsPerKm slower bound
 * @returns {{ zone: string, fastSecondsPerKm: number, slowSecondsPerKm: number, midSecondsPerKm: number }}
 */
export function createPaceTarget(zone, fastSecondsPerKm, slowSecondsPerKm) {
  return {
    zone,
    fastSecondsPerKm,
    slowSecondsPerKm,
    midSecondsPerKm: (fastSecondsPerKm + slowSecondsPerKm) / 2,
  };
}

/** Alias matching the Swift struct name. */
export const PaceTarget = createPaceTarget;

export class PaceCalculator {
  /**
   * @param {object} options
   * @param {number} options.vdot fitness anchor
   * @param {number|null} [options.goalRaceDistance] metres
   * @param {number|null} [options.goalRaceTime] seconds
   */
  constructor({ vdot = 0, goalRaceDistance = null, goalRaceTime = null } = {}) {
    this.vdot = Number.isFinite(vdot) ? vdot : 0;
    this.goalRaceDistance = goalRaceDistance ?? null;
    this.goalRaceTime = goalRaceTime ?? null;
    this._targets = null;
  }

  /**
   * Build from a recent performance rather than a VDOT.
   * Mirrors `PaceCalculator.init(recentDistance:recentTime:...)`.
   */
  static fromRecentRace({
    recentDistance,
    recentTime,
    goalRaceDistance = null,
    goalRaceTime = null,
  } = {}) {
    return new PaceCalculator({
      vdot: vdotFor(recentDistance, recentTime),
      goalRaceDistance,
      goalRaceTime,
    });
  }

  /**
   * Seconds per km at a given fraction of VDOT.
   * (Swift: `private func paceSecondsPerKm(fraction:)`.)
   */
  paceSecondsPerKm(fraction) {
    const targetVO2 = this.vdot * fraction;
    const v = velocityForVO2(targetVO2); // metres / minute
    if (!(v > 0)) return 0;
    return 60000 / v; // seconds per km
  }

  /**
   * Each zone is a band, matching how Runna presents pace targets.
   *
   * @returns {Array<{zone: string, fastSecondsPerKm: number, slowSecondsPerKm: number, midSecondsPerKm: number}>}
   */
  targets() {
    if (this._targets) return this._targets;

    const out = [];
    for (const zone of TRAINING_ORDER) {
      const mid = this.paceSecondsPerKm(PACE_ZONES[zone].vdotFraction);
      if (!(mid > 0)) continue;
      const spread = ZONE_SPREAD[zone];
      out.push(createPaceTarget(zone, mid * (1 - spread), mid * (1 + spread)));
    }

    // Pin race pace to the athlete's actual goal, when we know it.
    const d = this.goalRaceDistance;
    const t = this.goalRaceTime;
    if (d > 0 && t > 0) {
      const racePace = t / (d / 1000);
      const filtered = out.filter((target) => target.zone !== 'race');
      filtered.push(createPaceTarget('race', racePace * 0.985, racePace * 1.015));
      this._targets = filtered;
      return this._targets;
    }

    this._targets = out;
    return this._targets;
  }

  /**
   * @param {string} zone PaceZone key
   * @returns {object|null} the target, or null when the zone is not available
   *   (`.race` is only present when a goal time was supplied).
   */
  target(zone) {
    const key = typeof zone === 'string' ? zone : zone && zone.key;
    return this.targets().find((target) => target.zone === key) ?? null;
  }

  /**
   * Equivalent race times across the standard distances.
   *
   * The Swift signature takes `units` but never reads it — kept for parity so
   * call sites port one-for-one. Values are always raw seconds; formatting
   * belongs to `domain/format.js`.
   *
   * @returns {Array<{distance: number, label: string, fast: number, slow: number}>}
   */
  racePredictions(units) {
    void units;
    const distances = [
      [5000, '5K'],
      [10000, '10K'],
      [21097.5, 'Half Marathon'],
      [42195, 'Marathon'],
    ];
    return distances.map(([distance, label]) => {
      const t = timeForVdot(distance, this.vdot);
      const spread = distance >= 21097.5 ? 0.03 : 0.018;
      return { distance, label, fast: t * (1 - spread), slow: t * (1 + spread) };
    });
  }

  /**
   * Racing equivalent of a run, used for "what does this session mean" cards.
   *
   * @returns {number|null} seconds, or null when the zone has no target
   */
  equivalentRaceTime(distanceMeters, zone) {
    const target = this.target(zone);
    if (!target) return null;
    return target.midSecondsPerKm * (distanceMeters / 1000);
  }
}

/** Build a calculator from a VDOT. */
export function paceCalculator({ vdot, goalRaceDistance = null, goalRaceTime = null } = {}) {
  return new PaceCalculator({ vdot, goalRaceDistance, goalRaceTime });
}

/** Build a calculator from a recent race performance. */
export function paceCalculatorFromRace({
  recentDistance,
  recentTime,
  goalRaceDistance = null,
  goalRaceTime = null,
} = {}) {
  return PaceCalculator.fromRecentRace({
    recentDistance,
    recentTime,
    goalRaceDistance,
    goalRaceTime,
  });
}
