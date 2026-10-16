// Port of `app/Runna/Domain/Engine/PlanGenerator.swift`.
//
// Everything the engine needs to synthesise a plan. Mirrors the inputs Runna
// collects during onboarding (`AddUserSurveyResults`, `getAllowedNumberOfWeeks`,
// `getUserDefaultMileages`, `getTrainingModeConfig`).

import {
  ABILITIES,
  GOALS,
  TRAINING_LOADS,
  getAbility,
  getGoal,
  getTrainingLoad,
  getUnits,
} from './enums.js';
import { estimatedRaceTime, vdot as vdotFor } from './raceMath.js';
import * as SessionLibrary from './sessionLibrary.js';
import { PaceCalculator } from './pace.js';

// MARK: - Dates
//
// Swift used `Calendar.current`, i.e. local time. We keep every engine date at
// local midnight and serialise it with `toISOString()`; `new Date(iso)` in the
// UI lands back on the same local midnight, so civil dates survive round-trips.

/** Local midnight for a Date | ISO string | timestamp. */
export function startOfDay(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Calendar day arithmetic (`Calendar.date(byAdding: .day,)`) — DST safe. */
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
}

/** ISO-8601 string for a Date (or null). */
export const isoDate = (date) => (date ? date.toISOString() : null);

const todayStart = () => startOfDay(new Date());

// The exported helpers below are also callable directly with a partial request
// (the test suite and the UI both do), so they read the request defensively
// instead of assuming `createPlanRequest` has already run.
const goalOf = (request) => getGoal(request.goal) ?? GOALS.tenK;
const abilityOf = (request) => getAbility(request.ability) ?? ABILITIES.intermediate;
const trainingLoadOf = (request) =>
  getTrainingLoad(request.trainingLoad) ?? TRAINING_LOADS.standard;
const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// MARK: - Plan request

/**
 * `PlanRequest`. Accepts a partial object and fills in the onboarding defaults
 * (4 runs a week, Saturday long run, Standard load/difficulty, kilometres).
 *
 * @param {object} [overrides]
 * @returns {object} a normalised request with plain key strings for enums
 */
export function createPlanRequest(overrides = {}) {
  const o = overrides || {};
  const goal = getGoal(o.goal ?? 'tenK');
  const ability = getAbility(o.ability ?? 'intermediate');
  if (!goal) throw new TypeError(`Unknown goal: ${String(o.goal)}`);
  if (!ability) throw new TypeError(`Unknown ability: ${String(o.ability)}`);

  const trainingLoad = getTrainingLoad(o.trainingLoad ?? 'standard');
  const difficulty = getTrainingLoad(o.difficulty ?? 'standard');
  const units = getUnits(o.units ?? 'kilometers');
  if (!trainingLoad) throw new TypeError(`Unknown training load: ${String(o.trainingLoad)}`);
  if (!difficulty) throw new TypeError(`Unknown difficulty: ${String(o.difficulty)}`);
  if (!units) throw new TypeError(`Unknown units: ${String(o.units)}`);

  return {
    goal: goal.key,
    ability: ability.key,
    weeks: Number.isFinite(o.weeks) ? o.weeks : 12,
    startDate: startOfDay(o.startDate ?? new Date()),
    raceDate: o.raceDate ? startOfDay(o.raceDate) : null,
    goalTimeSeconds: o.goalTimeSeconds ?? null,

    // Fitness anchor.
    recentRaceDistance: o.recentRaceDistance ?? null,
    recentRaceTime: o.recentRaceTime ?? null,

    baseWeeklyMeters: Number.isFinite(o.baseWeeklyMeters) ? o.baseWeeklyMeters : 25000,
    longRunMeters: Number.isFinite(o.longRunMeters) ? o.longRunMeters : 10000,
    daysPerWeek: Number.isFinite(o.daysPerWeek) ? o.daysPerWeek : 4,
    longRunWeekday: Number.isFinite(o.longRunWeekday) ? o.longRunWeekday : 7, // 1 = Sunday ... 7 = Saturday
    wantsStrength: Boolean(o.wantsStrength),
    trainingLoad: trainingLoad.key,
    difficulty: difficulty.key,
    units: units.key,
  };
}

/** Alias matching the Swift type name. */
export const PlanRequest = createPlanRequest;

// MARK: - Periodisation shape

/**
 * `PlanShape.make(goal:totalWeeks:)`.
 *
 * @returns {{baseWeeks: number, buildWeeks: number, peakWeeks: number, taperWeeks: number}}
 */
