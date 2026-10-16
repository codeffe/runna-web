/**
 * progress.js — the Progress tab.
 *
 * Two segments, exactly as the native `ProgressTabView` has them:
 *
 *   Workouts    every activity in `state.runs`, newest first, filterable by
 *               session type, with a `+` that logs a manual run.
 *   Performance weekly mileage (12 weeks), personal bests, all-time stats,
 *               achievements and the Runna Score.
 *
 * Everything on this screen is derived from the athlete's real run history.
 * Nothing is hard-coded per athlete, and every section below is available to
 * everyone — nothing here is gated, locked or teased.
 *
 * Contract: `export default function progress(root, state, navigate)`.
 */

import {
  el,
  card,
  chip,
  ring,
  meter,
  segmented,
  sheet,
  toast,
  screenHeader,
  sectionHeader,
  statTile,
  emptyState,
  divider,
  svgIcon,
  sessionIcon,
  toDate,
} from '../ui/components.js';

import {
  countUp,
  staggerIn,
  haptic,
  prefersReducedMotion,
  animate as animateNode,
} from '../ui/motion.js';

import {
  saveState,
  addRun,
  weekStart,
  addDays,
} from '../domain/store.js';

import {
  formatDistance,
  formatDistanceWithUnit,
  formatPace,
  formatPaceShort,
  formatDuration,
  formatDate,
  startOfDay,
  daysBetween,
} from '../domain/format.js';

import { RUN_TYPES, RUN_TYPE_ORDER } from '../engine/enums.js';

/* ========================================================================== */
/* small numeric / date helpers                                               */
/* ========================================================================== */

const METERS_PER_MILE = 1609.344;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The date a run happened, or null. Runs carry `date` (manual) or `startedAt`. */
function runDate(run) {
  if (!run) return null;
  return toDate(run.date || run.startDate || run.startedAt || null);
}

/** A run's session-type key, always something present in `RUN_TYPES`. */
function typeKey(run) {
  const raw = run && (run.type || run.runType || run.sessionType);
  const key = typeof raw === 'string' ? raw : (raw && raw.key) || '';
  return RUN_TYPES[key] ? key : 'easyRun';
}

/** `RUN_TYPES[key]` with a guaranteed fallback. */
function typeDef(key) {
  return RUN_TYPES[key] || RUN_TYPES.easyRun;
}

/**
 * Session-type titles. `RUN_TYPES` from the engine is the source of truth for
 * both the colour and the name, so this screen cannot drift from the plan.
 */
function typeTitle(key) {
  return typeDef(key).title;
}

/**
 * Sprite icon for a session type.
 *
 * `sessionIcon()` in components.js covers every type the plan generator emits;
 * this only patches the two engine types its table does not carry, so a
 * cross-training or mobility block never falls back to a runner glyph.
 */
const ICON_OVERRIDES = { crossTraining: 'bolt', mobility: 'sun' };

function typeIcon(key) {
  return ICON_OVERRIDES[key] || sessionIcon(key);
}

const byNewest = (a, b) => (runDate(b)?.getTime() ?? 0) - (runDate(a)?.getTime() ?? 0);
const byOldest = (a, b) => (runDate(a)?.getTime() ?? 0) - (runDate(b)?.getTime() ?? 0);

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/* ========================================================================== */
/* elevation                                                                  */
/* ========================================================================== */

// ELEVATION — SYNTHESISED, AND SAID SO.
// ---------------------------------------------------------------------------
// The run recorder does not read a barometer, so recorded runs carry no climb
// figure. `normalizeRun()` in domain/store.js keeps only a fixed field list, so
// an `elevationMeters` value handed to `addRun()` is dropped on the way in.
//
// Rather than fight the store, the number is produced here:
//
//   * `synthesiseElevation(run)` is called when a manual run is logged, so the
//     value is chosen once, at creation, exactly as the brief asks;
//   * `elevationFor(run)` reads `run.elevationMeters` when it survived, and
//     otherwise re-derives the same value deterministically from the run's id,
//     type and distance.
//
// The climb is `km x metresPerKm(type) x jitter(id)`, so a hilly session climbs
// far more than a flat recovery jog, and any single run always reports the same
// figure — a chart that reshuffles on every render would be worse than a zero.
// Every elevation number this screen shows is therefore synthetic; the comment
// travels with it.

const CLIMB_METERS_PER_KM = {
  easyRun: 6,
  recovery: 4,
  longRun: 9,
  tempo: 5,
  intervals: 3,
  hills: 26,
  progression: 7,
  timeTrial: 3,
  race: 8,
  strength: 0,
  crossTraining: 0,
  rest: 0,
  mobility: 0,
};

/** Stable 0.65 … 1.35 multiplier from a string seed (FNV-1a). */
function elevationJitter(seed) {
  let h = 2166136261;
  const s = String(seed || 'runna');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 0.65 + (((h >>> 0) % 1000) / 999) * 0.7;
}

/** A plausible climb for one run, in metres. Synthetic — see the note above. */
function synthesiseElevation(run) {
  const km = num(run && run.distanceMeters) / 1000;
  if (km <= 0) return 0;
  const key = typeKey(run);
  const perKm = CLIMB_METERS_PER_KM[key] !== undefined ? CLIMB_METERS_PER_KM[key] : 6;
  return Math.round(km * perKm * elevationJitter(run && run.id));
}

/** The climb this screen reports for a run. Synthetic — see the note above. */
function elevationFor(run) {
  const stored = num(run && run.elevationMeters);
  if (stored > 0) return stored;
  return synthesiseElevation(run);
}

/* ========================================================================== */
/* analytics                                                                  */
/* ========================================================================== */

const PB_TARGETS = [
  { key: '1k', label: '1 km', meters: 1000 },
  { key: '1mi', label: '1 mile', meters: METERS_PER_MILE },
  { key: '5k', label: '5 km', meters: 5000 },
  { key: '10k', label: '10 km', meters: 10000 },
  { key: 'half', label: 'Half marathon', meters: 21097.5 },
  { key: 'marathon', label: 'Marathon', meters: 42195 },
];

/**
 * Personal bests over the standard distances.
 *
 * A run can only set a best at a distance it actually covered, so runs shorter
 * than the target are skipped. The time is the run's own average pace applied
 * to the target distance — the best effort the run contains — which is how a
 * fast 10K can set a 5K best without a separate 5K having been run.
 */
function personalBests(runs, now = new Date()) {
  const usable = runs
    .map((run) => ({
      run,
      date: runDate(run),
      meters: num(run.distanceMeters),
      seconds: num(run.durationSeconds),
    }))
    .filter((r) => r.date && r.meters > 0 && r.seconds > 0);

  return PB_TARGETS.map((target) => {
    let best = null;
    for (const r of usable) {
      if (r.meters < target.meters) continue;
      const seconds = r.seconds * (target.meters / r.meters);
      if (!best || seconds < best.seconds) best = { ...r, seconds };
    }
    if (!best) return { ...target, achieved: null };

    const age = daysBetween(best.date, now);
    return {
      ...target,
      achieved: {
        seconds: best.seconds,
        paceSecondsPerKm: best.seconds / (target.meters / 1000),
        date: best.date,
        runId: best.run.id,
        // "New" means set inside the last seven days — seven calendar days
        // including today, so age 0…6.
        isNew: age >= 0 && age < 7,
      },
    };
  });
}

