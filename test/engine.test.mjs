// `node --test web/test/engine.test.mjs`
//
// Proves the ported engine reproduces the Swift engine's numbers and the
// product rules in WEB-BRIEF.md: no build step, plain ES modules, no fartlek.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOALS,
  ABILITIES,
  RUN_TYPES,
  TERRAIN,
  PACE_ZONES,
  TRAINING_ORDER,
  TRAINING_LOADS,
  PLAN_PHASES,
  UNITS,
  SELECTABLE_GOALS,
} from '../js/engine/enums.js';
import {
  estimatedRaceTime,
  riegel,
  riegelExponent,
  sustainableFraction,
  time as timeForVdot,
  velocityForVO2,
  vdot,
  vo2,
} from '../js/engine/raceMath.js';
import { PaceCalculator } from '../js/engine/pace.js';
import {
  easyRun,
  intervals,
  hillReps,
  stepPrescription,
  tempoRun,
} from '../js/engine/sessionLibrary.js';
import {
  chooseDays,
  generate,
  makePlanShape,
  phaseForWeek,
  qualityCount,
  qualityRotation,
  volumeLadder,
  weekdayToDayIndex,
} from '../js/engine/planGenerator.js';

// MARK: - Fixtures

/** Mon 6 Jan 2025, local midnight — the same convention the engine uses. */
const START = new Date(2025, 0, 6);

const MARATHON_REQUEST = {
  goal: 'marathon',
  ability: 'intermediate',
  weeks: 16,
  startDate: START,
  recentRaceDistance: 10000,
  recentRaceTime: 2820, // 47:00
  baseWeeklyMeters: 30000,
  longRunMeters: 12000,
  daysPerWeek: 4,
  longRunWeekday: 7, // Saturday
  wantsStrength: false,
  units: 'kilometers',
};

const calculator = () =>
  new PaceCalculator({
    vdot: vdot(10000, 2820), // 47:00 10K
    goalRaceDistance: null,
    goalRaceTime: null,
  });

// MARK: - Enums

test('enums: tables are frozen and complete', () => {
  assert.ok(Object.isFrozen(GOALS) && Object.isFrozen(GOALS.marathon));
  assert.ok(Object.isFrozen(ABILITIES) && Object.isFrozen(RUN_TYPES));
  assert.ok(Object.isFrozen(PACE_ZONES) && Object.isFrozen(UNITS));

  assert.equal(Object.keys(GOALS).length, 10);
  assert.equal(Object.keys(ABILITIES).length, 5);
  assert.equal(Object.keys(PLAN_PHASES).length, 6);
  assert.equal(Object.keys(TRAINING_LOADS).length, 4);

  // Goal metadata the UI reads.
  assert.deepEqual(
    [GOALS.marathon.title, GOALS.marathon.iconText, GOALS.marathon.raceDistance, GOALS.marathon.isRaceGoal],
    ['Marathon', '26.2', 42195, true],
  );
  assert.equal(GOALS.halfMarathon.raceDistance, 21097.5);
  assert.equal(GOALS.runFaster.raceDistance, null);
  assert.equal(GOALS.runFaster.isRaceGoal, false);
  assert.equal(GOALS.fiveK.shieldColor, '#E3B304');
  assert.equal(GOALS.marathon.shieldColor, '#C0392B');
  assert.deepEqual(SELECTABLE_GOALS, [
    'fiveK',
    'tenK',
    'halfMarathon',
    'marathon',
    'ultra',
    'runFaster',
    'runFurther',
    'runToMaintain',
  ]);

  assert.deepEqual(ABILITIES.beginner.weeklyVolumeBand, [10000, 30000]);
  assert.deepEqual(ABILITIES.elitePlus.weeklyVolumeBand, [100000, 180000]);

  // Pace-zone metadata matches the Swift ramp.
  assert.deepEqual(TRAINING_ORDER, [
    'recovery',
    'easy',
    'steady',
    'tempo',
    'threshold',
    'interval',
    'repetition',
  ]);
  assert.equal(PACE_ZONES.easy.vdotFraction, 0.65);
  assert.equal(PACE_ZONES.interval.vdotFraction, 0.975);
  assert.equal(PACE_ZONES.repetition.vdotFraction, 1.05);
  assert.equal(PACE_ZONES.easy.color, '#9FBE19');
  assert.equal(PACE_ZONES.tempo.color, '#E3A008');
  assert.equal(TRAINING_LOADS.hard.mileageMultiplier, 1.12);
  assert.equal(TRAINING_LOADS.veryEasy.difficultyMultiplier, 0.96);
  assert.equal(UNITS.kilometers.metersPerUnit, 1000);
  assert.equal(UNITS.miles.metersPerUnit, 1609.344);
  assert.equal(UNITS.miles.suffix, 'mi');
  assert.equal(TERRAIN.trail.title, 'Trail');
  assert.equal(RUN_TYPES.rest.accent, '#586169');
  assert.equal(RUN_TYPES.race.isQuality, true);
  assert.equal(RUN_TYPES.easyRun.isRunning, true);
  assert.equal(RUN_TYPES.strength.isRunning, false);
  assert.equal(RUN_TYPES.fartlek, undefined, 'fartlek is not a Runna session type');
});