export function makePlanShape(goal, totalWeeks) {
  const meta = getGoal(goal);
  if (!meta) throw new TypeError(`Unknown goal: ${String(goal)}`);

  let taper;
  switch (meta.key) {
    case 'marathon':
    case 'ultra':
      taper = 3;
      break;
    case 'halfMarathon':
    case 'tenK':
      taper = 2;
      break;
    case 'fiveK':
      taper = 1;
      break;
    default:
      taper = 1;
  }

  const peak = meta.isRaceGoal ? (totalWeeks >= 10 ? 2 : 1) : 0;
  let foundation = Math.max(1, Math.round(totalWeeks * 0.3));
  let build = totalWeeks - foundation - peak - taper;
  if (build < 1) {
    foundation = Math.max(1, totalWeeks - taper - 1);
    build = Math.max(0, totalWeeks - foundation - taper);
  }
  return { baseWeeks: foundation, buildWeeks: build, peakWeeks: peak, taperWeeks: taper };
}

/**
 * `PlanShape.phase(forWeek:total:)` — which phase a given week (1-based)
 * belongs to.
 *
 * @param {{baseWeeks: number, buildWeeks: number, peakWeeks: number, taperWeeks: number}} shape
 * @param {number} week 1-based
 * @param {number} total
 * @returns {string} PlanPhase key
 */
export function phaseForWeek(shape, week, total) {
  if (week <= shape.baseWeeks) {
    return week <= Math.max(1, Math.floor(shape.baseWeeks / 2)) ? 'foundation' : 'base';
  }
  if (week <= shape.baseWeeks + shape.buildWeeks) return 'build';
  if (week <= shape.baseWeeks + shape.buildWeeks + shape.peakWeeks) return 'peak';
  if (week < total) return 'taper';
  return shape.peakWeeks > 0 ? 'race' : 'taper';
}

/** The `PlanShape` helpers as a namespace, mirroring the Swift type. */
export const PlanShape = Object.freeze({ make: makePlanShape, phaseForWeek });

// MARK: - Weekly volume ramp

/**
 * Builds the week-by-week volume ladder before the plan is populated.
 *
 * Runna's documented rule is a *fixed ceiling on how much weekly mileage
 * may rise in any single week*, so this ramps along a smooth trend from the
 * athlete's current volume to their ability-scaled peak, dips for deloads,
 * and hard-caps every increase against the previous loading week.
 *
 * @returns {number[]} one entry per week
 */
export function volumeLadder(request, shape) {
  const total = Math.max(1, numberOr(request.weeks, 1));
  const base = Math.max(
    5000,
    numberOr(request.baseWeeklyMeters, 25000) * trainingLoadOf(request).mileageMultiplier,
  );

  let growthCap;
  switch (abilityOf(request).key) {
    case 'beginner':
      growthCap = 1.35;
      break;
    case 'intermediate':
      growthCap = 1.55;
      break;
    case 'advanced':
      growthCap = 1.75;
      break;
    case 'elite':
      growthCap = 1.9;
      break;
    default:
      growthCap = 2.0; // elitePlus
  }
  const peak = base * growthCap;

  const loadingWeeks = Math.max(1, shape.baseWeeks + shape.buildWeeks + shape.peakWeeks);

  // Ceiling on week-over-week growth. More runs per week means a smaller
  // permitted increase, which is exactly how Runna describes it.
  const daysPerWeek = numberOr(request.daysPerWeek, 4);
  let maxWeeklyIncrease;
  if (daysPerWeek < 4) maxWeeklyIncrease = 1.12;
  else if (daysPerWeek <= 5) maxWeeklyIncrease = 1.1;
  else maxWeeklyIncrease = 1.08;

  const out = [];
  let previousLoadingWeek = null;

  for (let week = 1; week <= total; week += 1) {
    // Taper runs after the loading block, stepping down from peak.
    if (week > loadingWeeks) {
      const indexInTaper = week - loadingWeeks; // 1-based
      const factor = Math.max(0.45, 0.85 - 0.2 * (indexInTaper - 1));
      out.push(peak * factor);
      continue;
    }

    // Smooth trend from base to peak across the whole loading block, so
    // progression is continuous instead of jumping at a phase boundary.
    const progress = loadingWeeks > 1 ? (week - 1) / (loadingWeeks - 1) : 0;
    const trend = base + (peak - base) * progress;

    // Deload every 4th week, but never the final loading week — the
    // athlete has to actually reach peak volume before tapering.
    const isDeload = week % 4 === 0 && week > 2 && week !== loadingWeeks;
    let value = isDeload ? trend * 0.85 : trend;

    if (!isDeload) {
      if (previousLoadingWeek !== null) {
        value = Math.min(value, previousLoadingWeek * maxWeeklyIncrease);
      }
      previousLoadingWeek = value;
    }
    out.push(value);
  }
  return out;
}

