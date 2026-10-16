// Port of `app/Runna/Domain/Enums.swift` (+ the `RunnaColor` and `Units`
// definitions from `app/Runna/DesignSystem/Theme.swift`).
//
// Plain data only: frozen objects keyed by the enum's JS key, plus ordered
// arrays ("lookup tables") preserving `CaseIterable` order. Nothing here has
// behaviour beyond the small resolver helpers at the bottom.
//
// Colour values are the Swift `Color(hex:)` literals resolved to `#RRGGBB`.
// Where the Swift referenced a `RunnaColor` token the token is named in a
// trailing comment so the two files can be diffed by eye.

// MARK: - Frustration-free freezing

/** Recursively freeze a plain object/array so callers cannot corrupt the tables. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** Resolve an enum value that may be given as a key string or as the metadata object itself. */
function resolveFrom(table, value) {
  if (value && typeof value === 'object') {
    return value.key !== undefined ? table[value.key] ?? null : null;
  }
  if (typeof value === 'string') return table[value] ?? null;
  return null;
}

// MARK: - Goal
//
// Mirrors Runna's `Goal` GraphQL enum (recovered from the web client bundle).

export const GOALS = deepFreeze({
  fiveK: {
    key: 'fiveK',
    title: '5K',
    iconText: '5K',
    raceDistance: 5000,
    isRaceGoal: true,
    shieldColor: '#E3B304',
    selectable: true,
  },
  tenK: {
    key: 'tenK',
    title: '10K',
    iconText: '10K',
    raceDistance: 10000,
    isRaceGoal: true,
    shieldColor: '#E3B304',
    selectable: true,
  },
  halfMarathon: {
    key: 'halfMarathon',
    title: 'Half Marathon',
    iconText: '13.1',
    raceDistance: 21097.5,
    isRaceGoal: true,
    shieldColor: '#D9534F',
    selectable: true,
  },
  marathon: {
    key: 'marathon',
    title: 'Marathon',
    iconText: '26.2',
    raceDistance: 42195,
    isRaceGoal: true,
    shieldColor: '#C0392B',
    selectable: true,
  },
  ultra: {
    key: 'ultra',
    title: 'Ultramarathon',
    iconText: 'ULTRA',
    raceDistance: 50000,
    isRaceGoal: true,
    shieldColor: '#E5484D',
    selectable: true,
  },
  runFaster: {
    key: 'runFaster',
    title: 'Run Faster',
    iconText: 'RF',
    raceDistance: null,
    isRaceGoal: false,
    shieldColor: '#E5813A',
    selectable: true,
  },
  runFurther: {
    key: 'runFurther',
    title: 'Run Further',
    iconText: 'RUN',
    raceDistance: null,
    isRaceGoal: false,
    shieldColor: '#35CCB6',
    selectable: true,
  },
  runToMaintain: {
    key: 'runToMaintain',
    title: 'Run to Maintain',
    iconText: 'RM',
    raceDistance: null,
    isRaceGoal: false,
    shieldColor: '#4FA8E0',
    selectable: true,
  },
  returnToRunning: {
    key: 'returnToRunning',
    title: 'Return to Running',
    iconText: 'RTR',
    raceDistance: null,
    isRaceGoal: false,
    shieldColor: '#30A46C',
    selectable: false,
  },
  newToRunning: {
    key: 'newToRunning',
    title: 'New to Running',
    iconText: 'NTR',
    raceDistance: null,
    isRaceGoal: false,
    shieldColor: '#7B5CE6',
    selectable: false,
  },
});

/** `Goal.allCases` order. */
export const GOAL_ORDER = deepFreeze([
  'fiveK',
  'tenK',
  'halfMarathon',
  'marathon',
  'ultra',
  'runFaster',
  'runFurther',
  'runToMaintain',
  'returnToRunning',
  'newToRunning',
]);

/** `Goal.selectable` — the goals offered when creating a plan, in Runna's order. */
export const SELECTABLE_GOALS = deepFreeze(
  GOAL_ORDER.filter((key) => GOALS[key].selectable),
);

/** Resolve a goal given as a key string or as the `GOALS` object. */
export function getGoal(value) {
  return resolveFrom(GOALS, value);
}

// MARK: - Ability