/** Total distance, time, runs and (synthetic) elevation. */
function allTimeStats(runs) {
  let totalMeters = 0;
  let totalSeconds = 0;
  let totalElevation = 0;
  for (const run of runs) {
    const meters = num(run.distanceMeters);
    totalMeters += meters;
    totalSeconds += num(run.durationSeconds);
    totalElevation += elevationFor(run);
  }
  return { totalMeters, totalSeconds, totalElevation, runCount: runs.length };
}

/**
 * Distance per week for the last `count` Monday-based weeks, oldest first.
 * The final bucket is the week in progress.
 */
function weeklyBuckets(runs, count = 12, now = new Date()) {
  const thisMonday = weekStart(now);
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = addDays(thisMonday, -7 * i);
    buckets.push({ start, end: addDays(start, 6), meters: 0, runs: 0 });
  }

  const first = buckets[0].start;
  for (const run of runs) {
    const date = runDate(run);
    if (!date || date < first) continue;
    const index = Math.floor(daysBetween(first, date) / 7);
    if (index < 0 || index >= buckets.length) continue;
    buckets[index].meters += num(run.distanceMeters);
    buckets[index].runs += 1;
  }
  return buckets;
}

/**
 * The hour a run started, or null when the run carries no real start time.
 *
 * A manual entry stores a date with no clock time (midday — see `logRun`), and
 * midnight is treated as "no time recorded" too. That keeps the "before 7am"
 * badge honest instead of unlocking itself the first time a run is typed in.
 */
function startHour(run) {
  const raw = run && (run.startedAt || run.startDate);
  if (!raw) return null;
  const date = toDate(raw);
  if (!date) return null;
  const hour = date.getHours();
  if (hour === 0 && date.getMinutes() === 0) return null;
  return hour;
}

/** Consecutive Monday-based weeks containing at least one run. */
function longestWeekStreak(runs) {
  const weeks = new Set();
  for (const run of runs) {
    const date = runDate(run);
    if (date) weeks.add(weekStart(date).getTime());
  }
  const sorted = [...weeks].sort((a, b) => a - b);
  let best = 0;
  let streak = 0;
  let previous = null;
  for (const t of sorted) {
    streak = previous !== null && Math.round((t - previous) / 86400000) === 7 ? streak + 1 : 1;
    if (streak > best) best = streak;
    previous = t;
  }
  return best;
}

/** Consecutive calendar months containing at least one run. */
function longestMonthStreak(runs) {
  const months = new Set();
  for (const run of runs) {
    const date = runDate(run);
    if (date) months.add(date.getFullYear() * 12 + date.getMonth());
  }
  const sorted = [...months].sort((a, b) => a - b);
  let best = 0;
  let streak = 0;
  let previous = null;
  for (const m of sorted) {
    streak = previous !== null && m - previous === 1 ? streak + 1 : 1;
    if (streak > best) best = streak;
    previous = m;
  }
  return best;
}

/** Every number the achievements and the score need, computed in one pass. */
function summarise(runs) {
  const stats = allTimeStats(runs);
  const buckets = weeklyBuckets(runs, 12);

  let longestMeters = 0;
  let best5kSeconds = null;
  let best10kSeconds = null;
  let hasEarlyRun = false;
  let hasHillSession = false;

  for (const run of runs) {
    const meters = num(run.distanceMeters);
    const seconds = num(run.durationSeconds);
    if (meters > longestMeters) longestMeters = meters;

    if (meters >= 5000 && seconds > 0) {
      const projected = seconds * (5000 / meters);
      if (best5kSeconds === null || projected < best5kSeconds) best5kSeconds = projected;
    }
    if (meters >= 10000 && seconds > 0) {
      const projected = seconds * (10000 / meters);
      if (best10kSeconds === null || projected < best10kSeconds) best10kSeconds = projected;
    }

    const hour = startHour(run);
    if (hour !== null && hour < 7) hasEarlyRun = true;
    if (typeKey(run) === 'hills') hasHillSession = true;
  }

  // Runs per week, bucketed the same Monday-based way as the chart.
  const perWeek = new Map();
  for (const run of runs) {
    const date = runDate(run);
    if (!date) continue;
    const key = weekStart(date).getTime();
    perWeek.set(key, (perWeek.get(key) || 0) + 1);
  }

  return {
    ...stats,
    longestMeters,
    best5kSeconds,
    best10kSeconds,
    hasEarlyRun,
    hasHillSession,
    longestWeekStreak: longestWeekStreak(runs),
    longestMonthStreak: longestMonthStreak(runs),
    maxRunsInWeek: perWeek.size ? Math.max(...perWeek.values()) : 0,
    buckets,
  };
}

/* ========================================================================== */
/* Runna Score                                                                */
/* ========================================================================== */

// RUNNA SCORE — 0…100
// ---------------------------------------------------------------------------
// One number for "how is the training going", scored over the last 12 weeks of
// running activities. Three components, each normalised to 0…1 and then
// weighted, so the maximum is exactly 100:
//
//   Consistency       45 pts   runs per week  ÷  planned runs per week
//   Volume trend      35 pts   the last 2 weeks' average weekly distance
//                              against the preceding 6 weeks'
//   Pace improvement  20 pts   the weighted average pace of the last 4 weeks
//                              against the previous 8
//
//   trendRatio(d)  = clamp(0.50 + d / 0.40, 0, 1)   d = weekly change, -1…+1
//   paceRatio(dp)  = clamp(0.60 + dp / 75, 0, 1)    dp = seconds per km faster
//
// A component with no data behind it scores 0 rather than inventing a baseline,
// so the score only rises once there is real training to measure. Consistency
// and trend both read 0.5 at "no change", which is why a steady runner lands in
// the middle of the band rather than at the bottom.
//
// This is a documented simplification of Runna's own score, not a port of it:
// the real product scores against a programmed plan and is not bounded at 100.

const SCORE_WEIGHTS = { consistency: 45, trend: 35, pace: 20 };

function weightedPace(runs) {
  let seconds = 0;
  let meters = 0;
  for (const run of runs) {
    seconds += num(run.durationSeconds);
    meters += num(run.distanceMeters);
  }
  if (meters <= 0 || seconds <= 0) return null;
  return seconds / (meters / 1000);
}

function trendRatio(delta) {
  return clamp01(0.5 + delta / 0.4);
}

function paceRatio(secondsFaster) {
  return clamp01(0.6 + secondsFaster / 75);
}