// MARK: - RaceMath: VDOT

test('VDOT matches Daniels for the reference performances', () => {
  const cases = [
    [5000, 20 * 60, 49.8],
    [5000, 25 * 60, 38.3],
    [10000, 47 * 60, 43.0],
    [10000, 40 * 60, 51.9],
    [21097.5, 105 * 60, 42.6],
    [42195, 180 * 60, 53.5],
    [42195, 240 * 60, 37.9],
  ];
  for (const [distance, seconds, expected] of cases) {
    const actual = vdot(distance, seconds);
    assert.ok(
      Math.abs(actual - expected) <= 0.5,
      `VDOT ${actual.toFixed(3)} for ${distance}m in ${seconds}s, expected ${expected} ±0.5`,
    );
  }
});

test('vdot -> time -> vdot round-trips within 0.05', () => {
  const performances = [
    [5000, 1200, 49.8],
    [10000, 2820, 43.0],
    [21097.5, 6300, 42.6],
    [42195, 10800, 53.5],
  ];
  for (const [distance, seconds] of performances) {
    const first = vdot(distance, seconds);
    const predicted = timeForVdot(distance, first);
    const second = vdot(distance, predicted);
    assert.ok(
      Math.abs(predicted - seconds) < 1,
      `${distance}m: predicted ${predicted.toFixed(3)}s vs raced ${seconds}s`,
    );
    assert.ok(
      Math.abs(second - first) < 0.05,
      `${distance}m: vdot ${first.toFixed(4)} -> time ${predicted.toFixed(3)} -> vdot ${second.toFixed(4)}`,
    );
  }
});

test('raceMath primitives follow the Swift constants', () => {
  // Oxygen cost of 200 m/min: -4.6 + 0.182258*200 + 0.000104*200^2.
  assert.ok(Math.abs(vo2(200) - 36.0116) < 1e-9);
  // Sustainable fraction at very short and very long durations.
  assert.equal(sustainableFraction(0), 1);
  assert.deepEqual(riegelExponent(1500), 1.04);
  assert.deepEqual(riegelExponent(5000), 1.06);
  assert.deepEqual(riegelExponent(15000), 1.07);
  assert.deepEqual(riegelExponent(30000), 1.08);
  assert.deepEqual(riegelExponent(42195), 1.09);
  // 10K 47:00 -> 5K via Riegel.
  assert.ok(Math.abs(riegel(2820, 10000, 5000) - 2820 * Math.pow(0.5, 1.06)) < 1e-9);
  // Degenerate input is guarded, exactly as in Swift.
  assert.equal(riegel(0, 10000, 5000), 0);
  assert.equal(vdot(0, 1200), 0);
  assert.equal(timeForVdot(0, 45), 0);
  assert.equal(velocityForVO2(-1000), 0);
  assert.deepEqual(estimatedRaceTime(0, 0, 5000), { fast: 0, slow: 0 });
});

