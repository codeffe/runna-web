// Port of `app/Runna/Domain/Engine/SessionLibrary.swift`.
//
// MARK: - Session library
//
// Builds the actual structured sessions: warm-up, main set, recoveries and
// cool-down, each tagged with the pace zone it should be run in.
//
// Every builder returns a plain object shaped like a `PlannedSession`:
//
//   { runType, runTitle, sessionDescription, coachTip, terrain, distanceMeters,
//     durationSeconds, targetPaceLowSecondsPerKm, targetPaceHighSecondsPerKm,
//     primaryZone, steps: [ { order, label, repetitions, distanceMeters,
//     durationSeconds, recoverySeconds, zone, note, prescription } ] }
//
// Builders take a single options object whose keys are the Swift argument
// labels, so call sites port one-for-one:
//
//   SessionLibrary.easyRun(distance:isRecovery:request:calc:)
//   → easyRun({ distance, isRecovery, request, calc })
//
// `fartlek` is deliberately not ported: it is not a Runna session type.

import { getGoal, getTrainingLoad } from './enums.js';
import { time as timeForVdot } from './raceMath.js';

// MARK: - Helpers

/**
 * `Fmt.duration` — 3725 -> "1:02:05"; 305 -> "5:05".
 * Only used to build step prescriptions; display formatting belongs to
 * `domain/format.js`.
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * `SessionStep.prescription` — "6 x 800m" or "3 x 5:00".
 *
 * @param {{distanceMeters?: number, durationSeconds?: number, repetitions?: number, label?: string}} step
 */