function runnaScore(state, runs, now = new Date()) {
  const WEEKS = 12;
  const windowStart = startOfDay(addDays(now, -7 * WEEKS));

  const scored = runs
    .filter((run) => {
      const type = typeDef(typeKey(run));
      const date = runDate(run);
      return type.isRunning && date && date >= windowStart && num(run.distanceMeters) > 0;
    })
    .sort(byOldest);

  // ── Consistency ──────────────────────────────────────────────────────────
  const runsPerWeek = scored.length / WEEKS;
  const plannedPerWeek = num(
    (state.plan && state.plan.trainingDaysPerWeek) || (state.athlete && state.athlete.runsPerWeek),
  ) || 4;
  const consistencyRatio = clamp01(runsPerWeek / plannedPerWeek);

  // ── Volume trend: the last 2 weeks against the 6 before them ─────────────
  const recentStart = addDays(now, -14);
  const earlierStart = addDays(now, -56);
  const recentMeters = scored
    .filter((run) => runDate(run) >= recentStart)
    .reduce((sum, run) => sum + num(run.distanceMeters), 0);
  const earlierMeters = scored
    .filter((run) => runDate(run) >= earlierStart && runDate(run) < recentStart)
    .reduce((sum, run) => sum + num(run.distanceMeters), 0);

  const recentWeekly = recentMeters / 2;
  const earlierWeekly = earlierMeters / 6;
  let trend = 0;
  let trendDelta = null;
  if (earlierWeekly > 0) {
    trendDelta = recentWeekly / earlierWeekly - 1;
    trend = trendRatio(trendDelta);
  } else if (recentWeekly > 0) {
    trend = 1; // Building from zero — nothing to compare against, so credit it.
  }

  // ── Pace improvement: the last 4 weeks against the previous 8 ────────────
  const paceSplit = addDays(now, -28);
  const recentPace = weightedPace(scored.filter((run) => runDate(run) >= paceSplit));
  const earlierPace = weightedPace(scored.filter((run) => runDate(run) < paceSplit));
  let pace = 0;
  let paceDelta = null;
  if (recentPace !== null && earlierPace !== null) {
    paceDelta = earlierPace - recentPace; // positive = faster now
    pace = paceRatio(paceDelta);
  }

  const components = [
    {
      id: 'consistency',
      name: 'Consistency',
      points: consistencyRatio * SCORE_WEIGHTS.consistency,
      maximum: SCORE_WEIGHTS.consistency,
      detail: `${runsPerWeek.toFixed(1)} runs / week against ${plannedPerWeek} planned`,
    },
    {
      id: 'trend',
      name: 'Volume trend',
      points: trend * SCORE_WEIGHTS.trend,
      maximum: SCORE_WEIGHTS.trend,
      detail: earlierWeekly > 0
        ? `${trendDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(trendDelta * 100))}% weekly distance vs the previous 6 weeks`
        : recentWeekly > 0
          ? 'Building from zero — no baseline to compare against yet'
          : 'No runs in the last 12 weeks',
    },
    {
      id: 'pace',
      name: 'Pace improvement',
      points: pace * SCORE_WEIGHTS.pace,
      maximum: SCORE_WEIGHTS.pace,
      detail: paceDelta === null
        ? 'Needs runs in both halves of the window'
        : Math.abs(paceDelta) < 2
          ? `Holding steady at ${formatPaceShort(recentPace, state.athlete && state.athlete.units)}`
          : `${formatPaceShort(Math.abs(paceDelta), state.athlete && state.athlete.units)} per km ${
              paceDelta > 0 ? 'faster' : 'slower'
            } than 4+ weeks ago`,
    },
  ];

  const raw = components.reduce((sum, c) => sum + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let explanation;
  if (scored.length === 0) {
    explanation = 'Complete a few runs and your score will start tracking.';
  } else if (raw >= 80) {
    explanation = "You're training close to — or above — what your plan asks for.";
  } else if (raw >= 55) {
    explanation = 'Solid. Consistency is there; a little more volume would lift this.';
  } else if (raw >= 30) {
    explanation = "You're behind the plan's volume. Building back gradually will raise it.";
  } else {
    explanation = 'Not much to score yet — a couple of runs a week changes this quickly.';
  }

  return { score, explanation, components, weeks: WEEKS, runCount: scored.length };
}

/** Higher score pairs with a lighter green, exactly as the native screen does. */
function scoreColor(score) {
  const t = score / 100;
  if (t >= 0.75) return 'var(--bright-green)';
  if (t >= 0.5) return 'var(--primary)';
  if (t >= 0.3) return 'var(--success)';
  return 'var(--primary-deep)';
}

/* ========================================================================== */
/* Achievements                                                               */
/* ========================================================================== */

// Every badge has a criterion the code can actually evaluate against the run
// history — there is no badge here that cannot unlock. `progress` drives the
// "next up" meter; `check` decides the unlock.

const ACHIEVEMENTS = [
  {
    id: 'first-run',
    title: 'First Steps',
    detail: 'Log your first run',
    icon: 'shoe',
    color: 'var(--pace-easy)',
    check: (s) => s.runCount >= 1,
    progress: (s) => clamp01(s.runCount),
  },
  {
    id: 'five-k',
    title: 'First 5K',
    detail: 'Complete a run of 5 km or more',
    icon: 'flag',
    color: 'var(--info)',
    check: (s) => s.longestMeters >= 5000,
    progress: (s) => clamp01(s.longestMeters / 5000),
  },
  {
    id: 'ten-k',
    title: 'First 10K',
    detail: 'Complete a run of 10 km or more',
    icon: 'flag',
    color: 'var(--violet)',
    check: (s) => s.longestMeters >= 10000,
    progress: (s) => clamp01(s.longestMeters / 10000),
  },
  {
    id: 'half',
    title: 'Half Marathoner',
    detail: 'Complete a run of 21.1 km or more',
    icon: 'medal',
    color: 'var(--gold)',
    check: (s) => s.longestMeters >= 21097.5,
    progress: (s) => clamp01(s.longestMeters / 21097.5),
  },
  {
    id: 'sub25-5k',
    title: 'Sub-25 5K',
    detail: 'Cover 5 km inside 25 minutes',
    icon: 'bolt',
    color: 'var(--primary)',
    check: (s) => s.best5kSeconds !== null && s.best5kSeconds < 1500,
    progress: (s) => (s.best5kSeconds === null ? 0 : clamp01(1500 / s.best5kSeconds)),
  },
  {
    id: 'sub50-10k',
    title: 'Sub-50 10K',
    detail: 'Cover 10 km inside 50 minutes',
    icon: 'bolt',
    color: 'var(--pace-steady)',
    check: (s) => s.best10kSeconds !== null && s.best10kSeconds < 3000,
    progress: (s) => (s.best10kSeconds === null ? 0 : clamp01(3000 / s.best10kSeconds)),
  },
  {
    id: 'total-100',
    title: '100 km Club',
    detail: 'Cover 100 km in total',
    icon: 'route',
    color: 'var(--success)',
    check: (s) => s.totalMeters >= 100000,
    progress: (s) => clamp01(s.totalMeters / 100000),
  },
  {
    id: 'total-500',
    title: '500 km Club',
    detail: 'Cover 500 km in total',
    icon: 'route',
    color: 'var(--pace-steady)',
    check: (s) => s.totalMeters >= 500000,
    progress: (s) => clamp01(s.totalMeters / 500000),
  },
  {
    id: 'week-5',
    title: 'Five-Run Week',
    detail: 'Complete 5 runs inside one week',
    icon: 'calendar',
    color: 'var(--pace-tempo)',
    check: (s) => s.maxRunsInWeek >= 5,
    progress: (s) => clamp01(s.maxRunsInWeek / 5),
  },
  {
    id: 'early',
    title: 'Before 7am',
    detail: 'Start a recorded run before 07:00',
    icon: 'sun',
    color: 'var(--warning)',
    check: (s) => s.hasEarlyRun,
    progress: (s) => (s.hasEarlyRun ? 1 : 0),
  },
  {
    id: 'hills',
    title: 'Hill Session',
    detail: 'Complete a hill rep session',
    icon: 'mountain',
    color: 'var(--pace-threshold)',
    check: (s) => s.hasHillSession,
    progress: (s) => (s.hasHillSession ? 1 : 0),
  },
  {
    id: 'streak-4',
    title: 'Four-Week Streak',
    detail: 'Run at least once in 4 straight weeks',
    icon: 'flame',
    color: 'var(--streak)',
    check: (s) => s.longestWeekStreak >= 4,
    progress: (s) => clamp01(s.longestWeekStreak / 4),
  },
  {
    id: 'long-20',
    title: 'Over 20K',
    detail: 'Complete a single run over 20 km',
    icon: 'route',
    color: 'var(--violet)',
    check: (s) => s.longestMeters >= 20000,
    progress: (s) => clamp01(s.longestMeters / 20000),
  },
  {
    id: 'months-3',
    title: 'Three-Month Habit',
    detail: 'Run in 3 consecutive months',
    icon: 'calendar',
    color: 'var(--info)',
    check: (s) => s.longestMonthStreak >= 3,
    progress: (s) => clamp01(s.longestMonthStreak / 3),
  },
  {
    id: 'runs-50',
    title: 'Fifty Runs',
    detail: 'Complete 50 activities',
    icon: 'refresh',
    color: 'var(--pace-steady)',
    check: (s) => s.runCount >= 50,
    progress: (s) => clamp01(s.runCount / 50),
  },
  {
    id: 'elev-1000',
    title: '1000 m Climbed',
    detail: 'Climb 1000 m in total',
    icon: 'mountain',
    color: 'var(--pace-recovery)',
    check: (s) => s.totalElevation >= 1000,
    progress: (s) => clamp01(s.totalElevation / 1000),
  },
];

/* ========================================================================== */
/* presentation helpers                                                       */
/* ========================================================================== */

/** One activity in the Workouts list: type, date, distance, duration, pace. */
function activityRow(state, run, index, onTap) {
  const units = (state.athlete && state.athlete.units) || 'kilometers';
  const key = typeKey(run);
  const def = typeDef(key);
  const date = runDate(run);
  const meters = num(run.distanceMeters);
  const seconds = num(run.durationSeconds);
  const pace = num(run.paceSecondsPerKm) || (meters > 0 && seconds > 0 ? seconds / (meters / 1000) : 0);

  const meta = el('div', { class: 'row-wrap', style: { gap: '10px' } });
  if (meters > 0) {
    meta.appendChild(el('span', { class: 't-caption muted tabular', text: formatDistanceWithUnit(meters, units) }));
  }
  if (seconds > 0) {
    meta.appendChild(el('span', { class: 't-caption muted tabular', text: formatDuration(seconds) }));
  }
  if (pace > 0) {
    meta.appendChild(el('span', { class: 't-caption muted tabular', text: formatPace(pace, units) }));
  }

  const glyph = el(
    'div',
    {
      style: {
        display: 'grid',
        placeItems: 'center',
        width: '48px',
        height: '48px',
        flex: '0 0 auto',
        borderRadius: '14px',
        background: `color-mix(in srgb, ${def.accent} 16%, transparent)`,
        color: def.accent,
      },
    },
    svgIcon(typeIcon(key), 22),
  );

  const body = el(
    'div',
    { class: 'stack-sm', style: { minWidth: '0', flex: '1 1 auto', gap: '3px' } },
    el('div', { class: 't-body-strong truncate', text: typeTitle(key) }),
    el('div', {
      class: 't-micro faint',
      text: date ? formatDate(date).toUpperCase() : 'NO DATE',
    }),
    meta,
  );

  const trailing = el(
    'div',
    { class: 'row-sm' },
    svgIcon('chevron-right', 14),
  );
  trailing.style.color = 'var(--text-faint)';

  const row = el(
    'div',
    {
      class: ['card', 'card--tappable'],
      style: { '--i': String(Math.min(index, 12)), padding: '10px 14px' },
      role: 'button',
      tabindex: '0',
      dataset: { runId: run.id || '' },
      onclick: () => {
        haptic(10);
        if (typeof onTap === 'function') onTap(run);
      },
    },
    el('div', { class: 'row', style: { gap: '12px' } }, glyph, body, trailing),
  );
  return row;
}

/** One row of the personal-bests table. */
function bestRow(state, entry, index) {
  const units = (state.athlete && state.athlete.units) || 'kilometers';
  const achieved = entry.achieved;

  const heading = el('div', { class: 'row-sm', style: { gap: '7px' } });
  heading.appendChild(el('span', { class: 't-body-strong', text: entry.label }));
  if (achieved && achieved.isNew) {
    heading.appendChild(chip('New', { color: 'var(--gold)', icon: 'sparkle' }));
  }

  const sub = el('div', {
    class: 't-micro faint',
    text: achieved ? formatDate(achieved.date).toUpperCase() : 'NOT SET YET',
  });

  const value = el(
    'div',
    { style: { textAlign: 'right', flex: '0 0 auto' } },
    el('div', {
      class: 't-body-strong tabular',
      text: achieved ? formatDuration(achieved.seconds) : '—',
    }),
    el('div', {
      class: 't-micro faint tabular',
      text: achieved ? formatPace(achieved.paceSecondsPerKm, units) : '—',
    }),
  );

  const row = el(
    'div',
    {
      class: 'row-between',
      style: { padding: '11px 0', '--i': String(Math.min(index, 8)) },
    },
    el('div', { class: 'stack-sm', style: { gap: '3px', minWidth: '0' } }, heading, sub),
    value,
  );
  if (!achieved) row.style.opacity = '0.55';
  return row;
}

/** A locked badge is inert: no accent, no entrance, no celebration. */
function achievementBadge(summary, badge, index) {
  const unlocked = badge.check(summary);

  const tile = el(
    'div',
    {
      class: ['card', unlocked && 'card-entrance'],
      style: {
        padding: '12px',
        '--i': String(Math.min(index, 8)),
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        background: unlocked
          ? `color-mix(in srgb, ${badge.color} 12%, var(--surface, #1F262C))`
          : 'var(--sunken)',
        border: `1px solid ${unlocked ? badge.color : 'var(--stroke-soft)'}`,
        opacity: unlocked ? '1' : '0.45',
      },
      dataset: { badge: badge.id, unlocked: unlocked ? 'true' : 'false' },
    },
    el(
      'div',
      {
        style: {
          display: 'grid',
          placeItems: 'center',
          width: '34px',
          height: '34px',
          flex: '0 0 auto',
          borderRadius: '11px',
          background: unlocked ? badge.color : 'var(--raised)',
          color: unlocked ? 'var(--on-primary)' : 'var(--text-faint)',
        },
      },
      svgIcon(unlocked ? badge.icon : 'lock', 17),
    ),
    el(
      'div',
      { class: 'stack-sm', style: { gap: '2px', minWidth: '0' } },
      el('div', { class: 't-caption truncate', text: badge.title }),
      el('div', { class: 't-micro faint', text: badge.detail }),
      unlocked
        ? el('div', { class: 't-micro', style: { color: badge.color }, text: 'UNLOCKED' })
        : el('div', {
            class: 't-micro faint',
            text: `${Math.round(badge.progress(summary) * 100)}% THERE`,
          }),
    ),
  );
  return tile;
}

/**
 * Inline-SVG bar chart of the last 12 weeks. Each bar is a `<rect>` that grows
 * from the axis with `transform: scaleY()` — never a height change — and the
 * stagger is capped at 30 ms a bar so twelve bars resolve in about 330 ms.
 */
function weeklyMileageChart(buckets, units) {
  const W = 328;
  const H = 138;
  const LABEL_H = 16;
  const PLOT_H = H - LABEL_H;
  const GAP = 6;
  const slot = (W - GAP * (buckets.length - 1)) / buckets.length;
  const max = Math.max(1, ...buckets.map((b) => b.meters));
  const reduced = prefersReducedMotion();

  const total = buckets.reduce((sum, b) => sum + b.meters, 0);
  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    height: H,
    role: 'img',
    'aria-label': `Weekly distance for the last ${buckets.length} weeks, ${formatDistanceWithUnit(total, units)} in total`,
    style: { display: 'block', overflow: 'visible' },
  });

  // A single hairline at the axis keeps the bars visually anchored.
  // NOTE: `fill`/`stroke` always go through `style`, never through an
  // attribute — a presentation attribute cannot resolve `var(--token)`.
  svg.appendChild(el('line', {
    x1: 0,
    y1: PLOT_H,
    x2: W,
    y2: PLOT_H,
    'stroke-width': 1,
    style: { stroke: 'var(--stroke-soft)' },
  }));

  const rects = [];
  buckets.forEach((bucket, i) => {
    const x = i * (slot + GAP);
    const h = bucket.meters > 0 ? Math.max(3, (bucket.meters / max) * (PLOT_H - 8)) : 0;
    const y = PLOT_H - h;
    const isCurrent = i === buckets.length - 1;

    if (h > 0) {
      const rect = el('rect', {
        x,
        y,
        width: slot,
        height: h,
        rx: 3,
        style: {
          fill: isCurrent ? 'var(--bright-green)' : 'var(--primary)',
          transformBox: 'fill-box',
          transformOrigin: 'bottom',
          transform: reduced ? 'scaleY(1)' : 'scaleY(0)',
          transition: reduced ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
        },
      });
      svg.appendChild(rect);
      rects.push({ rect, delay: Math.min(i, 11) * 30 });
    }

    const label = el('text', {
      x: x + slot / 2,
      y: H - 3,
      'text-anchor': 'middle',
      'font-size': '9',
      'font-weight': '700',
      style: { fill: isCurrent ? 'var(--primary)' : 'var(--text-faint)' },
      text: String(bucket.start.getDate()),
    });
    svg.appendChild(label);
  });

  if (!reduced && rects.length) {
    requestAnimationFrame(() => {
      for (const { rect, delay } of rects) {
        rect.style.transitionDelay = `${delay}ms`;
        rect.style.transform = 'scaleY(1)';
      }
    });
  }

  return svg;
}