test('estimatedRaceTime straddles Riegel and VDOT with a distance-scaled band', () => {
  const from = [10000, 2820];
  const fiveK = estimatedRaceTime(...from, 5000);
  const marathon = estimatedRaceTime(...from, 42195);

  // fast = the better estimator * (1 - uncertainty), slow = the worse * (1 + u).
  const check = (estimate, distance, uncertainty) => {
    const r = riegel(from[1], from[0], distance);
    const d = timeForVdot(distance, vdot(...from));
    assert.ok(Math.abs(estimate.fast - Math.min(r, d) * (1 - uncertainty)) < 1e-9);
    assert.ok(Math.abs(estimate.slow - Math.max(r, d) * (1 + uncertainty)) < 1e-9);
    assert.ok(estimate.fast < estimate.slow);
  };
  check(fiveK, 5000, 0.02);
  check(marathon, 42195, 0.035);

  // The band is proportionally wider for the marathon than for the 5K.
  const width = (e) => (e.slow - e.fast) / ((e.slow + e.fast) / 2);
  assert.ok(width(marathon) > width(fiveK));
});

// MARK: - Paces

test('pace ordering is monotonic from easy to repetition', () => {
  const targets = calculator().targets();
  const byZone = Object.fromEntries(targets.map((t) => [t.zone, t]));

  // The explicit product requirement.
  assert.ok(byZone.easy.midSecondsPerKm > byZone.tempo.midSecondsPerKm);
  assert.ok(byZone.tempo.midSecondsPerKm > byZone.interval.midSecondsPerKm);
  assert.ok(byZone.interval.midSecondsPerKm > byZone.repetition.midSecondsPerKm);

  // …and the whole ramp is monotonic.
  for (let i = 1; i < TRAINING_ORDER.length; i += 1) {
    const slower = byZone[TRAINING_ORDER[i - 1]].midSecondsPerKm;
    const faster = byZone[TRAINING_ORDER[i]].midSecondsPerKm;
    assert.ok(slower > faster, `${TRAINING_ORDER[i - 1]} must be slower than ${TRAINING_ORDER[i]}`);
  }

  // Bands are ordered and centred on the mid pace.
  for (const target of targets) {
    assert.ok(target.fastSecondsPerKm < target.midSecondsPerKm);
    assert.ok(target.midSecondsPerKm < target.slowSecondsPerKm);
  }
});

test('a 47:00 10K gives an Easy band of 5:43-6:31 /km', () => {
  const easy = calculator().target('easy');
  assert.ok(Math.abs(easy.fastSecondsPerKm - 343) < 1, `fast ${easy.fastSecondsPerKm}`);
  assert.ok(Math.abs(easy.slowSecondsPerKm - 391) < 1, `slow ${easy.slowSecondsPerKm}`);
});

test('race pace is pinned to the goal when one is given', () => {
  const calc = new PaceCalculator({
    vdot: vdot(10000, 2820),
    goalRaceDistance: 42195,
    goalRaceTime: 3 * 3600,
  });
  const race = calc.target('race');
  const goalPace = 10800 / 42.195;
  assert.ok(Math.abs(race.midSecondsPerKm - goalPace) < 1e-9);
  assert.ok(Math.abs(race.fastSecondsPerKm - goalPace * 0.985) < 1e-9);
  assert.ok(Math.abs(race.slowSecondsPerKm - goalPace * 1.015) < 1e-9);
  // No goal -> no race target at all, exactly like the Swift optional.
  assert.equal(calculator().target('race'), null);
});