export const ABILITIES = deepFreeze({
  beginner: {
    key: 'beginner',
    title: 'Beginner',
    blurb: 'New to running, or returning after a long break.',
    weeklyVolumeBand: [10000, 30000],
  },
  intermediate: {
    key: 'intermediate',
    title: 'Intermediate',
    blurb: 'Running regularly for 6+ months.',
    weeklyVolumeBand: [25000, 50000],
  },
  advanced: {
    key: 'advanced',
    title: 'Advanced',
    blurb: 'Chasing personal bests consistently.',
    weeklyVolumeBand: [40000, 80000],
  },
  elite: {
    key: 'elite',
    title: 'Elite',
    blurb: 'Competitive at a high level.',
    weeklyVolumeBand: [70000, 130000],
  },
  elitePlus: {
    key: 'elitePlus',
    title: 'Elite+',
    blurb: 'Sub-elite / national standard.',
    weeklyVolumeBand: [100000, 180000],
  },
});

/** `Ability.allCases` order. */
export const ABILITY_ORDER = deepFreeze([
  'beginner',
  'intermediate',
  'advanced',
  'elite',
  'elitePlus',
]);

/** Resolve an ability given as a key string or as the `ABILITIES` object. */
export function getAbility(value) {
  return resolveFrom(ABILITIES, value);
}

/** Runs-per-week gates from the brief: Beginner/Intermediate 2–4, Advanced 2–6, Elite/Elite+ 2–7. */
export const RUNS_PER_WEEK_RANGE = deepFreeze({
  beginner: [2, 4],
  intermediate: [2, 4],
  advanced: [2, 6],
  elite: [2, 7],
  elitePlus: [2, 7],
});

// MARK: - Session type
//
// Mirrors Runna's `runType` values observed in `GetPreviewActiveOrderWeeks`.
//
// `fartlek` is deliberately absent: recon established that it is not a Runna
// session type, so the engine never schedules it and never names it. (The Swift
// enum keeps the case only so historic rows still render.)
//
// `symbol` is a short, stable icon key — SF Symbols do not exist on the web, so
// the UI maps it to an inline SVG. The SF Symbol each one replaces is named in
// a comment.

export const RUN_TYPES = deepFreeze({
  easyRun: {
    key: 'easyRun',
    title: 'Easy Run',
    symbol: 'run', // figure.run
    accent: '#9FBE19', // lime
    isRunning: true,
    isQuality: false,
  },
  longRun: {
    key: 'longRun',
    title: 'Long Run',
    symbol: 'long-run', // figure.run.circle
    accent: '#7C52AD', // purple
    isRunning: true,
    isQuality: false,
  },
  tempo: {
    key: 'tempo',
    title: 'Tempo Run',
    symbol: 'gauge', // gauge.with.dots.needle.67percent
    accent: '#E3A008', // RunnaColor.paceTempo (amber)
    isRunning: true,
    isQuality: true,
  },
  intervals: {
    key: 'intervals',
    title: 'Intervals',
    symbol: 'bolt', // bolt.fill
    accent: '#DC4F27', // orange-red
    isRunning: true,
    isQuality: true,
  },
  hills: {
    key: 'hills',
    title: 'Hill Reps',
    symbol: 'mountain', // mountain.2.fill
    accent: '#DB4B29', // burnt orange
    isRunning: true,
    isQuality: true,
  },
  progression: {
    key: 'progression',
    title: 'Progression Run',
    symbol: 'trend-up', // chart.line.uptrend.xyaxis
    accent: '#4FA8E0', // RunnaColor.paceSteady
    isRunning: true,
    isQuality: true,
  },
  timeTrial: {
    key: 'timeTrial',
    title: 'Time Trial',
    symbol: 'stopwatch', // stopwatch.fill
    accent: '#E05562', // pink-red
    isRunning: true,
    isQuality: true,
  },
  race: {
    key: 'race',
    title: 'Race Day',
    symbol: 'flag', // flag.checkered
    accent: '#35CCB6', // RunnaColor.primary
    isRunning: true,
    isQuality: true,
  },
  recovery: {
    key: 'recovery',
    title: 'Recovery Run',
    symbol: 'leaf', // leaf.fill
    accent: '#6FBF73', // green
    isRunning: true,
    isQuality: false,
  },
  strength: {
    key: 'strength',
    title: 'Strength',
    symbol: 'dumbbell', // dumbbell.fill
    accent: '#E05562', // pink-red
    isRunning: false,
    isQuality: false,
  },
  crossTraining: {
    key: 'crossTraining',
    title: 'Cross Training',
    symbol: 'cardio', // figure.mixed.cardio
    accent: '#2D7DD2', // RunnaColor.info
    isRunning: false,
    isQuality: false,
  },
  rest: {
    key: 'rest',
    title: 'Rest Day',
    symbol: 'moon', // moon.zzz.fill
    accent: '#586169', // RunnaColor.textFaint
    isRunning: false,
    isQuality: false,
  },
  mobility: {
    key: 'mobility',
    title: 'Mobility',
    symbol: 'stretch', // figure.flexibility
    accent: '#30A46C', // RunnaColor.success
    isRunning: false,
    isQuality: false,
  },
});