export function stepPrescription({
  distanceMeters = 0,
  durationSeconds = 0,
  repetitions = 1,
  label = '',
} = {}) {
  if (distanceMeters > 0) {
    const d =
      distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(1)}km`
        : `${Math.trunc(distanceMeters)}m`;
    return repetitions > 1 ? `${repetitions} x ${d}` : d;
  }
  if (durationSeconds > 0) {
    const d = formatDuration(durationSeconds);
    return repetitions > 1 ? `${repetitions} x ${d}` : d;
  }
  return label;
}

/** A blank `PlannedSession`. `date` stays null until the plan generator sets it. */
function newSession() {
  return {
    dayIndex: 0,
    date: null,
    runType: 'easyRun',
    runTitle: '',
    sessionDescription: '',
    coachTip: '',
    terrain: 'flat',
    distanceMeters: 0,
    durationSeconds: 0,
    targetPaceLowSecondsPerKm: 0,
    targetPaceHighSecondsPerKm: 0,
    primaryZone: 'easy',
    isCompleted: false,
    steps: [],
  };
}

/** A blank `SessionStep` (all Swift stored properties default to 0 / "easy"). */
function newStep({
  label = '',
  repetitions = 1,
  distanceMeters = 0,
  durationSeconds = 0,
  recoverySeconds = 0,
  zone = 'easy',
  note = '',
} = {}) {
  return {
    order: 0,
    label,
    repetitions,
    distanceMeters,
    durationSeconds,
    recoverySeconds,
    zone,
    note,
    prescription: '',
  };
}

/** `addSteps` — assigns `order` (Swift) and materialises the derived `prescription`. */
function addSteps(session, steps) {
  steps.forEach((step, index) => {
    step.order = index;
    step.prescription = stepPrescription(step);
    session.steps.push(step);
  });
}

/** `decorate` — applies the session's primary zone and its pace band. */
function decorate(session, request, calc, zone) {
  const target = calc.target(zone);
  if (target) {
    // Training-mode difficulty nudges quality paces.
    const m = getTrainingLoad(request.difficulty).difficultyMultiplier;
    session.targetPaceLowSecondsPerKm = target.fastSecondsPerKm * (2 - m);
    session.targetPaceHighSecondsPerKm = target.slowSecondsPerKm * m;
  }
  session.primaryZone = zone;
}

const isUltra = (request) => getGoal(request.goal).key === 'ultra';

// MARK: Easy / recovery

export function easyRun({ distance, isRecovery = false, request, calc }) {
  const s = newSession();
  s.runType = isRecovery ? 'recovery' : 'easyRun';
  s.runTitle = isRecovery ? 'Recovery Run' : 'Easy Run';
  s.terrain = 'flat';
  s.distanceMeters = distance;
  const mid = calc.target(isRecovery ? 'recovery' : 'easy')?.midSecondsPerKm ?? 360;
  s.durationSeconds = mid * (distance / 1000);
  decorate(s, request, calc, isRecovery ? 'recovery' : 'easy');

  s.sessionDescription = isRecovery
    ? 'Short, slow and deliberate. This run exists to help you absorb the hard days.'
    : 'An aerobic run at a pace you could hold a conversation at from the first step to the last.';
  s.coachTip = isRecovery
    ? 'If you are breathing hard, you are going too fast. Slower than you think is correct.'
    : 'Easy running builds the capillaries, mitochondria and tendons that race pace depends on.';

  const warm = newStep({
    label: 'Warm up',
    repetitions: 1,
    durationSeconds: 300,
    zone: 'easy',
    note: '5 minutes of easy running and dynamic drills.',
  });

  const main = newStep({
    label: 'Steady aerobic',
    repetitions: 1,
    distanceMeters: Math.max(0, distance - 500),
    zone: isRecovery ? 'recovery' : 'easy',
  });

  addSteps(s, [warm, main]);
  return s;
}

// MARK: Long run

export function longRun({ distance, week, request, calc }) {
  const s = newSession();
  s.runType = 'longRun';
  s.runTitle = 'Long Run';
  s.terrain = isUltra(request) ? 'trail' : 'rolling';
  s.distanceMeters = distance;
  const mid = calc.target('easy')?.midSecondsPerKm ?? 380;
  s.durationSeconds = mid * (distance / 1000);
  decorate(s, request, calc, 'easy');

  s.sessionDescription =
    'The cornerstone session of the week. Time on feet builds the durability that carries you through the closing stages of a race.';
  s.coachTip =
    'Start slower than target pace. Negative splitting a long run is a skill worth practising.';

  const warm = newStep({
    label: 'Warm up',
    repetitions: 1,
    durationSeconds: 600,
    zone: 'easy',
    note: '10 minutes easy to settle into rhythm.',
  });

  const main = newStep({ label: 'Long run', repetitions: 1, zone: 'easy' });

  // Later in the block the long run finishes at goal pace.
  const finishAtPace = week.phase === 'build' || week.phase === 'peak';
  if (finishAtPace) {
    main.distanceMeters = Math.max(0, distance - Math.min(6000, distance * 0.3));
    main.note = 'Hold easy effort.';

    const finish = newStep({
      label: 'Finish at goal pace',
      repetitions: 1,
      distanceMeters: Math.min(6000, distance * 0.3),
      zone: 'race',
      note: 'Last block at your target race pace.',
    });
    addSteps(s, [warm, main, finish]);
  } else {
    main.distanceMeters = Math.max(0, distance - 600);
    main.note = 'Keep the effort even and conversational.';
    addSteps(s, [warm, main]);
  }
  return s;
}

// MARK: Quality dispatcher

/**
 * `quality(type:distance:weekIndex:totalWeeks:phase:request:calc:)`.
 *
 * The Swift dispatcher takes `phase` but never reads it — kept for parity.
 * `recovery` (and any other non-quality type) falls through to `easyRun`,
 * exactly as Swift's `default:` branch does.
 */
export function quality({
  type,
  distance,
  weekIndex,
  totalWeeks,
  phase,
  request,
  calc,
}) {
  void phase;
  // Progression through the block: later weeks = more work.
  const progress = totalWeeks > 1 ? (weekIndex - 1) / (totalWeeks - 1) : 0.5;
  switch (type) {
    case 'tempo':
      return tempoRun({ distance, progress, request, calc });
    case 'intervals':
      return intervals({ distance, progress, request, calc });
    case 'hills':
      return hillReps({ distance, progress, request, calc });
    case 'progression':
      return progressionRun({ distance, progress, request, calc });
    case 'timeTrial':
      return timeTrial({ distance, request, calc });
    case 'race':
      return raceDay({ distance, request, calc });
    default:
      return easyRun({ distance, isRecovery: false, request, calc });
  }
}

// MARK: Tempo

export function tempoRun({ distance, progress, request, calc }) {
  const s = newSession();
  s.runType = 'tempo';
  s.runTitle = 'Tempo Run';
  s.terrain = 'flat';
  s.distanceMeters = distance;
  const mid = calc.target('tempo')?.midSecondsPerKm ?? 300;
  s.durationSeconds = mid * (distance / 1000);
  decorate(s, request, calc, 'tempo');
  s.sessionDescription =
    'Sustained running at a comfortably hard effort — controlled, not racing. This is the single most effective session for raising your lactate threshold.';
  s.coachTip = 'You should be able to speak in short sentences. If you are gasping, ease off.';

  const warm = newStep({
    label: 'Warm up',
    repetitions: 1,
    durationSeconds: 600,
    zone: 'easy',
    note: '10 minutes easy plus strides.',
  });

  const tempoDistance = Math.max(3000, (distance - 4000) * (0.55 + 0.25 * progress));
  const main = newStep({
    label: 'Tempo block',
    repetitions: 1,
    distanceMeters: tempoDistance,
    zone: 'tempo',
    note: 'Hold tempo effort. Relax the shoulders.',
  });

  const cool = newStep({
    label: 'Cool down',
    repetitions: 1,
    durationSeconds: 600,
    zone: 'easy',
    note: '10 minutes easy to finish.',
  });

  addSteps(s, [warm, main, cool]);
  return s;
}

// MARK: Intervals

export function intervals({ distance, progress, request, calc }) {
  const s = newSession();
  s.runType = 'intervals';
  s.runTitle = 'Intervals';
  s.terrain = 'track';
  s.distanceMeters = distance;
  const mid = calc.target('interval')?.midSecondsPerKm ?? 250;
  s.durationSeconds = mid * (distance / 1000) + 600;
  decorate(s, request, calc, 'interval');
  s.sessionDescription =
    'Short, hard repeats at around 3K–5K effort with jog recoveries. This is the session that lifts your VO2max and makes race pace feel manageable.';
  s.coachTip = 'The recoveries are part of the session — keep them honest but keep moving.';

  const warm = newStep({
    label: 'Warm up',
    repetitions: 1,
    durationSeconds: 720,
    zone: 'easy',
    note: '12 minutes easy, then 4 x 20s strides.',
  });

  // Choose a repeat distance and count that suits the total volume.
  let repDistance;
  let baseReps;
  if (distance < 7000) {
    repDistance = 400;
    baseReps = 8;
  } else if (distance < 9000) {
    repDistance = 800;
    baseReps = 6;
  } else if (distance < 12000) {
    repDistance = 800;
    baseReps = 7;
  } else {
    repDistance = 1000;
    baseReps = 6;
  }
  const reps = Math.max(4, baseReps + Math.floor(progress * 3));

  const main = newStep({
    label: 'Main set',
    repetitions: reps,
    distanceMeters: repDistance,
    recoverySeconds: repDistance <= 400 ? 75 : 120,
    zone: 'interval',
    note: 'Even splits. If the last rep is much slower than the first, start easier.',
  });

  const cool = newStep({ label: 'Cool down', repetitions: 1, durationSeconds: 600, zone: 'easy' });

  addSteps(s, [warm, main, cool]);
  return s;
}

// MARK: Hills

export function hillReps({ distance, progress, request, calc }) {
  const s = newSession();
  s.runType = 'hills';
  s.runTitle = 'Hill Reps';
  s.terrain = 'hilly';
  s.distanceMeters = distance;
  const mid = calc.target('repetition')?.midSecondsPerKm ?? 240;
  s.durationSeconds = mid * (distance / 1000) + 900;
  decorate(s, request, calc, 'repetition');
  s.sessionDescription =
    'Repeated efforts up a gradient. Hills build strength and power with far less impact than flat speed work.';
  s.coachTip = 'Drive the arms, keep the cadence high, and jog down slowly for recovery.';

  const warm = newStep({ label: 'Warm up', repetitions: 1, durationSeconds: 720, zone: 'easy' });

  const reps = Math.max(6, 8 + Math.floor(progress * 4));
  const main = newStep({
    label: 'Hill repeats',
    repetitions: reps,
    durationSeconds: 60,
    recoverySeconds: 120,
    zone: 'repetition',
    note: '60 seconds hard uphill. Jog back down to recover.',
  });

  const cool = newStep({ label: 'Cool down', repetitions: 1, durationSeconds: 600, zone: 'easy' });

  addSteps(s, [warm, main, cool]);
  return s;
}

// MARK: Progression

export function progressionRun({ distance, progress, request, calc }) {
  void progress;
  const s = newSession();
  s.runType = 'progression';
  s.runTitle = 'Progression Run';
  s.terrain = 'flat';
  s.distanceMeters = distance;
  const mid = calc.target('tempo')?.midSecondsPerKm ?? 320;
  s.durationSeconds = mid * (distance / 1000);
  decorate(s, request, calc, 'tempo');
  s.sessionDescription =
    'A continuous run that gets faster in stages. Teaches you to finish strongly rather than fade.';
  s.coachTip =
    'The first block should feel far too easy. Trust it — you will need the legs later.';

  const warm = newStep({ label: 'Warm up', repetitions: 1, durationSeconds: 480, zone: 'easy' });

  const third = Math.max(1500, (distance - 800) / 3);
  const b1 = newStep({ label: 'Block 1 · Easy', repetitions: 1, distanceMeters: third, zone: 'easy' });
  const b2 = newStep({
    label: 'Block 2 · Steady',
    repetitions: 1,
    distanceMeters: third,
    zone: 'steady',
  });
  const b3 = newStep({
    label: 'Block 3 · Tempo',
    repetitions: 1,
    distanceMeters: third,
    zone: 'tempo',
    note: 'Finish the run at tempo effort.',
  });

  addSteps(s, [warm, b1, b2, b3]);
  return s;
}

// MARK: Time trial

export function timeTrial({ distance, request, calc }) {
  const s = newSession();
  s.runType = 'timeTrial';
  s.runTitle = 'Time Trial';
  s.terrain = 'flat';
  const ttDistance = Math.min(distance, getGoal(request.goal).raceDistance ?? 5000);
  s.distanceMeters = ttDistance;
  const mid = calc.target('race')?.midSecondsPerKm ?? 280;
  s.durationSeconds = mid * (ttDistance / 1000) + 900;
  decorate(s, request, calc, 'race');
  s.sessionDescription =
    'A hard effort over a measured distance. The result recalibrates every pace in your plan, so pace it evenly and give it everything.';
  s.coachTip =
    'Go out controlled. A time trial won with a fast first kilometre is usually lost in the last one.';

  const warm = newStep({
    label: 'Warm up',
    repetitions: 1,
    durationSeconds: 900,
    zone: 'easy',
    note: '15 minutes easy with strides.',
  });

  const main = newStep({
    label: 'Time trial',
    repetitions: 1,
    distanceMeters: ttDistance,
    zone: 'race',
    note: 'Even effort throughout. Record your time.',
  });

  const cool = newStep({ label: 'Cool down', repetitions: 1, durationSeconds: 600, zone: 'easy' });

  addSteps(s, [warm, main, cool]);
  return s;
}

// MARK: Race day

export function raceDay({ distance, request, calc }) {
  const s = newSession();
  s.runType = 'race';
  s.runTitle = 'Race Day';
  s.terrain = 'flat';
  const raceDistance = getGoal(request.goal).raceDistance ?? distance;
  s.distanceMeters = raceDistance;

  // Runna takes no goal time — the predicted finish comes from current
  // fitness, so derive it from the athlete's VDOT.
  const predicted = request.goalTimeSeconds ?? timeForVdot(raceDistance, calc.vdot);
  s.durationSeconds = predicted;
  if (predicted > 0 && raceDistance > 0) {
    const racePace = predicted / (raceDistance / 1000);
    s.targetPaceLowSecondsPerKm = racePace * 0.99;
    s.targetPaceHighSecondsPerKm = racePace * 1.01;
  }
  s.primaryZone = 'race';
  s.sessionDescription =
    'Race day. Everything between here and the finish line is execution, not fitness.';
  s.coachTip = 'Nothing new on race day: same shoes, same breakfast, same warm-up.';

  const warm = newStep({
    label: 'Warm up',
    repetitions: 1,
    durationSeconds: 900,
    zone: 'easy',
    note: 'Easy jog, drills and a few strides finishing 10 minutes before the gun.',
  });

  const race = newStep({
    label: 'Race',
    repetitions: 1,
    distanceMeters: raceDistance,
    zone: 'race',
    note: 'Even splits. Fuel early and often.',
  });

  addSteps(s, [warm, race]);
  return s;
}

// MARK: Rest day
//
// `PlanGenerator.populate` builds rest days inline; the same three strings live
// here so the shape is shared with the rest of the library.

export function restDay() {
  const s = newSession();
  s.runType = 'rest';
  s.runTitle = 'Rest Day';
  s.sessionDescription = 'Full rest. Adaptation happens when you recover.';
  s.coachTip =
    'Keep the day genuinely easy — walking, stretching and sleep all count as training.';
  s.distanceMeters = 0;
  s.durationSeconds = 0;
  return s;
}

// MARK: Strength & mobility

/**
 * Strength & mobility rides alongside the running week. `date` is the session's
 * ISO date (the generator supplies it); `index` picks the A/B session.
 */
export function strength({ dayIndex = 0, date = null, index = 0, phase }) {
  const s = newSession();
  s.dayIndex = dayIndex;
  s.date = date;
  s.runType = 'strength';
  s.terrain = 'flat';
  s.distanceMeters = 0;
  s.durationSeconds = 1800;
  s.primaryZone = 'easy';

  const lower = [
    ['Goblet squat', '3 x 8'],
    ['Romanian deadlift', '3 x 8'],
    ['Split squat', '3 x 8 each leg'],
    ['Calf raise', '3 x 12'],
  ];
  const upperCore = [
    ['Single-arm row', '3 x 10 each side'],
    ['Push-up', '3 x 10'],
    ['Dead bug', '3 x 8 each side'],
    ['Side plank', '3 x 30s each side'],
  ];
  const mobility = [
    ['Hip flexor stretch', '2 x 45s each side'],
    ['Hamstring floss', '2 x 45s each side'],
    ['Thoracic rotation', '2 x 10 each side'],
    ['Ankle rocks', '2 x 12 each side'],
  ];
  const plan = phase === 'taper' ? mobility : index === 0 ? lower : upperCore;

  s.runTitle =
    phase === 'taper' ? 'Mobility' : index === 0 ? 'Strength A · Lower' : 'Strength B · Upper & Core';
  s.sessionDescription =
    phase === 'taper'
      ? 'Mobility work to keep the hips and ankles moving while volume drops.'
      : 'Runner-specific strength. Stronger legs hold form longer, and better form is free speed.';
  s.coachTip = 'Quality over load. Leave two reps in reserve on every set.';

  plan.forEach(([name, prescription], i) => {
    const step = newStep({ label: name, repetitions: 1, zone: 'easy', note: prescription });
    step.order = i;
    step.prescription = stepPrescription(step);
    s.steps.push(step);
  });
  return s;
}

/** The whole library, for callers that prefer `SessionLibrary.easyRun(...)`. */
export const SessionLibrary = Object.freeze({
  easyRun,
  longRun,
  quality,
  tempoRun,
  intervals,
  hillReps,
  progressionRun,
  timeTrial,
  raceDay,
  restDay,
  strength,
});