test('race predictions cover the four standard distances', () => {
  const predictions = calculator().racePredictions('kilometers');
  assert.deepEqual(
    predictions.map((p) => p.label),
    ['5K', '10K', 'Half Marathon', 'Marathon'],
  );
  for (const p of predictions) {
    assert.ok(p.fast < p.slow);
    assert.ok(Math.abs(p.fast / p.slow - 1) < 0.1);
  }
  // Equivalent race time of a session.
  const calc = calculator();
  const easy = calc.target('easy');
  assert.equal(calc.equivalentRaceTime(10000, 'easy'), easy.midSecondsPerKm * 10);
  assert.equal(calc.equivalentRaceTime(10000, 'race'), null);
});

// MARK: - Session library

test('prescriptions match the Swift strings', () => {
  assert.equal(stepPrescription({ distanceMeters: 800, repetitions: 6 }), '6 x 800m');
  assert.equal(stepPrescription({ durationSeconds: 300, repetitions: 3 }), '3 x 5:00');
  assert.equal(stepPrescription({ durationSeconds: 600 }), '10:00');
  assert.equal(stepPrescription({ distanceMeters: 1000, repetitions: 6 }), '6 x 1.0km');
  assert.equal(stepPrescription({ distanceMeters: 1500 }), '1.5km');
  assert.equal(stepPrescription({ label: 'Goblet squat' }), 'Goblet squat');
  assert.equal(stepPrescription({ durationSeconds: 3725 }), '1:02:05');
});

test('session builders produce the structured workout grammar', () => {
  const request = { goal: 'tenK', difficulty: 'standard', goalTimeSeconds: null };
  const calc = calculator();

  const easy = easyRun({ distance: 8000, isRecovery: false, request, calc });
  assert.equal(easy.runType, 'easyRun');
  assert.equal(easy.terrain, 'flat');
  assert.deepEqual(easy.steps.map((s) => s.order), [0, 1]);
  assert.equal(easy.steps[0].label, 'Warm up');
  assert.equal(easy.steps[0].durationSeconds, 300);
  assert.equal(easy.steps[1].distanceMeters, 7500);
  assert.ok(easy.targetPaceLowSecondsPerKm > 0 && easy.targetPaceHighSecondsPerKm > 0);

  const recovery = easyRun({ distance: 5000, isRecovery: true, request, calc });
  assert.equal(recovery.runType, 'recovery');
  assert.equal(recovery.primaryZone, 'recovery');

  const tempo = tempoRun({ distance: 10000, progress: 0, request, calc });
  assert.equal(tempo.steps[1].label, 'Tempo block');
  assert.ok(Math.abs(tempo.steps[1].distanceMeters - 3300) < 1e-9); // (10000-4000) * 0.55

  const reps = intervals({ distance: 8000, progress: 0, request, calc });
  assert.equal(reps.steps[1].prescription, '6 x 800m');
  assert.equal(reps.steps[1].recoverySeconds, 120);

  const shortReps = intervals({ distance: 6000, progress: 0, request, calc });
  assert.equal(shortReps.steps[1].prescription, '8 x 400m');
  assert.equal(shortReps.steps[1].recoverySeconds, 75);

  const hills = hillReps({ distance: 8000, progress: 0, request, calc });
  assert.equal(hills.steps[1].prescription, '8 x 1:00');
  assert.equal(hills.terrain, 'hilly');
});

// MARK: - Plan generator primitives

test('plan shape periodises 16 weeks with a race week', () => {
  const shape = makePlanShape('marathon', 16);
  assert.deepEqual(shape, { baseWeeks: 5, buildWeeks: 6, peakWeeks: 2, taperWeeks: 3 });
  assert.equal(phaseForWeek(shape, 1, 16), 'foundation');
  assert.equal(phaseForWeek(shape, 5, 16), 'base');
  assert.equal(phaseForWeek(shape, 6, 16), 'build');
  assert.equal(phaseForWeek(shape, 12, 16), 'peak');
  assert.equal(phaseForWeek(shape, 14, 16), 'taper');
  assert.equal(phaseForWeek(shape, 16, 16), 'race');
  // Six weeks is the minimum plan; a 5K tapers for one week.
  assert.equal(makePlanShape('fiveK', 6).taperWeeks, 1);
  assert.equal(makePlanShape('marathon', 6).taperWeeks, 3);
  assert.equal(makePlanShape('runFaster', 16).peakWeeks, 0);
});