// MARK: - Session mix

/** How many quality sessions a week of `days` training days supports. */
export function qualityCount(days) {
  if (days < 3) return 1;
  if (days <= 4) return 2;
  if (days === 5) return 2;
  return 3;
}

/**
 * Rotates session types so a block never repeats the same stimulus twice
 * in a row and quality sessions get harder as the plan progresses.
 *
 * Only Runna's own session types appear here — recon established that
 * "fartlek" is not one of them, so it is never scheduled.
 *
 * @param {string} phase PlanPhase key
 * @returns {string[]} RunType keys
 */
export function qualityRotation(phase) {
  switch (phase) {
    case 'foundation':
      return ['hills', 'tempo', 'progression'];
    case 'base':
      return ['tempo', 'hills', 'intervals', 'progression'];
    case 'build':
      return ['intervals', 'tempo', 'hills', 'progression'];
    case 'peak':
      return ['intervals', 'tempo', 'timeTrial', 'intervals', 'progression'];
    case 'taper':
      return ['intervals', 'tempo'];
    case 'race':
      return ['recovery', 'intervals'];
    default:
      return ['tempo'];
  }
}

// MARK: - Generate

/**
 * @param {object} request partial `PlanRequest`
 * @returns {object} the plan, as plain JSON-ready data
 */
export function generate(request) {
  const req = createPlanRequest(request);
  const total = Math.max(4, req.weeks);
  const shape = makePlanShape(req.goal, total);
  // `volumeLadder` reads `max(1, weeks)` while a plan is always at least 4 weeks
  // long, so the ladder is built for the clamped length the loop below walks.
  // (Swift passes the request through unchanged, which reads past the end of the
  // ladder — a crash — for any request shorter than 4 weeks. Onboarding only
  // offers 6–26, so it never fires there; here it would silently yield NaN.)
  const volumes = volumeLadder({ ...req, weeks: total }, shape);

  const goal = getGoal(req.goal);
  const plan = {
    goal: req.goal,
    ability: req.ability,
    planLength: total,
    shortPlanName: goal.title,
    veryShortPlanName: goal.iconText,
    iconText: goal.iconText,
    startDate: isoDate(req.startDate),
    raceDate: isoDate(req.raceDate),
    goalTimeSeconds: req.goalTimeSeconds,
    raceDistance: goal.raceDistance,
    salesline: salesline(req),
    baseWeeklyMeters: req.baseWeeklyMeters,
    peakWeeklyMeters: volumes.length ? Math.max(...volumes) : req.baseWeeklyMeters,
    longRunMeters: req.longRunMeters,
    trainingDaysPerWeek: req.daysPerWeek,
    longRunWeekday: req.longRunWeekday,
    trainingLoad: req.trainingLoad,
    difficulty: req.difficulty,
    units: req.units,
    shape,
    vdot: 0,
    predictedTimeFastSeconds: null,
    predictedTimeSlowSeconds: null,
    weeks: [],
  };

  // Fitness anchor -> paces
  const anchor = resolveAnchor(req);
  const calc = new PaceCalculator({
    vdot: anchor.vdot,
    goalRaceDistance: goal.raceDistance,
    goalRaceTime: req.goalTimeSeconds,
  });
  plan.vdot = anchor.vdot;

  const source = anchorSource(req);
  if (source) {
    const { fast, slow } = estimatedRaceTime(
      source.distance,
      source.time,
      goal.raceDistance ?? 10000,
    );
    plan.predictedTimeFastSeconds = fast;
    plan.predictedTimeSlowSeconds = slow;
  }

  for (let week = 1; week <= total; week += 1) {
    const monday = addDays(req.startDate, (week - 1) * 7);
    const phase = phaseForWeek(shape, week, total);
    const weekVolume = volumes[week - 1];
    const isDeload = week % 4 === 0 && week > 2 && week <= shape.baseWeeks + shape.buildWeeks;
    const isTaper = phase === 'taper' || phase === 'race';

    const w = {
      weekIndex: week,
      startDate: isoDate(monday),
      phase,
      isDeload,
      isTaper,
      title: weekTitle(phase, week, isDeload),
      coachNote: coachNote(phase, isDeload, isTaper),
      sessions: [],
    };

    populate({
      week: w,
      monday,
      weekVolume,
      total,
      request: req,
      calc,
      phase,
    });
    plan.weeks.push(w);
  }

  return plan;
}