/** `RunType.allCases` order, minus `fartlek`. */
export const RUN_TYPE_ORDER = deepFreeze([
  'easyRun',
  'longRun',
  'tempo',
  'intervals',
  'hills',
  'progression',
  'timeTrial',
  'race',
  'recovery',
  'strength',
  'crossTraining',
  'rest',
  'mobility',
]);

/** Resolve a run type given as a key string or as the `RUN_TYPES` object. */
export function getRunType(value) {
  return resolveFrom(RUN_TYPES, value);
}

// MARK: - Terrain

export const TERRAIN = deepFreeze({
  flat: { key: 'flat', title: 'Flat', symbol: 'flat' }, // arrow.left.and.right
  rolling: { key: 'rolling', title: 'Rolling', symbol: 'rolling' }, // wave.3.right
  hilly: { key: 'hilly', title: 'Hilly', symbol: 'mountain' }, // mountain.2.fill
  track: { key: 'track', title: 'Track', symbol: 'track' }, // oval.fill
  treadmill: { key: 'treadmill', title: 'Treadmill', symbol: 'treadmill' }, // figure.run.treadmill
  trail: { key: 'trail', title: 'Trail', symbol: 'tree' }, // tree.fill
});

/** `Terrain.allCases` order. */
export const TERRAIN_ORDER = deepFreeze([
  'flat',
  'rolling',
  'hilly',
  'track',
  'treadmill',
  'trail',
]);

/** Resolve a terrain given as a key string or as the `TERRAIN` object. */
export function getTerrain(value) {
  return resolveFrom(TERRAIN, value);
}

// MARK: - Pace zones
//
// Runna labels training intensities by name rather than by numbered zone.
// Ordered easiest -> hardest.

export const PACE_ZONES = deepFreeze({
  recovery: {
    key: 'recovery',
    title: 'Recovery',
    purpose: 'Flush the legs. Conversational, never hard.',
    color: '#6FBF73', // RunnaColor.paceRecovery
    vdotFraction: 0.59,
  },
  easy: {
    key: 'easy',
    title: 'Easy',
    purpose: 'Build aerobic base and capillary density.',
    color: '#9FBE19', // RunnaColor.paceEasy
    vdotFraction: 0.65,
  },
  steady: {
    key: 'steady',
    title: 'Steady',
    purpose: 'Aerobic support between easy and tempo.',
    color: '#4FA8E0', // RunnaColor.paceSteady
    vdotFraction: 0.75,
  },
  tempo: {
    key: 'tempo',
    title: 'Tempo',
    purpose: 'Comfortably hard. Raise lactate threshold.',
    color: '#E3A008', // RunnaColor.paceTempo
    vdotFraction: 0.83,
  },
  threshold: {
    key: 'threshold',
    title: 'Threshold',
    purpose: 'Sustained hard effort at threshold.',
    color: '#E5813A', // RunnaColor.paceThreshold
    vdotFraction: 0.88,
  },
  interval: {
    key: 'interval',
    title: 'Interval',
    purpose: 'VO2max development at 3K–5K effort.',
    color: '#DC4F27', // RunnaColor.paceInterval
    vdotFraction: 0.975,
  },
  repetition: {
    key: 'repetition',
    title: 'Repetition',
    purpose: 'Speed and running economy. Short and fast.',
    color: '#DB4B29', // RunnaColor.paceRepetition
    vdotFraction: 1.05,
  },
  race: {
    key: 'race',
    title: 'Race Pace',
    purpose: 'The exact pace you will hold on race day.',
    color: '#35CCB6', // RunnaColor.paceRace
    vdotFraction: 0.91,
  },
});