test('quality mix never schedules fartlek', () => {
  for (const phase of ['foundation', 'base', 'build', 'peak', 'taper', 'race']) {
    const rotation = qualityRotation(phase);
    assert.ok(rotation.length > 0);
    assert.ok(!rotation.includes('fartlek'), `${phase} rotation contains fartlek`);
  }
  assert.equal(qualityCount(2), 1);
  assert.equal(qualityCount(3), 2);
  assert.equal(qualityCount(4), 2);
  assert.equal(qualityCount(5), 2);
  assert.equal(qualityCount(6), 3);
  assert.equal(qualityCount(7), 3);
  assert.deepEqual(qualityRotation('taper'), ['intervals', 'tempo']);
});

test('weekday mapping and training-day choice', () => {
  assert.equal(weekdayToDayIndex(1), 6); // Sunday -> last day of a Monday week
  assert.equal(weekdayToDayIndex(2), 0); // Monday
  assert.equal(weekdayToDayIndex(7), 5); // Saturday
  assert.deepEqual(chooseDays(7, 5), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(chooseDays(4, 5), [0, 2, 4, 5]);
  assert.ok(chooseDays(3, 5).includes(5));
  assert.equal(chooseDays(3, 5).length, 3);
});

test('the volume ladder deloads every 4th loading week and caps growth at 12%', () => {
  const shape = makePlanShape('marathon', 16);
  const loadingWeeks = shape.baseWeeks + shape.buildWeeks + shape.peakWeeks; // 13
  const isDeloadWeek = (week) => week % 4 === 0 && week > 2 && week !== loadingWeeks;

  for (const daysPerWeek of [3, 4, 6]) {
    const ladder = volumeLadder({ ...MARATHON_REQUEST, daysPerWeek }, shape);
    assert.equal(ladder.length, 16);

    // Taper weeks step down from peak and never rise.
    for (let week = loadingWeeks + 2; week <= 16; week += 1) {
      assert.ok(ladder[week - 1] <= ladder[week - 2] + 1e-9, `taper week ${week} rose`);
    }

    let previousLoadingWeek = null;
    for (let week = 1; week <= loadingWeeks; week += 1) {
      if (isDeloadWeek(week)) {
        assert.ok(
          ladder[week - 1] < ladder[week - 2],
          `deload week ${week} must dip below week ${week - 1}`,
        );
        continue;
      }
      if (previousLoadingWeek !== null) {
        assert.ok(
          ladder[week - 1] <= previousLoadingWeek * 1.12 + 1e-9,
          `week ${week} grew ${(ladder[week - 1] / previousLoadingWeek).toFixed(4)}x (cap 1.12)`,
        );
      }
      previousLoadingWeek = ladder[week - 1];
    }
  }

  // Deloads land on weeks 4, 8 and 12 of the 16-week block.
  const ladder = volumeLadder(MARATHON_REQUEST, shape);
  for (const week of [4, 8, 12]) assert.ok(isDeloadWeek(week));
  assert.ok(ladder[3] < ladder[2]);
  assert.ok(ladder[7] < ladder[6]);
  assert.ok(ladder[11] < ladder[10]);
});

// MARK: - Generated plan

test('a 16-week marathon plan has 16 weeks of 7 sessions', () => {
  const plan = generate(MARATHON_REQUEST);

  assert.equal(plan.goal, 'marathon');
  assert.equal(plan.ability, 'intermediate');
  assert.equal(plan.planLength, 16);
  assert.equal(plan.shortPlanName, 'Marathon');
  assert.equal(plan.iconText, '26.2');
  assert.equal(plan.salesline, 'A full marathon block built around your week.');
  assert.equal(plan.trainingDaysPerWeek, 4);
  assert.equal(plan.longRunWeekday, 7);
  assert.equal(plan.baseWeeklyMeters, 30000);
  assert.ok(plan.peakWeeklyMeters > plan.baseWeeklyMeters);
  assert.equal(plan.startDate, new Date(2025, 0, 6).toISOString());

  assert.equal(plan.weeks.length, 16);
  const phaseOrder = ['foundation', 'base', 'build', 'peak', 'taper', 'race'];
  let previousPhase = -1;

  plan.weeks.forEach((week, index) => {
    assert.equal(week.weekIndex, index + 1);
    assert.equal(week.sessions.length, 7, `week ${week.weekIndex} must hold exactly 7 entries`);
    assert.deepEqual(
      week.sessions.map((s) => s.dayIndex),
      [0, 1, 2, 3, 4, 5, 6],
      `week ${week.weekIndex} day indices`,
    );
    assert.equal(new Date(week.startDate).getDay(), 1, 'weeks start on a Monday');
    assert.ok(typeof week.coachNote === 'string' && week.coachNote.length > 0);

    const rank = phaseOrder.indexOf(week.phase);
    assert.ok(rank >= previousPhase, `phase went backwards at week ${week.weekIndex}`);
    previousPhase = rank;

    for (const session of week.sessions) {
      assert.equal(session.isCompleted, false);
      const date = new Date(session.date);
      assert.ok(!Number.isNaN(date.getTime()), 'session date parses');
      assert.equal(date.getHours(), 0, 'session dates are local midnight');
      assert.equal(date.getDay(), (session.dayIndex + 1) % 7, 'session day matches dayIndex');
    }
  });

  assert.equal(plan.weeks.at(-1).phase, 'race', 'the plan ends in a race week');
  assert.equal(plan.weeks.at(-1).title, 'Race Week');
  assert.ok(plan.weeks.some((w) => w.phase === 'taper' && w.isTaper), 'the plan has a taper');
  assert.ok(plan.weeks.some((w) => w.isDeload), 'the plan has a deload');

  // The deload weeks are flagged, and their mileage dips.
  const deloads = plan.weeks.filter((w) => w.isDeload).map((w) => w.weekIndex);
  assert.deepEqual(deloads, [4, 8]);
  for (const weekIndex of deloads) {
    const previous = plan.weeks[weekIndex - 2].sessions.reduce((a, s) => a + s.distanceMeters, 0);
    const current = plan.weeks[weekIndex - 1].sessions.reduce((a, s) => a + s.distanceMeters, 0);
    assert.ok(current < previous, `week ${weekIndex} should dip below week ${weekIndex - 1}`);
  }

  // Every week's total mileage respects the 12% ceiling between loading weeks.
  // Deloads are the ladder's, not the week flag's: week 12 is in the peak block
  // so `isDeload` is false, but the ladder still dips it.
  let previousTotal = null;
  for (const week of plan.weeks.slice(0, 13)) {
    if (week.weekIndex % 4 === 0 && week.weekIndex > 2 && week.weekIndex !== 13) continue;
    const total = week.sessions.reduce((a, s) => a + s.distanceMeters, 0);
    if (previousTotal !== null) {
      assert.ok(
        total <= previousTotal * 1.12 + 1,
        `week ${week.weekIndex} mileage grew ${(total / previousTotal).toFixed(4)}x`,
      );
    }
    previousTotal = total;
  }

  // The race itself.
  const finalWeek = plan.weeks.at(-1);
  const race = finalWeek.sessions.find((s) => s.runType === 'race');
  assert.ok(race, 'race week contains a race session');
  assert.equal(race.distanceMeters, 42195);
  assert.ok(race.durationSeconds > 0, 'the race has a predicted duration');
  assert.equal(race.primaryZone, 'race');
  assert.equal(race.steps.find((s) => s.label === 'Race').distanceMeters, 42195);
  assert.equal(plan.weeks.at(-1).sessions.filter((s) => s.runType === 'rest').length, 3);

  // Predicted finish band comes off the 47:00 10K anchor.
  assert.ok(plan.predictedTimeFastSeconds > 0);
  assert.ok(plan.predictedTimeFastSeconds < plan.predictedTimeSlowSeconds);
  assert.ok(Math.abs(plan.predictedTimeFastSeconds - 3.3 * 3600) < 3600);
});

test('no session anywhere is a fartlek', () => {
  const plans = [
    generate(MARATHON_REQUEST),
    generate({ ...MARATHON_REQUEST, goal: 'fiveK', weeks: 6, daysPerWeek: 3 }),
    generate({ ...MARATHON_REQUEST, goal: 'halfMarathon', weeks: 12, daysPerWeek: 6, wantsStrength: true }),
    generate({ goal: 'runFaster', weeks: 8, startDate: START, ability: 'advanced' }),
    generate({ goal: 'ultra', weeks: 26, startDate: START }),
  ];
  for (const plan of plans) {
    for (const week of plan.weeks) {
      for (const session of week.sessions) {
        assert.notEqual(session.runType, 'fartlek');
        assert.ok(!String(session.runTitle).toLowerCase().includes('fartlek'));
        assert.ok(session.runTitle.length > 0);
        for (const step of session.steps) {
          assert.ok(step.order >= 0);
          assert.ok(typeof step.prescription === 'string' && step.prescription.length > 0);
          assert.ok(PACE_ZONES[step.zone], `step zone ${step.zone} exists`);
        }
      }
    }
  }
});

test('strength sessions are added alongside the running week', () => {
  const plan = generate({ ...MARATHON_REQUEST, wantsStrength: true });
  const withStrength = plan.weeks.filter((w) => w.sessions.length > 7);
  assert.ok(withStrength.length > 0);
  assert.ok(!plan.weeks.at(-1).sessions.some((s) => s.runType === 'strength'), 'no strength in race week');
  const strength = withStrength[1].sessions.find((s) => s.runType === 'strength');
  assert.equal(strength.steps.length, 4);
  assert.equal(strength.steps[0].prescription, 'Goblet squat');
  assert.equal(strength.steps[0].note, '3 x 8');
  assert.equal(strength.durationSeconds, 1800);
});

test('short plan requests are clamped to four weeks, never NaN', () => {
  // Swift reads past the end of its volume ladder here (the ladder uses
  // `max(1, weeks)` while a plan is `max(4, weeks)`); the port clamps instead.
  for (const weeks of [0, 1, 2, 3, 4]) {
    const plan = generate({ ...MARATHON_REQUEST, weeks });
    assert.equal(plan.weeks.length, 4);
    assert.equal(plan.planLength, 4);
    for (const week of plan.weeks) {
      assert.equal(week.sessions.length, 7);
      for (const session of week.sessions) {
        assert.ok(Number.isFinite(session.distanceMeters), `week ${week.weekIndex} ${session.runType} distance`);
        assert.ok(Number.isFinite(session.durationSeconds), `week ${week.weekIndex} ${session.runType} duration`);
        assert.ok(session.distanceMeters >= 0);
      }
    }
  }
});

test('non-race goals never schedule a race day', () => {
  const plan = generate({ goal: 'runToMaintain', weeks: 10, startDate: START, daysPerWeek: 4 });
  assert.equal(plan.weeks.length, 10);
  assert.equal(plan.raceDate, null);
  for (const week of plan.weeks) {
    assert.equal(week.sessions.length, 7);
    assert.ok(!week.sessions.some((s) => s.runType === 'race'));
  }
  assert.equal(plan.weeks.at(-1).phase, 'taper', 'no peak block -> the plan tapers out');
});

test('dates stay on the calendar across a plan', () => {
  const plan = generate({ ...MARATHON_REQUEST, weeks: 26, startDate: new Date(2025, 2, 3) });
  const first = new Date(plan.weeks[0].startDate);
  assert.equal(first.getFullYear(), 2025);
  assert.equal(first.getMonth(), 2);
  assert.equal(first.getDate(), 3);
  const last = new Date(plan.weeks.at(-1).startDate);
  assert.equal(last.getDate(), 25);
  assert.equal(last.getMonth(), 7, '26 weeks later is August');
});