// MARK: Week population

function populate({ week, monday, weekVolume, total, request, calc, phase }) {
  const days = Math.max(2, Math.min(7, request.daysPerWeek));
  const longRunWeekdayIndex = weekdayToDayIndex(request.longRunWeekday); // 0 = Mon

  const goal = goalOf(request);

  // Long-run distance grows through the block, then recedes in the taper.
  let longFraction;
  switch (goal.key) {
    case 'marathon':
    case 'ultra':
      longFraction = 0.38;
      break;
    case 'halfMarathon':
      longFraction = 0.32;
      break;
    default:
      longFraction = 0.28;
  }
  let longRun = Math.max(request.longRunMeters, weekVolume * longFraction);
  longRun = Math.min(longRun, weekVolume * 0.5);
  if (phase === 'taper') longRun *= 0.7;
  if (phase === 'race') longRun = 0;

  // Pick which weekdays are used, always including the long-run day.
  const trainingDays = chooseDays(days, longRunWeekdayIndex);

  const qCount = qualityCount(days);
  const rotation = qualityRotation(phase);
  const qualitySlots = trainingDays.filter((day) => day !== longRunWeekdayIndex).slice(0, qCount);
  const qualityDaySet = new Set(qualitySlots);

  // Remaining volume after the long run is split across the other days.
  const remaining = Math.max(0, weekVolume - longRun);
  const otherDays = trainingDays.filter((day) => day !== longRunWeekdayIndex);
  const easyDays = otherDays.filter((day) => !qualityDaySet.has(day));
  const qualityShare = phase === 'race' ? 0.2 : 0.26;
  const qualityPool = remaining * (qualityDaySet.size === 0 ? 0 : qualityShare);
  const easyPool = remaining - qualityPool;

  const qualityEach = qualityDaySet.size === 0 ? 0 : qualityPool / qualityDaySet.size;
  const easyEach = easyDays.length === 0 ? 0 : easyPool / Math.max(easyDays.length, 1);

  let qualityCursor = 0;
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const date = addDays(monday, dayIndex);

    if (!trainingDays.includes(dayIndex)) {
      const rest = SessionLibrary.restDay();
      rest.dayIndex = dayIndex;
      rest.date = isoDate(date);
      week.sessions.push(rest);
      continue;
    }

    let session;
    if (phase === 'race' && goal.isRaceGoal && dayIndex === longRunWeekdayIndex) {
      // Race week ends with the race itself, not a training session.
      session = SessionLibrary.raceDay({ distance: 0, request, calc });
    } else if (dayIndex === longRunWeekdayIndex && longRun > 0) {
      session = SessionLibrary.longRun({ distance: longRun, week, request, calc });
    } else if (qualityDaySet.has(dayIndex)) {
      const type = rotation[qualityCursor % rotation.length];
      qualityCursor += 1;
      session = SessionLibrary.quality({
        type,
        distance: Math.max(4000, qualityEach),
        weekIndex: week.weekIndex,
        totalWeeks: total,
        phase,
        request,
        calc,
      });
    } else {
      session = SessionLibrary.easyRun({
        distance: Math.max(3000, easyEach),
        isRecovery: phase === 'taper',
        request,
        calc,
      });
    }
    session.dayIndex = dayIndex;
    session.date = isoDate(date);
    week.sessions.push(session);
  }

  // Strength & mobility rides alongside the running week.
  if (request.wantsStrength && phase !== 'race') {
    const strengthDays = trainingDays
      .filter((day) => day !== longRunWeekdayIndex && !qualityDaySet.has(day))
      .slice(0, 2);
    strengthDays.forEach((dayIndex, i) => {
      const date = addDays(monday, dayIndex);
      const s = SessionLibrary.strength({ dayIndex, date: isoDate(date), index: i, phase });
      week.sessions.push(s);
    });
  }
}

/**
 * Maps a `Calendar` weekday (1 = Sunday) to a Monday-first day index.
 */
export function weekdayToDayIndex(weekday) {
  return (weekday + 5) % 7;
}