/* ========================================================================== */
/* the screen                                                                 */
/* ========================================================================== */

export default function progress(root, state, navigate) {
  const runs = () => (Array.isArray(state.runs) ? state.runs : []);
  const units = () => (state.athlete && state.athlete.units) || 'kilometers';

  let segment = 'workouts';
  let typeFilter = null;

  /* ---------------------------------------------------------- manual entry */

  /**
   * Persist a manually logged run. `date` is stored at midday local so a typed
   * entry can never be mistaken for a pre-dawn start, and the elevation figure
   * is chosen here, once, at creation.
   */
  function logRun(payload) {
    const record = {
      date: payload.date,
      type: payload.type,
      title: typeTitle(payload.type),
      distanceMeters: payload.distanceMeters,
      durationSeconds: payload.durationSeconds,
      elevationMeters: synthesiseElevation({
        id: `${payload.type}-${payload.distanceMeters}-${payload.durationSeconds}-${payload.date}`,
        type: payload.type,
        distanceMeters: payload.distanceMeters,
      }),
      source: 'manual',
    };
    const stored = addRun(state, record);
    // `addRun()` already calls saveState(); the explicit save keeps the write
    // visible at the call site and guarantees the manual entry is on disk even
    // if the store's behaviour changes.
    saveState(state);
    return stored;
  }

  /* ------------------------------------------------------- run detail sheet */

  /**
   * What one activity actually was. The Workouts row is tappable, so it needs
   * somewhere to go — this is the web build's `ActivityDetailView`.
   */
  function openRunSheet(run) {
    const key = typeKey(run);
    const def = typeDef(key);
    const date = runDate(run);
    const meters = num(run.distanceMeters);
    const seconds = num(run.durationSeconds);
    const pace = num(run.paceSecondsPerKm) || (meters > 0 && seconds > 0 ? seconds / (meters / 1000) : 0);
    const elevation = elevationFor(run);

    const identity = el(
      'div',
      { class: 'row-top', style: { gap: '12px' } },
      el(
        'div',
        {
          style: {
            display: 'grid',
            placeItems: 'center',
            width: '52px',
            height: '52px',
            flex: '0 0 auto',
            borderRadius: '14px',
            background: `color-mix(in srgb, ${def.accent} 16%, transparent)`,
            color: def.accent,
          },
        },
        svgIcon(typeIcon(key), 24),
      ),
      el(
        'div',
        { class: 'stack-sm', style: { gap: '6px', minWidth: '0' } },
        el('div', { class: 't-headline', text: typeTitle(key) }),
        el('div', {
          class: 't-caption muted',
          text: date ? formatDate(date) : 'No date recorded',
        }),
      ),
    );

    const facts = el(
      'div',
      { class: 'grid-2' },
      statTile('Distance', meters > 0 ? formatDistance(meters, units()) : '—', {
        unit: meters > 0 ? (units() === 'miles' ? 'mi' : 'km') : null,
        icon: 'route',
        accent: 'var(--primary)',
      }),
      statTile('Time', seconds > 0 ? formatDuration(seconds) : '—', {
        icon: 'clock',
        accent: 'var(--violet)',
      }),
      statTile('Average pace', pace > 0 ? formatPaceShort(pace, units()) : '—', {
        unit: pace > 0 ? `/${units() === 'miles' ? 'mi' : 'km'}` : null,
        icon: 'timer',
        accent: def.accent,
      }),
      statTile('Elevation', String(Math.round(elevation)), {
        unit: 'm',
        icon: 'mountain',
        accent: 'var(--pace-threshold)',
      }),
    );

    const node = sheet(
      {
        title: 'Activity',
        onClose: () => setTimeout(() => node.remove(), 600),
      },
      el(
        'div',
        { class: 'stack-lg' },
        identity,
        facts,
        el('div', { class: 't-micro faint', text: 'ELEVATION IS ESTIMATED FROM DISTANCE AND SESSION TYPE — THE RECORDER HAS NO BAROMETER.' }),
        run.notes
          ? card({ fill: 'var(--sunken)' }, el('p', { class: 't-caption secondary-text', style: { margin: '0' }, text: String(run.notes) }))
          : null,
      ),
    );
    node.open();
  }

  /** The "Log a run" sheet: type, distance, duration, date. */  function openLogSheet() {
    const draft = {
      type: 'easyRun',
      distance: '',
      hours: '',
      minutes: '30',
      seconds: '',
      date: todayInputValue(),
    };

    const typeRow = el('div', { class: 'scroll-x row-wrap', style: { flexWrap: 'nowrap', paddingBottom: '2px' } });
    const distanceInput = el('input', {
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: '0.0',
      class: 'metric-sm tabular',
      style: inputStyle(),
      'aria-label': `Distance in ${units() === 'miles' ? 'miles' : 'kilometres'}`,
    });
    const hourInput = durationInput('hrs', draft.hours);
    const minuteInput = durationInput('min', draft.minutes);
    const secondInput = durationInput('sec', draft.seconds);
    const dateInput = el('input', {
      type: 'date',
      max: todayInputValue(),
      value: draft.date,
      class: 't-body-strong',
      style: inputStyle(),
      'aria-label': 'Date of the run',
    });

    const pacePreview = el('div', {
      class: 't-caption',
      style: { color: 'var(--primary)', padding: '10px 14px', background: 'color-mix(in srgb, var(--primary) 12%, transparent)', borderRadius: '14px' },
      text: 'Enter a distance and a duration to see the average pace.',
    });

    const saveButton = el('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      disabled: true,
      text: 'Save run',
    });
    saveButton.style.opacity = '0.45';

    function meters() {
      return parseDecimal(distanceInput.value) * (units() === 'miles' ? METERS_PER_MILE : 1000);
    }
    function seconds() {
      return parseDecimal(hourInput.input.value) * 3600
        + parseDecimal(minuteInput.input.value) * 60
        + parseDecimal(secondInput.input.value);
    }

    function refresh() {
      const m = meters();
      const s = seconds();
      const valid = m > 0 && s > 0;
      saveButton.disabled = !valid;
      saveButton.style.opacity = valid ? '1' : '0.45';
      if (valid) {
        pacePreview.textContent = `Average pace ${formatPace(s / (m / 1000), units())}`;
        pacePreview.style.color = typeDef(draft.type).accent;
        pacePreview.style.background = `color-mix(in srgb, ${typeDef(draft.type).accent} 12%, transparent)`;
      } else {
        pacePreview.textContent = 'Enter a distance and a duration to see the average pace.';
        pacePreview.style.color = 'var(--text-muted)';
        pacePreview.style.background = 'color-mix(in srgb, var(--text-muted) 10%, transparent)';
      }
    }

    function paintTypes() {
      typeRow.textContent = '';
      for (const key of loggableTypes()) {
        const def = typeDef(key);
        const selected = draft.type === key;
        const node = chip(def.title, {
          color: def.accent,
          icon: typeIcon(key),
          filled: selected,
          neutral: !selected,
          onTap: () => {
            draft.type = key;
            paintTypes();
            refresh();
          },
        });
        typeRow.appendChild(node);
      }
    }

    for (const input of [distanceInput, hourInput.input, minuteInput.input, secondInput.input]) {
      input.addEventListener('input', refresh);
    }
    dateInput.addEventListener('change', () => { draft.date = dateInput.value || todayInputValue(); });

    const node = sheet(
      {
        title: 'Log a run',
        // `sheet()` mounts itself on document.body; drop it once it has closed
        // so re-opening from a re-rendered screen cannot pile up nodes.
        onClose: () => setTimeout(() => node.remove(), 600),
      },
      el(
        'div',
        { class: 'stack-lg' },
        el(
          'div',
          { class: 'section' },
          sectionHeader('Activity type'),
          typeRow,
        ),
        el(
          'div',
          { class: 'section' },
          sectionHeader('Details'),
          el(
            'div',
            { class: 'stack', style: { padding: '14px', background: 'var(--raised)', borderRadius: '14px' } },
            el('div', { class: 't-micro faint', text: units() === 'miles' ? 'DISTANCE (MI)' : 'DISTANCE (KM)' }),
            distanceInput,
          ),
          el(
            'div',
            { class: 'stack-sm' },
            el('div', { class: 't-micro faint', text: 'DURATION' }),
            el('div', { class: 'row', style: { gap: '8px' } }, hourInput.field, minuteInput.field, secondInput.field),
          ),
          el(
            'div',
            { class: 'stack-sm' },
            el('div', { class: 't-micro faint', text: 'DATE' }),
            dateInput,
          ),
          pacePreview,
          saveButton,
        ),
      ),
    );

    saveButton.addEventListener('click', () => {
      const m = meters();
      const s = seconds();
      if (!(m > 0 && s > 0)) return;
      haptic(18);
      logRun({
        type: draft.type,
        distanceMeters: m,
        durationSeconds: s,
        date: localMidday(dateInput.value),
      });
      toast('Run logged', { icon: 'check', tone: 'success' });
      node.close();
      renderContent(false);
    });

    paintTypes();
    refresh();
    return node;
  }

  /* ------------------------------------------------------------- workouts */

  function presentTypeKeys() {
    const present = new Set(runs().map(typeKey));
    return RUN_TYPE_ORDER.filter((key) => present.has(key));
  }

  function filteredRuns() {
    const list = runs().slice().sort(byNewest);
    if (!typeFilter) return list;
    return list.filter((run) => typeKey(run) === typeFilter);
  }

  function workoutsFragment() {
    const all = runs();
    const visible = filteredRuns();
    const wrap = el('div', { class: 'stack-lg' });

    // ── Filter chips ───────────────────────────────────────────────────────
    const types = presentTypeKeys();
    if (types.length) {
      const row = el('div', { class: 'scroll-x row-wrap', style: { flexWrap: 'nowrap', padding: '2px 0' } });
      const addChip = (node) => {
        node.style.flex = '0 0 auto';
        row.appendChild(node);
        return node;
      };
      addChip(chip('All', {
        color: 'var(--primary)',
        icon: 'chart',
        filled: typeFilter === null,
        neutral: typeFilter !== null,
        onTap: () => { typeFilter = null; renderContent(false); },
      }));
      for (const key of types) {
        const def = typeDef(key);
        addChip(chip(def.title, {
          color: def.accent,
          icon: typeIcon(key),
          filled: typeFilter === key,
          neutral: typeFilter !== key,
          onTap: () => { typeFilter = typeFilter === key ? null : key; renderContent(false); },
        }));
      }
      wrap.appendChild(row);
    }

    // ── Count line ─────────────────────────────────────────────────────────
    wrap.appendChild(el('div', {
      class: 't-caption muted',
      text: `${visible.length} ${visible.length === 1 ? 'run' : 'runs'}${typeFilter ? ` · ${typeTitle(typeFilter)}` : ''}`,
    }));

    // ── The list ───────────────────────────────────────────────────────────
    if (visible.length === 0) {
      wrap.appendChild(card(
        emptyState({
          icon: 'run',
          title: all.length === 0 ? 'No runs yet' : 'Nothing matches that filter',
          message: all.length === 0
            ? 'Runs you record, plus anything you log by hand, land here.'
            : 'Try a different session type, or clear the filter.',
          actionTitle: all.length === 0 ? 'Log a run' : 'Clear filter',
          onAction: () => {
            if (all.length === 0) openLogSheet().open();
            else { typeFilter = null; renderContent(false); }
          },
        }),
      ));
      return wrap;
    }

    const list = el('div', { class: 'stack-sm' });
    visible.forEach((run, index) => {
      list.appendChild(activityRow(state, run, index, () => openRunSheet(run)));
    });
    staggerIn(list, 40, 10);
    wrap.appendChild(list);
    return wrap;
  }

  /* ---------------------------------------------------------- performance */

  function performanceFragment() {
    const all = runs();
    const summary = summarise(all);
    const wrap = el('div', { class: 'stack-lg' });

    // ── Weekly mileage ─────────────────────────────────────────────────────
    const buckets = summary.buckets;
    const totalMeters = buckets.reduce((sum, b) => sum + b.meters, 0);
    const weeksWithRuns = buckets.filter((b) => b.meters > 0).length;
    const average = weeksWithRuns ? totalMeters / weeksWithRuns : 0;
    const biggest = Math.max(0, ...buckets.map((b) => b.meters));

    const chartCard = card(
      { padding: 14, class: 'section' },
      sectionHeader('Weekly distance'),
      el(
        'div',
        { class: 'row', style: { alignItems: 'baseline', gap: '8px' } },
        el('span', { class: 'metric-sm tabular', text: formatDistance(totalMeters, units()) }),
        el('span', { class: 't-caption muted', text: `in the last ${summary.buckets.length} weeks` }),
      ),
      weeksWithRuns
        ? weeklyMileageChart(buckets, units())
        : el('div', {
            class: 't-caption muted center',
            style: { padding: '28px 0' },
            text: 'No runs in the last 12 weeks.',
          }),
      weeksWithRuns
        ? el('div', {
            class: 't-micro faint',
            text: `WEEKS BEGINNING ${formatDate(buckets[0].start).toUpperCase()} – ${formatDate(buckets[buckets.length - 1].start).toUpperCase()}`,
          })
        : null,
      el(
        'div',
        { class: 'grid-2' },
        statTile('Weekly average', formatDistance(average, units()), {
          unit: units() === 'miles' ? 'mi' : 'km',
          icon: 'chart',
          accent: 'var(--primary)',
        }),
        statTile('Biggest week', formatDistance(biggest, units()), {
          unit: units() === 'miles' ? 'mi' : 'km',
          icon: 'chart',
          accent: 'var(--bright-green)',
        }),
      ),
    );

    // ── Personal bests ─────────────────────────────────────────────────────
    const bests = personalBests(all);
    const bestRows = el('div', { class: 'stack-sm' });
    bests.forEach((entry, index) => {
      bestRows.appendChild(bestRow(state, entry, index));
      if (index < bests.length - 1) bestRows.appendChild(divider());
    });

    const bestCard = card(
      { padding: 14, class: 'section' },
      sectionHeader('Personal bests'),
      bests.some((b) => b.achieved)
        ? bestRows
        : el('div', {
            class: 't-caption muted',
            text: 'Run 1 km or further and your bests over each distance appear here.',
          }),
      el('div', {
        class: 't-micro faint',
        text: 'A BEST IS THE FASTEST AVERAGE PACE YOU HAVE HELD OVER THAT DISTANCE INSIDE ANY LONGER RUN.',
      }),
    );

    // ── All-time stats ─────────────────────────────────────────────────────
    const statsCard = el(
      'div',
      { class: 'section' },
      sectionHeader('All-time stats'),
      el(
        'div',
        { class: 'grid-2' },
        statTile('Distance', formatDistance(summary.totalMeters, units()), {
          unit: units() === 'miles' ? 'mi' : 'km',
          icon: 'route',
          accent: 'var(--primary)',
          i: 0,
        }),
        statTile('Time', formatDuration(summary.totalSeconds), {
          icon: 'clock',
          accent: 'var(--violet)',
          i: 1,
        }),
        statTile('Runs', String(summary.runCount), {
          icon: 'run',
          accent: 'var(--info)',
          i: 2,
        }),
        statTile('Elevation', String(Math.round(summary.totalElevation)), {
          unit: 'm',
          icon: 'mountain',
          accent: 'var(--pace-threshold)',
          i: 3,
        }),
      ),
      el('div', {
        class: 't-micro faint',
        text: 'ELEVATION IS ESTIMATED FROM EACH RUN’S DISTANCE AND SESSION TYPE — THE RECORDER HAS NO BAROMETER.',
      }),
    );

    // ── Achievements ───────────────────────────────────────────────────────
    const unlocked = ACHIEVEMENTS.filter((badge) => badge.check(summary));
    const nextUp = ACHIEVEMENTS
      .filter((badge) => !badge.check(summary) && badge.progress(summary) > 0)
      .sort((a, b) => b.progress(summary) - a.progress(summary))[0] || null;

    const badgeGrid = el('div', { class: 'grid-2' });
    ACHIEVEMENTS.forEach((badge, index) => {
      badgeGrid.appendChild(achievementBadge(summary, badge, index));
    });

    const achievementsCard = card(
      { padding: 14, class: 'section' },
      sectionHeader('Achievements'),
      el(
        'div',
        { class: 'row-between' },
        el(
          'div',
          { class: 'row', style: { alignItems: 'baseline', gap: '8px' } },
          el('span', { class: 'metric-sm tabular', text: String(unlocked.length) }),
          el('span', { class: 't-caption muted', text: `of ${ACHIEVEMENTS.length} unlocked` }),
        ),
        meter({
          value: unlocked.length,
          max: ACHIEVEMENTS.length,
          color: 'var(--primary)',
          height: 6,
          format: () => `${unlocked.length} / ${ACHIEVEMENTS.length}`,
        }),
      ),
      badgeGrid,
      nextUp
        ? el(
            'div',
            { class: 'stack-sm' },
            el(
              'div',
              { class: 'row-between' },
              el('span', { class: 't-caption secondary-text', text: `Next up · ${nextUp.title}` }),
              el('span', { class: 't-micro faint', text: `${Math.round(nextUp.progress(summary) * 100)}%` }),
            ),
            meter({ value: nextUp.progress(summary), max: 1, color: 'var(--primary)', height: 6, animate: true }),
          )
        : null,
    );

    // ── Runna Score ────────────────────────────────────────────────────────
    const breakdown = runnaScore(state, all);
    const colour = scoreColor(breakdown.score);

    const scoreRing = ring({
      value: breakdown.score / 100,
      size: 104,
      lineWidth: 11,
      color: colour,
      label: '0',
      caption: 'OF 100',
    });
    countUp(scoreRing.querySelector('.ring-center__value'), 0, breakdown.score, {
      duration: 900,
      delay: 140,
      format: (v) => String(Math.round(v)),
    });

    const breakdownList = el('div', { class: 'stack' });
    breakdown.components.forEach((component, index) => {
      breakdownList.appendChild(el(
        'div',
        { class: 'stack-sm', style: { '--i': String(Math.min(index, 4)) } },
        el(
          'div',
          { class: 'row-between' },
          el('span', { class: 't-caption secondary-text', text: component.name }),
          el('span', {
            class: 't-caption muted tabular',
            text: `${Math.round(component.points)} / ${component.maximum}`,
          }),
        ),
        meter({
          value: component.points,
          max: component.maximum,
          color: colour,
          height: 6,
          animate: true,
        }),
        el('div', { class: 't-micro faint', text: component.detail }),
      ));
    });

    const scoreCard = card(
      { padding: 16, class: 'section' },
      sectionHeader('Runna Score'),
      el(
        'div',
        { class: 'row', style: { gap: '18px', alignItems: 'center' } },
        scoreRing,
        el(
          'div',
          { class: 'stack-sm', style: { gap: '6px', minWidth: '0' } },
          el('div', { class: 't-body-strong', text: `${breakdown.runCount} scoring ${breakdown.runCount === 1 ? 'run' : 'runs'}` }),
          el('div', { class: 't-caption muted', text: breakdown.explanation }),
        ),
      ),
      divider(),
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 't-micro faint', text: "HOW IT'S CALCULATED" }),
        breakdownList,
      ),
      el('div', {
        class: 't-micro faint',
        text: `CONSISTENCY ${SCORE_WEIGHTS.consistency} · VOLUME TREND ${SCORE_WEIGHTS.trend} · PACE IMPROVEMENT ${SCORE_WEIGHTS.pace} — SCORED OVER THE LAST ${breakdown.weeks} WEEKS.`,
      }),
    );

    wrap.appendChild(chartCard);
    wrap.appendChild(bestCard);
    wrap.appendChild(statsCard);
    wrap.appendChild(achievementsCard);
    wrap.appendChild(scoreCard);
    return wrap;
  }

  /* -------------------------------------------------------------- assembly */

  function renderContent(animate) {
    const view = segment === 'workouts' ? workoutsFragment() : performanceFragment();
    const content = root.querySelector('[data-progress-content]');
    if (!content) return;
    content.textContent = '';
    content.appendChild(view);
    if (animate) {
      animateNode(
        view,
        [
          { opacity: 0, transform: `translateX(${segment === 'performance' ? 16 : -16}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      );
    }
    // The tab bar sits at the bottom of a scrolling document; nothing here
    // observes scroll, so no list re-animates as the page moves.
  }

  const addButton = el(
    'button',
    {
      type: 'button',
      class: 'btn-icon',
      'aria-label': 'Log a run',
      onclick: () => {
        haptic(10);
        openLogSheet().open();
      },
    },
    svgIcon('plus', 20),
  );
  addButton.style.color = 'var(--primary)';

  const control = segmented(
    [
      { value: 'workouts', label: 'Workouts' },
      { value: 'performance', label: 'Performance' },
    ],
    {
      value: segment,
      onChange: (next) => {
        segment = next;
        addButton.hidden = next !== 'workouts';
        renderContent(true);
      },
    },
  );

  const body = el(
    'div',
    { class: 'screen-body' },
    screenHeader({ title: 'Progress', actions: [addButton] }),
    control,
    el('div', { 'data-progress-content': '' }),
  );

  root.appendChild(body);
  renderContent(false);
}

/* ========================================================================== */
/* input helpers                                                              */
/* ========================================================================== */

/** Every session type that can be logged by hand — rest days are not runs. */
function loggableTypes() {
  return RUN_TYPE_ORDER.filter((key) => key !== 'rest');
}

function inputStyle() {
  return {
    width: '100%',
    padding: '12px',
    borderRadius: '12px',
    background: 'var(--sunken)',
    border: '1px solid var(--stroke-soft)',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: '17px',
  };
}

function durationInput(label, initial) {
  const input = el('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: '0',
    value: initial || '',
    style: inputStyle(),
    'aria-label': label,
  });
  const field = el(
    'div',
    { class: 'stack-sm', style: { flex: '1 1 0', gap: '4px', minWidth: '0' } },
    input,
    el('div', { class: 't-micro faint center', text: label.toUpperCase() }),
  );
  return { field, input };
}

/** "8,5" and "8.5" both parse; anything else is 0. */
function parseDecimal(value) {
  const n = Number(String(value === undefined || value === null ? '' : value).replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Local YYYY-MM-DD for the date input, from a Date (default: today). */
function todayInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A chosen calendar day as a Date at midday local.
 *
 * Midday, not midnight: a stored midnight would look like an unrecorded start
 * time to the "before 7am" badge and unlock it by accident.
 */
function localMidday(value) {
  const parts = String(value || '').split('-').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}