/** `PaceZone.allCases` order. */
export const PACE_ZONE_ORDER = deepFreeze([
  'recovery',
  'easy',
  'steady',
  'tempo',
  'threshold',
  'interval',
  'repetition',
  'race',
]);

/**
 * `PaceZone.trainingOrder` — default display order, easiest -> hardest.
 * Race pace is excluded: it is derived from the athlete's goal, not the ramp.
 */
export const TRAINING_ORDER = deepFreeze([
  'recovery',
  'easy',
  'steady',
  'tempo',
  'threshold',
  'interval',
  'repetition',
]);

/** Resolve a pace zone given as a key string or as the `PACE_ZONES` object. */
export function getPaceZone(value) {
  return resolveFrom(PACE_ZONES, value);
}

// MARK: - Training mode
//
// Mirrors `TrainingModeSettings` from the Runna web client. The engine carries
// two independent axes: training volume (`trainingLoad`) and difficulty
// (`difficulty`), both drawn from this same table.

export const TRAINING_LOADS = deepFreeze({
  veryEasy: {
    key: 'veryEasy',
    title: 'Very Easy',
    mileageMultiplier: 0.8,
    difficultyMultiplier: 0.96,
  },
  easy: {
    key: 'easy',
    title: 'Easy',
    mileageMultiplier: 0.9,
    difficultyMultiplier: 0.98,
  },
  standard: {
    key: 'standard',
    title: 'Standard',
    mileageMultiplier: 1.0,
    difficultyMultiplier: 1.0,
  },
  hard: {
    key: 'hard',
    title: 'Hard',
    mileageMultiplier: 1.12,
    difficultyMultiplier: 1.03,
  },
});

/** `TrainingLoad.allCases` order (VERY_EASY, EASY, DEFAULT, HARD). */
export const TRAINING_LOAD_ORDER = deepFreeze(['veryEasy', 'easy', 'standard', 'hard']);

/** Resolve a training load given as a key string or as the `TRAINING_LOADS` object. */
export function getTrainingLoad(value) {
  return resolveFrom(TRAINING_LOADS, value);
}

// MARK: - Plan phase

export const PLAN_PHASES = deepFreeze({
  foundation: {
    key: 'foundation',
    title: 'Foundation',
    blurb: 'Establish routine and easy aerobic volume.',
    color: '#6FBF73', // RunnaColor.paceRecovery
  },
  base: {
    key: 'base',
    title: 'Base',
    blurb: 'Grow the aerobic engine and introduce steady work.',
    color: '#9FBE19', // RunnaColor.paceEasy
  },
  build: {
    key: 'build',
    title: 'Build',
    blurb: 'Race-specific sessions at target intensities.',
    color: '#4FA8E0', // RunnaColor.paceSteady
  },
  peak: {
    key: 'peak',
    title: 'Peak',
    blurb: 'Highest specific load before you back off.',
    color: '#E5813A', // RunnaColor.paceThreshold
  },
  taper: {
    key: 'taper',
    title: 'Taper',
    blurb: 'Reduce volume, retain intensity, arrive fresh.',
    color: '#7C52AD', // RunnaColor.violet
  },
  race: {
    key: 'race',
    title: 'Race',
    blurb: 'Race week. Sharpen, then go.',
    color: '#35CCB6', // RunnaColor.paceRace
  },
});

/** `PlanPhase.allCases` order. */
export const PLAN_PHASE_ORDER = deepFreeze([
  'foundation',
  'base',
  'build',
  'peak',
  'taper',
  'race',
]);

/** Resolve a plan phase given as a key string or as the `PLAN_PHASES` object. */
export function getPlanPhase(value) {
  return resolveFrom(PLAN_PHASES, value);
}

// MARK: - Units (mirrors `UnitOfMeasurementV2` / `Units`)

export const UNITS = deepFreeze({
  kilometers: {
    key: 'kilometers',
    title: 'Kilometers',
    short: 'km',
    suffix: 'km',
    metersPerUnit: 1000,
  },
  miles: {
    key: 'miles',
    title: 'Miles',
    short: 'mi',
    suffix: 'mi',
    metersPerUnit: 1609.344,
  },
});

/** `UnitOfMeasurementV2.allCases` order. */
export const UNIT_ORDER = deepFreeze(['kilometers', 'miles']);

/** Resolve units given as a key string or as the `UNITS` object. */
export function getUnits(value) {
  return resolveFrom(UNITS, value);
}