/**
 * Chooses `count` training days a week spread as evenly as possible while
 * always including the athlete's preferred long-run day.
 *
 * The Swift version returns a `Set`, whose iteration order is unspecified; we
 * return the same days sorted ascending so generated plans are deterministic.
 *
 * @returns {number[]} Monday-first day indices, ascending
 */
export function chooseDays(count, longRunDayIndex) {
  if (count >= 7) return [0, 1, 2, 3, 4, 5, 6];
  const chosen = new Set([longRunDayIndex]);
  // Prefer a spread of days; Mondays and Fridays are typical rest days.
  const preference = [2, 4, 0, 3, 5, 6, 1];
  for (const day of preference) {
    if (chosen.size >= count) break;
    if (Math.abs(day - longRunDayIndex) >= 1) chosen.add(day);
  }
  let filler = 0;
  while (chosen.size < count && filler < 7) {
    chosen.add(filler);
    filler += 1;
  }
  return [...chosen].sort((a, b) => a - b);
}

// MARK: Copy

/** `PlanGenerator.salesline(for:)`. */
export function salesline(request) {
  switch (goalOf(request).key) {
    case 'fiveK':
      return 'Sharpen up and take chunks off your 5K.';
    case 'tenK':
      return 'Build the speed and stamina to race 10K well.';
    case 'halfMarathon':
      return 'Go the distance over 13.1 miles with confidence.';
    case 'marathon':
      return 'A full marathon block built around your week.';
    case 'ultra':
      return 'Distance, time on feet and fuelling for the ultra.';
    case 'runFaster':
      return 'Structured speed work to lift your pace across the board.';
    case 'runFurther':
      return 'Extend your long run and build durable endurance.';
    case 'runToMaintain':
      return 'Keep your current fitness with a sustainable weekly rhythm.';
    case 'returnToRunning':
      return 'Rebuild running gradually after time away.';
    default:
      return 'Your first structured weeks of running.';
  }
}

/** `PlanGenerator.weekTitle(phase:week:isDeload:request:)` (request is unused in Swift too). */
export function weekTitle(phase, week, isDeload) {
  if (phase === 'race') return 'Race Week';
  if (isDeload) return 'Deload Week';
  switch (phase) {
    case 'foundation':
      return 'Settling In';
    case 'base':
      return 'Building the Base';
    case 'build':
      return 'Race Specific';
    case 'peak':
      return 'Peak Week';
    case 'taper':
      return 'Taper';
    default:
      return `Week ${week}`;
  }
}

/** `PlanGenerator.coachNote(phase:isDeload:isTaper:request:)` (request is unused in Swift too). */
export function coachNote(phase, isDeload, isTaper) {
  if (isTaper && phase === 'taper') {
    return 'Volume drops but intensity stays. Resist the urge to add extra miles — you are banking freshness now.';
  }
  if (isDeload) {
    return 'A planned step back. You will feel like you could do more; that is the point.';
  }
  switch (phase) {
    case 'foundation':
      return 'Keep every easy run genuinely conversational. The habit matters more than the pace this week.';
    case 'base':
      return 'Aerobic volume is the foundation everything else sits on. Consistency beats heroics.';
    case 'build':
      return 'This is where the plan bites. Hit the paces, but never at the cost of the next session.';
    case 'peak':
      return 'Biggest specific week of the block. Fuel properly and protect your sleep.';
    case 'race':
      return 'Shake out, stay off your feet, and trust the work you have already done.';
    default:
      return 'Stay consistent and listen to your body.';
  }
}

// MARK: Fitness anchor

/** The performance the plan is calibrated from, if the athlete gave one. */
export function anchorSource(request) {
  const d = request.recentRaceDistance;
  const t = request.recentRaceTime;
  if (d > 0 && t > 0) return { distance: d, time: t };
  const goal = goalOf(request);
  if (goal.raceDistance > 0 && request.goalTimeSeconds > 0) {
    return { distance: goal.raceDistance, time: request.goalTimeSeconds };
  }
  return null;
}

/** @returns {{vdot: number, source: string}} */
export function resolveAnchor(request) {
  const src = anchorSource(request);
  if (src) {
    return { vdot: vdotFor(src.distance, src.time), source: 'recent performance' };
  }
  // No anchor: fall back to a conservative ability-based VDOT.
  const fallback = {
    beginner: 30,
    intermediate: 40,
    advanced: 50,
    elite: 60,
    elitePlus: 68,
  };
  const ability = abilityOf(request);
  return { vdot: fallback[ability.key] ?? 40, source: 'ability estimate' };
}
