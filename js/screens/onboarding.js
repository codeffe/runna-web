/**
 * screens/onboarding.js — the plan wizard.
 *
 * Mirrors app/Runna/Features/Onboarding/OnboardingFlowView.swift:
 *
 *   goal → race distance → race date → ability → weekly mileage → longest run
 *        → Estimated Race Time → runs per week → long-run day
 *        → volume × difficulty → units → plan length → summary
 *
 * The race-distance and race-date steps only appear for race goals, exactly as
 * the native flow's `stepsInUse` filters them out for Run Faster / Further /
 * Maintain.
 *
 * Two product facts the screen must never get wrong:
 *   - the Estimated Race Time describes CURRENT ability — it is never a goal
 *     time, and there is no way to enter one;
 *   - runs per week is gated by ability, and plans are 6–26 weeks (hard cap 26).
 *
 * Contract: `export default function screen(root, state, navigate)`.
 */

import {
  GOALS,
  ABILITIES,
  TRAINING_LOADS,
  UNITS,
  ABILITY_ORDER,
  RUNS_PER_WEEK_RANGE,
} from '../engine/enums.js';
import * as planGenerator from '../engine/planGenerator.js';
import * as paceEngine from '../engine/pace.js';
import * as raceMath from '../engine/raceMath.js';
import {
  saveState,
  markSessionComplete,
  addRun,
  sessionId,
  startOfDay,
  addDays,
  weekStart,
  diffDays,
} from '../domain/store.js';
import {
  formatDistance,
  formatDuration,
  formatPaceShort,
  toISODate,
} from '../domain/format.js';
import {
  el,
  card,
  chip,
  svgIcon,
  planShield,
  meter,
  toast,
} from '../ui/components.js';
import { motion, staggerIn, animate, hapticCommit } from '../ui/motion.js';

/**
 * The icon sprite has no `minus`, so the stepper's decrement control is a text
 * glyph. Everything else comes from the shared sprite.
 */
function glyph(name, size = 18) {
  if (name === 'minus') {
    return el('span', {
      'aria-hidden': 'true',
      style: { fontSize: `${size}px`, fontWeight: '700', lineHeight: '1' },
      text: '−',
    });
  }
  return svgIcon(name, size);
}

/* ------------------------------------------------------------------ engine */

/**
 * The engine exports `generate`; the brief calls it `generatePlan`. Accept
 * either so the screen survives the name drifting.
 */
function generatePlan(request) {
  const fn = planGenerator.generatePlan || planGenerator.generate;
  if (typeof fn !== 'function') throw new Error('planGenerator: no generate() export');
  return fn(request);
}

/** `makePaceCalculator` per the brief, `paceCalculatorFromRace` per the engine. */
function makeCalculator(recentDistance, recentTime) {
  if (typeof paceEngine.makePaceCalculator === 'function') {
    return paceEngine.makePaceCalculator({ recentDistance, recentTime });
  }
  if (typeof paceEngine.paceCalculatorFromRace === 'function') {
    return paceEngine.paceCalculatorFromRace({ recentDistance, recentTime });
  }
  const vdot = raceMath.vdot(recentDistance, recentTime);
  return new paceEngine.PaceCalculator({ vdot });
}

/* ------------------------------------------------------------------- model */

const BENCHMARK_DISTANCES = [
  { key: 'fiveK', title: '5K', longTitle: '5K', meters: 5000, reference: 22 * 60 },
  { key: 'tenK', title: '10K', longTitle: '10K', meters: 10000, reference: 46 * 60 },
  { key: 'half', title: 'Half', longTitle: 'Half Marathon', meters: 21097.5, reference: 1 * 3600 + 42 * 60 },
];

const BENCHMARK_BOUNDS = {
  fiveK: [11 * 60, 55 * 60],
  tenK: [23 * 60, 115 * 60],
  half: [50 * 60, 250 * 60],
};

const BENCHMARK_DEFAULTS = { fiveK: 24 * 60, tenK: 50 * 60, half: 1 * 3600 + 52 * 60 };

const LONG_RUN_HINTS = {
  0: 'Start the week with your biggest run.',
  4: 'Get it done before the weekend.',
  5: 'Weekend long runs. The Runna default.',
  6: 'Weekend long runs. The Runna default.',
};

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The five plan-type cards, mirroring the native `planTypes` table. */
const PLAN_TYPES = [
  { title: 'Race', subtitle: 'Train for a specific race date and distance.', goal: 'tenK', icon: 'flag' },
  { title: 'Run a specific distance', subtitle: 'Get race-ready for a 5K up to 50K.', goal: 'halfMarathon', icon: 'target' },
  { title: 'Run faster', subtitle: 'Structured speed work across every distance.', goal: 'runFaster', icon: 'bolt' },
  { title: 'Run further', subtitle: 'Extend your long run and build endurance.', goal: 'runFurther', icon: 'route' },
  { title: 'Run to maintain', subtitle: 'Keep your current fitness with a sustainable rhythm.', goal: 'runToMaintain', icon: 'refresh' },
];

const VOLUME_OPTIONS = [
  { key: 'progressive', title: 'Progressive', blurb: 'High mileage. Your weekly volume climbs quickly through the block.', multiplier: 1.12 },
  { key: 'steady', title: 'Steady', blurb: 'A balanced build. Volume rises at the rate most runners absorb best.', multiplier: 1.0 },
  { key: 'gradual', title: 'Gradual', blurb: 'Lower mileage. A gentler ramp, with more room to absorb the hard days.', multiplier: 0.88 },
];

const DIFFICULTY_OPTIONS = [
  { key: 'challenging', title: 'Challenging', blurb: 'Hard sessions are run at the quicker end of every pace range.', multiplier: 1.03 },
  { key: 'balanced', title: 'Balanced', blurb: 'The middle of each pace range. The default Runna prescription.', multiplier: 1.0 },
  { key: 'comfortable', title: 'Comfortable', blurb: 'Hard sessions sit at the easier end of their range.', multiplier: 0.96 },
];

const MIN_PLAN_WEEKS = 6;
const MAX_PLAN_WEEKS = 26; // hard cap, brief §Product facts

/* ------------------------------------------------------------------ screen */

export default function screen(root, state, navigate) {
  if (!root) return;
  if (!state.athlete) state.athlete = {};

  /* ---------------------------------------------------------------- draft */

  const today = startOfDay(new Date());

  const draft = {
    goalKey: 'tenK',
    abilityKey: state.athlete.ability && ABILITIES[state.athlete.ability]
      ? state.athlete.ability
      : 'intermediate',
    weeklyKm: 25,
    longestKm: 10,
    knowsBenchmark: true,
    benchmarkKey: 'tenK',
    benchmarkSeconds: BENCHMARK_DEFAULTS.tenK,
    benchmarkTouched: false,
    runsPerWeek: 3,
    longRunDay: 6,
    volume: 'steady',
    difficulty: 'balanced',
    units: state.athlete.units === 'miles' ? 'miles' : 'kilometers',
    planLength: 12,
    raceDate: addDays(today, 7 * 12),
  };

  let index = 0;
  let direction = 1; // +1 forward (slides in from the right), -1 back
  let stepHost = null;

  /* ------------------------------------------------------------ step model */

  const isRaceGoal = () => !!(GOALS[draft.goalKey] && GOALS[draft.goalKey].isRaceGoal);

  function stepsInUse() {
    const list = ['goal'];
    if (isRaceGoal()) list.push('raceSelect', 'raceDate');
    list.push(
      'ability',
      'weeklyMileage',
      'longestRun',
      'benchmark',
      'runsPerWeek',
      'longRunDay',
      'preferences',
      'units',
      'planLength',
      'summary',
    );
    return list;
  }

  const STEP_TITLES = {
    goal: 'What are you training for?',
    raceSelect: 'Choose your race',
    raceDate: 'When is your race?',
    ability: 'What is your running ability?',
    weeklyMileage: 'Your current weekly mileage',
    longestRun: 'Your current longest run',
    benchmark: 'Your current race time',
    runsPerWeek: 'How many runs per week?',
    longRunDay: 'Pick your long-run day',
    preferences: 'Training preferences',
    units: 'Units',
    planLength: 'How long should the plan be?',
    summary: 'Your plan',
  };

  const STEP_SUBTITLES = {
    goal: 'Runna builds distance-based plans around a race or a running goal.',
    raceSelect: 'Every race distance from 5K to 50K is supported.',
    raceDate: 'Your plan finishes on race week. Plans are capped at 26 weeks.',
    ability: 'This sets your starting mileage, session distances and how often you can run.',
    weeklyMileage: 'The distance you are comfortably running in a normal week right now.',
    longestRun: 'The longest single run you have completed in the last month or two.',
    benchmark: 'One recent finish time is enough. Runna uses this as your Estimated Race Time to set every pace target.',
    runsPerWeek: 'Your ability level caps how many runs a week your plan can hold.',
    longRunDay: 'The rest of your week reflows around this day.',
    preferences: 'Volume sets how much your mileage builds. Difficulty sets how hard the sessions bite. They are independent.',
    units: 'Used for every distance, pace target and audio cue in the app.',
    planLength: 'You can extend or shorten this later from Manage Plan.',
    summary: 'Check everything over, then build the plan.',
  };

  /* ------------------------------------------------------- derived answers */

  const runsRange = () => RUNS_PER_WEEK_RANGE[draft.abilityKey] || [2, 4];
  const maxRuns = () => runsRange()[1];
  const minRuns = () => runsRange()[0];

  const abilityMeta = () => ABILITIES[draft.abilityKey] || ABILITIES.intermediate;
  const goalMeta = () => GOALS[draft.goalKey] || GOALS.tenK;

  const benchmarkMeta = () =>
    BENCHMARK_DISTANCES.find((d) => d.key === draft.benchmarkKey) || BENCHMARK_DISTANCES[1];

  /** The "I don't know" path: estimate a recent race time from ability + volume. */
  function estimateFromAbility() {
    const d = benchmarkMeta();
    const abilityIndex = Math.max(0, ABILITY_ORDER.indexOf(draft.abilityKey));
    const abilityFactor = 1.22 - 0.085 * abilityIndex;
    const band = abilityMeta().weeklyVolumeBand;
    const midKm = (band[0] + band[1]) / 2000;
    const volumeFactor = 1 + ((midKm - Math.max(draft.weeklyKm, 1)) / Math.max(midKm, 1)) * 0.12;
    return { distance: d.meters, time: d.reference * Math.max(0.7, abilityFactor * volumeFactor) };
  }

  /** The single fitness anchor every pace target derives from. */
  function effectiveAnchor() {
    if (draft.knowsBenchmark) {
      return { distance: benchmarkMeta().meters, time: draft.benchmarkSeconds };
    }
    return estimateFromAbility();
  }

  function calculator() {
    const anchor = effectiveAnchor();
    return makeCalculator(anchor.distance, anchor.time);
  }

  /** The Estimated Race Time band for the chosen goal — current ability only. */
  function raceTimeBand() {
    const meta = goalMeta();
    if (!meta.raceDistance) return null;
    const anchor = effectiveAnchor();
    const rows = calculator().racePredictions(draft.units);
    const match = rows.find((r) => Math.abs(r.distance - meta.raceDistance) < 1);
    if (!match || !(match.fast > 0)) return null;
    return match;
  }

  function recommendedWeeks() {
    const key = goalMeta().key;
    if (key === 'marathon') return 16;
    if (key === 'halfMarathon') return 12;
    return MIN_PLAN_WEEKS;
  }

  function mileageRange() {
    const band = abilityMeta().weeklyVolumeBand;
    const lo = Math.max(5, Math.round((band[0] / 1000) * 0.5));
    const hi = Math.round((band[1] / 1000) * 1.6);
    return [lo, Math.max(lo + 1, hi)];
  }

  function longestRunRange() {
    const band = abilityMeta().weeklyVolumeBand;
    const hi = Math.max(4, Math.round((band[1] / 1000) * 0.9));
    return [3, hi];
  }

  function bandText(level) {
    const band = level.weeklyVolumeBand;
    return `Typical volume ${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)} km per week`;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Necrest TrainingLoad on one axis, mirroring the native `load(from…)`. */
  function nearestLoad(pick) {
    let best = null;
    for (const key of Object.keys(TRAINING_LOADS)) {
      const load = TRAINING_LOADS[key];
      if (!best || Math.abs(pick(load)) < Math.abs(pick(TRAINING_LOADS[best]))) best = key;
    }
    return best;
  }

  const volumeLoadKey = () => {
    const option = VOLUME_OPTIONS.find((v) => v.key === draft.volume) || VOLUME_OPTIONS[1];
    return nearestLoad((l) => l.mileageMultiplier - option.multiplier);
  };

  const difficultyLoadKey = () => {
    const option = DIFFICULTY_OPTIONS.find((d) => d.key === draft.difficulty) || DIFFICULTY_OPTIONS[1];
    return nearestLoad((l) => l.difficultyMultiplier - option.multiplier);
  };

  /** 0 = Monday … 6 = Sunday  →  Calendar weekday, 1 = Sunday … 7 = Saturday. */
  const dayIndexToWeekday = (i) => ((i + 1) % 7) + 1;

  /* ------------------------------------------------------------ validation */

  function blockingReason(step) {
    switch (step) {
      case 'raceSelect':
        if (!goalMeta().raceDistance) return 'Pick a race distance to continue.';
        break;
      case 'raceDate': {
        const weeks = weeksToRace();
        if (weeks < 6) return 'Pick a race date at least 6 weeks away.';
        break;
      }
      case 'weeklyMileage':
        if (draft.weeklyKm <= 0) return 'Enter the mileage you run in a normal week.';
        break;
      case 'longestRun':
        if (draft.longestKm <= 0) return 'Enter your longest recent run.';
        if (draft.longestKm > draft.weeklyKm) return 'Your long run cannot be longer than your weekly mileage.';
        break;
      case 'benchmark': {
        if (!draft.knowsBenchmark) break;
        const bounds = BENCHMARK_BOUNDS[draft.benchmarkKey];
        if (draft.benchmarkSeconds < bounds[0] || draft.benchmarkSeconds > bounds[1]) {
          return `That ${benchmarkMeta().longTitle} time looks out of range — or choose “I don't know”.`;
        }
        break;
      }
      case 'longRunDay':
        if (draft.longRunDay === null || draft.longRunDay === undefined) {
          return 'Choose the day your long run lands on.';
        }
        break;
      case 'planLength':
        if (draft.planLength < MIN_PLAN_WEEKS || draft.planLength > MAX_PLAN_WEEKS) {
          return `Plans run from ${MIN_PLAN_WEEKS} to ${MAX_PLAN_WEEKS} weeks.`;
        }
        break;
      default:
        break;
    }
    return null;
  }

  const weeksToRace = () => Math.max(0, Math.round(diffDays(today, draft.raceDate) / 7));

  /* --------------------------------------------------------------- atoms */

  /**
   * The one option card in the wizard. Built on `card()` so it inherits the
   * lit-surface chrome; selection is a teal ring plus a tick, both animated
   * with opacity/transform only.
   */
  function optionCard({ icon, title, subtitle, selected, accent = 'var(--primary)', onTap, extra }) {
    const ring = el('span', {
      class: 'option-ring',
      'aria-hidden': 'true',
      style: {
        position: 'absolute',
        inset: '0',
        borderRadius: 'inherit',
        border: '1.5px solid var(--primary)',
        opacity: selected ? '1' : '0',
        transition: 'opacity var(--dur-quick) var(--ease-fade)',
        pointerEvents: 'none',
      },
    });

    const tile = el('span', {
      class: 'option-tile',
      style: {
        display: 'grid',
        placeItems: 'center',
        width: '44px',
        height: '44px',
        flex: '0 0 auto',
        borderRadius: 'var(--radius-tile)',
        background: selected
          ? 'color-mix(in srgb, var(--primary) 20%, transparent)'
          : 'var(--raised)',
        color: selected ? 'var(--primary)' : 'var(--text-muted)',
      },
    }, svgIcon(icon, 19));

    const text = el('span', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0' } });
    text.appendChild(el('span', { class: 't-body-strong', text: title }));
    if (subtitle) text.appendChild(el('span', { class: 't-caption muted', text: subtitle }));
    if (extra) text.appendChild(extra);

    const dot = el('span', {
      class: 'option-dot',
      'aria-hidden': 'true',
      style: {
        display: 'grid',
        placeItems: 'center',
        width: '22px',
        height: '22px',
        flex: '0 0 auto',
        marginTop: '2px',
        borderRadius: 'var(--radius-pill)',
        border: selected ? '2px solid var(--primary)' : '2px solid var(--stroke)',
        background: selected ? 'var(--primary)' : 'transparent',
        color: 'var(--on-primary)',
      },
    }, selected ? svgIcon('check', 12) : null);

    const node = card(
      {
        padding: 14,
        tappable: true,
        onTap: (event) => {
          onTap(event);
          // One-shot pop: the tap is acknowledged before the re-render lands.
          animate(node, [{ transform: 'scale(0.985)' }, { transform: 'scale(1)' }], { duration: 220 });
        },
        style: { '--accent': accent },
      },
      el('span', { class: 'row-top', style: { gap: '12px' } }, tile, text, dot),
      ring,
    );
    node.setAttribute('aria-pressed', selected ? 'true' : 'false');
    return node;
  }

  /** Big numeric stepper, mirroring the native `ValueStepper`. */
  function valueStepper({ title, value, min, max, step, unit, accent, onChange, format }) {
    const fmt = format || ((v) => (Math.round(v) === v ? String(Math.round(v)) : v.toFixed(1)));
    const readout = el('span', { class: 'metric', text: fmt(value) });
    readout.style.color = accent;

    const button = (iconName, delta) => el('button', {
      type: 'button',
      class: 'btn-icon',
      'aria-label': delta > 0 ? `Increase ${title}` : `Decrease ${title}`,
      disabled: delta > 0 ? value >= max : value <= min,
      onclick: () => {
        const next = clamp(Math.round((value + delta * step) / step) * step, min, max);
        if (next === value) return;
        onChange(next);
      },
    }, glyph(iconName, 18));

    const slider = el('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      'aria-label': title,
      style: { width: '100%', accentColor: accent },
      oninput: (event) => onChange(Number(event.target.value)),
    });

    return card(
      { padding: 16 },
      el('div', { class: 'stack-sm' },
        el('span', { class: 't-micro faint uppercase', text: title }),
        el('div', { class: 'row-between' },
          button('minus', -1),
          el('span', { class: 'row-sm', style: { alignItems: 'baseline' } },
            readout,
            el('span', { class: 't-caption muted', text: unit })),
          button('plus', 1)),
        slider),
    );
  }

  /** A tinted advisory box (native `NoticeBox`). */
  function notice(text, { icon = 'info', tone = 'var(--info)' } = {}) {
    return el('div', {
      class: 'row-top',
      style: {
        gap: '10px',
        padding: '14px',
        borderRadius: 'var(--radius-tile)',
        background: `color-mix(in srgb, ${tone} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
      },
    },
      el('span', { style: { color: tone, flex: '0 0 auto' } }, svgIcon(icon, 14)),
      el('span', { class: 't-caption muted', style: { flex: '1 1 auto' }, text: text }));
  }

  function metricPair(a, b) {
    return el('div', { class: 'grid-2' },
      metricTile(a),
      metricTile(b));
  }

  function metricTile({ title, value, unit, accent = 'var(--primary)', icon }) {
    return card(
      { padding: 14, class: 'stat-tile', style: { '--tile-accent': accent } },
      el('div', { class: 'stat-tile__head' }, svgIcon(icon, 12),
        el('span', { class: 'stat-tile__label', text: title })),
      el('div', { class: 'stat-tile__value-row' },
        el('span', { class: 'stat-tile__value', text: value }),
        unit ? el('span', { class: 'stat-tile__unit', text: unit }) : null),
    );
  }

  /* -------------------------------------------------------- step contents */

  function contentGoal() {
    const wrap = el('div', { class: 'stack' });
    for (const item of PLAN_TYPES) {
      wrap.appendChild(optionCard({
        icon: item.icon,
        title: item.title,
        subtitle: item.subtitle,
        accent: GOALS[item.goal].shieldColor,
        selected: draft.goalKey === item.goal,
        onTap: () => {
          draft.goalKey = item.goal;
          // Seed the distance default that the race-distance step opens on.
          draft.planLength = clamp(weeksToRace(), MIN_PLAN_WEEKS, MAX_PLAN_WEEKS);
          renderStep({ animate: false });
        },
      }));
    }
    return wrap;
  }

  function contentRaceSelect() {
    const wrap = el('div', { class: 'stack' });
    wrap.appendChild(el('p', {
      class: 't-caption muted',
      text: 'Races from 5K to 50K are supported. There are no sub-5K, mile or trail-specific plans.',
    }));

    const grid = el('div', { class: 'grid-2' });
    for (const key of ['fiveK', 'tenK', 'halfMarathon', 'marathon']) {
      const goal = GOALS[key];
      const selected = draft.goalKey === key;
      const node = card(
        {
          padding: 12,
          tappable: true,
          onTap: () => {
            draft.goalKey = key;
            renderStep({ animate: false });
          },
        },
        el('div', { class: 'stack-sm', style: { alignItems: 'center' } },
          planShield(goal.iconText, goal.shieldColor, 56),
          el('span', { class: 't-body-strong', text: goal.title }),
          el('span', { class: 't-caption faint', text: distanceCaption(goal.raceDistance) })),
      );
      if (selected) {
        node.appendChild(el('span', {
          'aria-hidden': 'true',
          style: {
            position: 'absolute',
            inset: '0',
            borderRadius: 'inherit',
            border: '1.5px solid var(--primary)',
            pointerEvents: 'none',
          },
        }));
      }
      node.setAttribute('aria-pressed', selected ? 'true' : 'false');
      grid.appendChild(node);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function distanceCaption(meters) {
    if (!meters) return '';
    if (meters === 5000) return '3.1 miles';
    if (meters === 10000) return '6.2 miles';
    if (Math.round(meters) === 21098 || Math.round(meters) === 21097) return '13.1 miles';
    if (meters === 42195) return '26.2 miles';
    return '31.1 miles';
  }

  function contentRaceDate() {
    const wrap = el('div', { class: 'stack' });
    const minDate = toISODate(addDays(today, 7 * 6));
    const maxDate = toISODate(addDays(today, 7 * 104));

    const input = el('input', {
      type: 'date',
      value: toISODate(draft.raceDate),
      min: minDate,
      max: maxDate,
      'aria-label': 'Race date',
      style: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '14px',
        borderRadius: 'var(--radius-tile)',
        border: '1px solid var(--stroke)',
        background: 'var(--raised)',
        color: 'var(--text)',
        font: 'inherit',
        fontSize: 'var(--fs-body)',
      },
      onchange: (event) => {
        const next = new Date(`${event.target.value}T00:00:00`);
        if (!Number.isNaN(next.getTime())) {
          draft.raceDate = startOfDay(next);
          renderStep({ animate: false });
        }
      },
    });

    wrap.appendChild(card({ padding: 12 }, input));
    wrap.appendChild(metricPair(
      { title: 'WEEKS TO RACE', value: String(weeksToRace()), unit: 'wks', icon: 'calendar' },
      { title: 'LONGEST ALLOWED', value: String(MAX_PLAN_WEEKS), unit: 'wks', accent: 'var(--text-muted)', icon: 'lock' },
    ));
    wrap.appendChild(notice(
      'Runna caps plans at 26 weeks. Half marathon plans need at least 12 weeks and marathon plans at least 16 to build safely — you can override this on the plan-length step.',
      { icon: 'info' },
    ));
    return wrap;
  }

  function contentAbility() {
    const wrap = el('div', { class: 'stack' });
    for (const key of ABILITY_ORDER) {
      const level = ABILITIES[key];
      const range = RUNS_PER_WEEK_RANGE[key];
      wrap.appendChild(optionCard({
        icon: 'run',
        title: level.title,
        subtitle: level.blurb,
        selected: draft.abilityKey === key,
        extra: el('span', { class: 'row-wrap', style: { marginTop: '4px' } },
          chip(`${range[0]}–${range[1]} runs/wk`, { color: 'var(--primary)' }),
          el('span', { class: 't-caption faint', text: bandText(level) })),
        onTap: () => selectAbility(key),
      }));
    }
    return wrap;
  }

  function selectAbility(key) {
    draft.abilityKey = key;
    // Seed mileage and long run from the new level's band, as Runna does.
    const band = ABILITIES[key].weeklyVolumeBand;
    const midpointKm = (band[0] + band[1]) / 2000;
    draft.weeklyKm = Math.round(midpointKm * 10) / 10;
    draft.longestKm = Math.min(draft.longestKm, Math.max(5, Math.round(draft.weeklyKm * 0.4 * 10) / 10));
    draft.runsPerWeek = clamp(draft.runsPerWeek, minRuns(), maxRuns());
    if (!draft.benchmarkTouched) draft.benchmarkSeconds = estimateFromAbility().time;
    renderStep({ animate: false });
  }

  function contentWeeklyMileage() {
    const wrap = el('div', { class: 'stack' });
    const range = mileageRange();
    const band = abilityMeta().weeklyVolumeBand;

    wrap.appendChild(valueStepper({
      title: 'Current weekly mileage',
      value: draft.weeklyKm,
      min: range[0],
      max: range[1],
      step: 1,
      unit: UNITS[draft.units].suffix,
      accent: 'var(--primary)',
      onChange: (v) => {
        draft.weeklyKm = v;
        if (!draft.benchmarkTouched) draft.benchmarkSeconds = estimateFromAbility().time;
        renderStep({ animate: false });
      },
    }));

    wrap.appendChild(metricPair(
      {
        title: 'YOUR RANGE',
        value: `${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)}`,
        unit: UNITS[draft.units].suffix,
        accent: 'var(--pace-easy)',
        icon: 'chart',
      },
      {
        title: 'LONG RUN',
        value: formatDistance(draft.longestKm * 1000, draft.units),
        unit: UNITS[draft.units].suffix,
        accent: 'var(--pace-steady)',
        icon: 'route',
      },
    ));

    wrap.appendChild(notice(
      `Typical ${abilityMeta().title} runners sit around ${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)} km a week. Be honest here — everything in your plan scales from this number.`,
      { icon: 'sparkle', tone: 'var(--gold)' },
    ));
    return wrap;
  }

  function contentLongestRun() {
    const wrap = el('div', { class: 'stack' });
    const range = longestRunRange();
    const max = Math.max(range[1], Math.ceil(draft.longestKm));

    wrap.appendChild(valueStepper({
      title: 'Current longest run',
      value: draft.longestKm,
      min: range[0],
      max,
      step: 1,
      unit: UNITS[draft.units].suffix,
      accent: 'var(--violet)',
      onChange: (v) => {
        draft.longestKm = v;
        renderStep({ animate: false });
      },
    }));

    wrap.appendChild(notice(
      'Your long run cannot exceed your weekly mileage. If it does, Runna will raise your weekly mileage to match.',
      { icon: 'alert', tone: 'var(--warning)' },
    ));

    if (draft.longestKm >= draft.weeklyKm) {
      wrap.appendChild(el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-block',
        text: `Set weekly mileage to ${formatDistance(draft.longestKm * 1000, draft.units)} ${UNITS[draft.units].suffix}`,
        onclick: () => {
          draft.weeklyKm = Math.min(draft.longestKm, mileageRange()[1]);
          renderStep({ animate: false });
        },
      }));
    }
    return wrap;
  }

  function contentBenchmark() {
    const wrap = el('div', { class: 'stack' });
    const meta = benchmarkMeta();

    // Which recent race is this?
    const picker = el('div', { class: 'stack-sm' },
      el('span', { class: 't-body-strong', text: 'Which recent race is this?' }));
    picker.appendChild(el('div', { class: 'segmented', style: { '--seg-count': '3', '--seg-index': String(BENCHMARK_DISTANCES.findIndex((d) => d.key === draft.benchmarkKey)) } },
      ...BENCHMARK_DISTANCES.map((d, i) => el('button', {
        type: 'button',
        class: ['segmented__item', d.key === draft.benchmarkKey && 'is-active'],
        text: d.title,
        'aria-selected': d.key === draft.benchmarkKey ? 'true' : 'false',
        onclick: () => {
          draft.benchmarkKey = d.key;
          if (!draft.benchmarkTouched) draft.benchmarkSeconds = BENCHMARK_DEFAULTS[d.key];
          renderStep({ animate: false });
        },
        dataset: { index: i },
      }))));
    wrap.appendChild(picker);

    // Hours / minutes / seconds.
    const total = Math.round(draft.benchmarkSeconds);
    const parts = [
      { label: 'h', value: Math.floor(total / 3600), max: 9 },
      { label: 'm', value: Math.floor((total % 3600) / 60), max: 59 },
      { label: 's', value: total % 60, max: 59 },
    ];
    const fieldRow = el('div', { class: 'grid-3' });
    for (const part of parts) {
      fieldRow.appendChild(el('label', { class: 'stack-sm', style: { alignItems: 'center' } },
        el('input', {
          type: 'number',
          inputmode: 'numeric',
          min: '0',
          max: String(part.max),
          value: String(part.value),
          'aria-label': `${meta.longTitle} ${part.label}`,
          style: {
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px',
            textAlign: 'center',
            borderRadius: 'var(--radius-tile)',
            border: '1px solid var(--stroke)',
            background: 'var(--raised)',
            color: 'var(--text)',
            font: 'inherit',
            fontSize: 'var(--fs-metric-sm)',
          },
          oninput: (event) => {
            const v = clamp(Number(event.target.value) || 0, 0, part.max);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const next = part.label === 'h' ? v * 3600 + m * 60 + s
              : part.label === 'm' ? h * 3600 + v * 60 + s
                : h * 3600 + m * 60 + v;
            draft.benchmarkSeconds = next;
            draft.benchmarkTouched = true;
            updateBenchmarkPanel();
          },
        }),
        el('span', { class: 't-micro faint uppercase', text: part.label })));
    }

    const timeCard = card({ padding: 14 },
      el('div', { class: 'stack-sm' },
        el('span', { class: 't-body-strong', text: `Your current ${meta.longTitle} time` }),
        fieldRow,
        draft.knowsBenchmark ? null : el('span', {
          class: 't-caption',
          style: { color: 'var(--warning)' },
          text: 'We will estimate from your ability level and weekly mileage instead — you can change this later under Manage Plan.',
        })));
    wrap.appendChild(timeCard);

    // The "I don't know" affordance.
    wrap.appendChild(optionCard({
      icon: draft.knowsBenchmark ? 'alert' : 'check-circle',
      title: "I don't know my race time",
      subtitle: draft.knowsBenchmark
        ? 'Estimate it from my ability level instead.'
        : 'Estimating from your ability level and weekly mileage.',
      selected: !draft.knowsBenchmark,
      onTap: () => {
        draft.knowsBenchmark = !draft.knowsBenchmark;
        if (!draft.knowsBenchmark) draft.benchmarkSeconds = estimateFromAbility().time;
        renderStep({ animate: false });
      },
    }));

    wrap.appendChild(benchmarkPanel());
    return wrap;
  }

  function benchmarkPanel() {
    const panel = el('div', { class: 'stack-sm', id: 'benchmark-panel' });
    const anchor = effectiveAnchor();
    const band = raceTimeBand();

    panel.appendChild(el('div', { class: 'row-between' },
      el('span', { class: 't-micro faint uppercase', text: 'ESTIMATED RACE TIME' }),
      chip('Current ability', { color: 'var(--primary)', icon: 'chart' })));

    if (band) {
      panel.appendChild(el('div', { class: 'row-sm', style: { alignItems: 'baseline' } },
        el('span', { class: 'metric', style: { color: 'var(--primary)' }, text: formatDuration(band.fast) }),
        el('span', { class: 't-caption faint', text: '–' }),
        el('span', { class: 'metric', style: { color: 'var(--primary)' }, text: formatDuration(band.slow) })));
      panel.appendChild(el('span', {
        class: 't-caption muted',
        text: `Predicted ${goalMeta().title} finish from this fitness anchor, before any training.`,
      }));
    }

    panel.appendChild(el('div', { class: 'row-wrap', style: { marginTop: '4px' } },
      chip(`VDOT ${raceMath.vdot(anchor.distance, anchor.time).toFixed(1)}`, { color: 'var(--pace-tempo)' }),
      chip(formatPaceShort(anchor.time / (anchor.distance / 1000), draft.units), { color: 'var(--pace-steady)' })));

    panel.appendChild(el('span', {
      class: 't-caption faint',
      text: 'This is your current ability, not a goal time. Runna gives you no way to enter the time you want to run.',
    }));

    return card({ padding: 14, class: 'card--raised' }, panel);
  }

  /** Re-render only the Estimated Race Time panel — the fields keep focus. */
  function updateBenchmarkPanel() {
    if (!stepHost) return;
    const existing = stepHost.querySelector('#benchmark-panel');
    if (!existing || !existing.parentElement) return;
    existing.parentElement.replaceChild(benchmarkPanel(), existing);
  }

  function contentRunsPerWeek() {
    const wrap = el('div', { class: 'stack' });
    const lo = minRuns();
    const hi = maxRuns();

    const button = (iconName, delta) => el('button', {
      type: 'button',
      class: 'btn-icon',
      'aria-label': delta > 0 ? 'More runs per week' : 'Fewer runs per week',
      disabled: delta > 0 ? draft.runsPerWeek >= hi : draft.runsPerWeek <= lo,
      onclick: () => {
        draft.runsPerWeek = clamp(draft.runsPerWeek + delta, lo, hi);
        renderStep({ animate: false });
      },
    }, glyph(iconName, 18));

    wrap.appendChild(card({ padding: 16 },
      el('div', { class: 'stack-sm', style: { alignItems: 'center' } },
        el('span', { class: 't-micro faint uppercase', text: 'RUNS PER WEEK' }),
        el('div', { class: 'row', style: { width: '100%', justifyContent: 'space-between' } },
          button('minus', -1),
          el('span', { class: 'metric-lg', style: { color: 'var(--primary)' }, text: String(draft.runsPerWeek) }),
          button('plus', 1)),
        chip(`${abilityMeta().title} · ${lo}–${hi} runs a week`, { color: 'var(--primary)' }))));

    wrap.appendChild(notice(
      `${abilityMeta().title} runners can hold ${lo} to ${hi} runs a week. The cap comes from your ability level, not from the plan length.`,
      { icon: 'info' },
    ));

    const preview = el('div', { class: 'row-wrap' });
    for (let i = 0; i < hi; i += 1) {
      preview.appendChild(chip(String(i + 1), {
        color: i < draft.runsPerWeek ? 'var(--primary)' : 'var(--text-faint)',
        filled: i < draft.runsPerWeek,
      }));
    }
    wrap.appendChild(preview);
    return wrap;
  }

  function contentLongRunDay() {
    const wrap = el('div', { class: 'stack' });
    const grid = el('div', { class: 'stack-sm' });
    for (let day = 0; day < 7; day += 1) {
      const selected = draft.longRunDay === day;
      grid.appendChild(optionCard({
        icon: 'calendar',
        title: WEEKDAY_LONG[day],
        subtitle: LONG_RUN_HINTS[day] || 'Midweek long run — keep the day either side easy.',
        selected,
        accent: 'var(--violet)',
        extra: selected ? el('span', { class: 'row-wrap', style: { marginTop: '4px' } },
          chip('Long run', { color: 'var(--violet)', icon: 'route', filled: true })) : null,
        onTap: () => {
          draft.longRunDay = day;
          renderStep({ animate: false });
        },
      }));
    }
    wrap.appendChild(grid);
    wrap.appendChild(notice(
      'The rest of your week reflows around this day — quality sessions are spaced away from it so your long run is never compromised.',
      { icon: 'refresh' },
    ));
    return wrap;
  }

  function contentPreferences() {
    const wrap = el('div', { class: 'stack-lg' });

    const axis = (title, detail, options, current, onPick) => {
      const segments = el('div', { class: 'segmented', style: { '--seg-count': String(options.length), '--seg-index': String(options.findIndex((o) => o.key === current)) } },
        ...options.map((option, i) => el('button', {
          type: 'button',
          class: ['segmented__item', option.key === current && 'is-active'],
          text: option.title,
          'aria-selected': option.key === current ? 'true' : 'false',
          dataset: { index: i },
          onclick: () => onPick(option.key),
        })));
      const chosen = options.find((o) => o.key === current) || options[1];
      return card({ padding: 14 },
        el('div', { class: 'stack-sm' },
          el('span', { class: 't-body-strong', text: title }),
          el('span', { class: 't-caption faint', text: detail }),
          segments,
          el('span', { class: 't-caption muted', text: chosen.blurb })));
    };

    wrap.appendChild(axis('Training Volume', 'How much your weekly mileage builds.', VOLUME_OPTIONS, draft.volume, (key) => {
      draft.volume = key;
      renderStep({ animate: false });
    }));

    wrap.appendChild(axis('Difficulty', 'How hard the hard sessions bite.', DIFFICULTY_OPTIONS, draft.difficulty, (key) => {
      draft.difficulty = key;
      renderStep({ animate: false });
    }));

    const volumeTitle = (VOLUME_OPTIONS.find((v) => v.key === draft.volume) || VOLUME_OPTIONS[1]).title;
    const difficultyTitle = (DIFFICULTY_OPTIONS.find((d) => d.key === draft.difficulty) || DIFFICULTY_OPTIONS[1]).title;
    wrap.appendChild(metricPair(
      { title: 'VOLUME', value: volumeTitle, accent: 'var(--primary)', icon: 'chart' },
      { title: 'DIFFICULTY', value: difficultyTitle, accent: 'var(--pace-tempo)', icon: 'flame' },
    ));

    wrap.appendChild(notice(
      'These are independent. You can build volume fast while keeping the hard sessions comfortable, or hold mileage steady and make every session challenging.',
      { icon: 'info' },
    ));
    return wrap;
  }

  function contentUnits() {
    const wrap = el('div', { class: 'stack' });
    wrap.appendChild(optionCard({
      icon: 'target',
      title: 'Kilometres',
      subtitle: 'Paces shown as min/km, distances in km.',
      selected: draft.units === 'kilometers',
      onTap: () => { draft.units = 'kilometers'; renderStep({ animate: false }); },
    }));
    wrap.appendChild(optionCard({
      icon: 'target',
      title: 'Miles',
      subtitle: 'Paces shown as min/mi, distances in miles.',
      selected: draft.units === 'miles',
      onTap: () => { draft.units = 'miles'; renderStep({ animate: false }); },
    }));

    const calc = calculator();
    const easy = calc.target('easy');
    const tempo = calc.target('tempo');
    wrap.appendChild(el('div', { class: 'grid-3' },
      metricTile({
        title: 'EASY PACE',
        value: easy ? formatPaceShort(easy.midSecondsPerKm, draft.units) : '—',
        unit: `/${UNITS[draft.units].suffix}`,
        accent: 'var(--pace-easy)',
        icon: 'run',
      }),
      metricTile({
        title: 'TEMPO PACE',
        value: tempo ? formatPaceShort(tempo.midSecondsPerKm, draft.units) : '—',
        unit: `/${UNITS[draft.units].suffix}`,
        accent: 'var(--pace-tempo)',
        icon: 'timer',
      }),
      metricTile({
        title: 'LONG RUN',
        value: formatDistance(Math.max(draft.longestKm, 10) * 1000, draft.units),
        unit: UNITS[draft.units].suffix,
        accent: 'var(--violet)',
        icon: 'route',
      })));

    wrap.appendChild(notice(
      'Switching units does not regenerate the plan — it only changes how targets are displayed and read out in audio cues.',
      { icon: 'info' },
    ));
    return wrap;
  }

  function contentPlanLength() {
    const wrap = el('div', { class: 'stack' });
    const recommended = recommendedWeeks();

    wrap.appendChild(valueStepper({
      title: 'Plan length',
      value: draft.planLength,
      min: MIN_PLAN_WEEKS,
      max: MAX_PLAN_WEEKS,
      step: 1,
      unit: 'wks',
      accent: 'var(--primary)',
      onChange: (v) => { draft.planLength = v; renderStep({ animate: false }); },
    }));

    wrap.appendChild(metricPair(
      { title: 'WEEKS', value: String(draft.planLength), unit: 'wks', icon: 'calendar' },
      { title: 'RECOMMENDED', value: String(recommended), unit: 'wks min', accent: 'var(--gold)', icon: 'medal' },
    ));

    if (isRaceGoal()) {
      const toRace = weeksToRace();
      const exact = toRace === draft.planLength;
      const delta = Math.abs(toRace - draft.planLength);
      wrap.appendChild(notice(
        exact
          ? `Your plan finishes exactly on race week (${formatDateShort(draft.raceDate)}).`
          : `Your race is ${toRace} weeks away, so this plan will finish ${delta} week${delta === 1 ? '' : 's'} ${toRace > draft.planLength ? 'before' : 'after'} race day.`,
        { icon: exact ? 'check-circle' : 'refresh', tone: exact ? 'var(--success)' : 'var(--warning)' },
      ));
    }

    const rows = [
      ['Half Marathon', '12 weeks minimum', goalMeta().key === 'halfMarathon' && draft.planLength >= 12],
      ['Marathon', '16 weeks minimum', goalMeta().key === 'marathon' && draft.planLength >= 16],
      ['Hard cap', '26 weeks, all plans', draft.planLength <= MAX_PLAN_WEEKS],
    ];
    wrap.appendChild(card({ padding: 14 },
      el('div', { class: 'stack-sm' },
        el('span', { class: 't-micro faint', text: 'RECOMMENDED MINIMUMS' }),
        ...rows.map(([label, value, met]) => el('div', { class: 'row-between' },
          el('span', { class: 't-body-sm muted', text: label }),
          el('span', {
            class: 't-body-strong',
            style: { color: met ? 'var(--primary)' : 'var(--text-muted)' },
            text: value,
          }))))));
    return wrap;
  }

  function formatDateShort(date) {
    const d = new Date(date);
    return `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
  }

  function contentSummary() {
    const wrap = el('div', { class: 'stack-lg' });
    const goal = goalMeta();
    const band = raceTimeBand();
    const volumeTitle = (VOLUME_OPTIONS.find((v) => v.key === draft.volume) || VOLUME_OPTIONS[1]).title;
    const difficultyTitle = (DIFFICULTY_OPTIONS.find((d) => d.key === draft.difficulty) || DIFFICULTY_OPTIONS[1]).title;

    wrap.appendChild(el('div', { class: 'stack-sm', style: { alignItems: 'center', padding: '6px 0' } },
      planShield(goal.iconText, goal.shieldColor, 86),
      el('span', { class: 't-title', text: goal.title }),
      el('span', {
        class: 't-caption muted',
        text: `${abilityMeta().title} · ${draft.planLength} weeks · ${draft.runsPerWeek} runs/week`,
      }),
      el('span', { class: 'row-wrap', style: { justifyContent: 'center' } },
        chip(volumeTitle, { color: 'var(--primary)', icon: 'chart' }),
        chip(difficultyTitle, { color: 'var(--pace-tempo)', icon: 'flame' }))));

    const anchor = effectiveAnchor();
    const bandSummary = band
      ? `${formatDuration(band.fast)} – ${formatDuration(band.slow)}`
      : '—';

    const rows = [
      ['Goal', goal.title, 'flag'],
      ['Ability', abilityMeta().title, 'run'],
      ['Estimated race time', bandSummary, 'timer'],
      ['Weekly mileage', `${formatDistance(draft.weeklyKm * 1000, draft.units)} ${UNITS[draft.units].suffix}`, 'chart'],
      ['Longest run', `${formatDistance(draft.longestKm * 1000, draft.units)} ${UNITS[draft.units].suffix}`, 'route'],
      ['Runs per week', String(draft.runsPerWeek), 'calendar'],
      ['Long run', WEEKDAY_LONG[draft.longRunDay], 'route'],
      ['Volume / Difficulty', `${volumeTitle} · ${difficultyTitle}`, 'target'],
      ['Units', UNITS[draft.units].title, 'target'],
      ['Length', `${draft.planLength} weeks`, 'calendar'],
      ['Anchor', `${formatPaceShort(anchor.time / (anchor.distance / 1000), draft.units)} /${UNITS[draft.units].suffix}`, 'timer'],
    ];

    const list = el('div', { class: 'stack-sm' });
    rows.forEach(([label, value, icon], i) => {
      if (i > 0) list.appendChild(el('div', { class: 'divider' }));
      list.appendChild(el('div', { class: 'row', style: { gap: '12px', padding: '10px 4px' } },
        el('span', { style: { color: 'var(--primary)', flex: '0 0 auto' } }, svgIcon(icon, 15)),
        el('span', { class: 't-body-sm muted', style: { flex: '1 1 auto' }, text: label }),
        el('span', { class: 't-body-strong nowrap', text: value })));
    });
    wrap.appendChild(card({ padding: 8 }, list));

    if (band) {
      wrap.appendChild(card({ padding: 14 },
        el('div', { class: 'stack-sm' },
          el('span', { class: 't-micro faint uppercase', text: 'ESTIMATED RACE TIME' }),
          el('div', { class: 'row-sm', style: { alignItems: 'baseline' } },
            el('span', { class: 'metric', style: { color: 'var(--primary)' }, text: formatDuration(band.fast) }),
            el('span', { class: 't-caption faint', text: '–' }),
            el('span', { class: 'metric', style: { color: 'var(--primary)' }, text: formatDuration(band.slow) })),
          el('span', {
            class: 't-caption muted',
            text: `Your predicted ${goal.title} finish from current ability. Not a goal time.`,
          }))));
    }

    wrap.appendChild(notice(
      "Runna's coaching principles build your weeks from one fitness anchor and your weekly availability. Plans are distance-based — there is no time-based mode.",
      { icon: 'sparkle' },
    ));
    return wrap;
  }

  const CONTENT = {
    goal: contentGoal,
    raceSelect: contentRaceSelect,
    raceDate: contentRaceDate,
    ability: contentAbility,
    weeklyMileage: contentWeeklyMileage,
    longestRun: contentLongestRun,
    benchmark: contentBenchmark,
    runsPerWeek: contentRunsPerWeek,
    longRunDay: contentLongRunDay,
    preferences: contentPreferences,
    units: contentUnits,
    planLength: contentPlanLength,
    summary: contentSummary,
  };

  /* ------------------------------------------------------------- shell DOM */

  const progressTitle = el('span', { class: 't-micro faint uppercase' });
  const progressCount = el('span', { class: 't-micro muted tabular' });
  const progressMeter = meter({ value: 0, max: 1, height: 6, animate: false });

  const skipButton = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-xs',
    onclick: () => seedSampleData(),
  }, svgIcon('sparkle', 13), el('span', { text: 'Skip / use sample data' }));

  const header = el('div', { class: 'stack-sm', style: { padding: '4px 0 10px' } },
    el('div', { class: 'row-between' }, progressTitle, skipButton),
    progressMeter);

  stepHost = el('div', { class: 'stack-lg' });

  const scroller = el('div', {
    class: 'scroll-y',
    style: {
      flex: '1 1 auto',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      overscrollBehaviorY: 'contain',
      paddingBottom: '32px',
      minHeight: '0',
    },
  }, stepHost);

  const backButton = el('button', {
    type: 'button',
    class: 'btn btn-ghost',
    style: { flex: '0 0 auto', minWidth: '104px' },
    onclick: () => goBack(),
  }, svgIcon('chevron-left', 18), el('span', { text: 'Back' }));

  const nextButton = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    style: { flex: '1 1 auto' },
    onclick: () => goNext(),
  });

  const blockingNode = el('div', { class: 'row-sm', style: { color: 'var(--warning)', minHeight: '0' } });

  const footer = el('div', {
    class: 'wizard__footer',
    style: {
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      paddingTop: '12px',
      paddingBottom: '6px',
      borderTop: '1px solid var(--stroke-soft)',
    },
  }, blockingNode, el('div', { class: 'row', style: { gap: '12px' } }, backButton, nextButton));

  const shell = el('div', {
    class: 'screen-body',
    style: { display: 'flex', flexDirection: 'column', minHeight: '100%', boxSizing: 'border-box' },
  }, header, scroller, footer);

  /* ------------------------------------------------------------- rendering */

  function renderStep({ animate: shouldAnimate = true } = {}) {
    const steps = stepsInUse();
    index = clamp(index, 0, steps.length - 1);
    const step = steps[index];

    const title = STEP_TITLES[step] || '';
    const subtitle = STEP_SUBTITLES[step] || '';

    progressTitle.textContent = title.toUpperCase();
    progressCount.textContent = `${index + 1}/${steps.length}`;
    progressMeter.setProgress(index + 1, steps.length);

    const section = el('div', { class: 'stack' },
      el('div', { class: 'stack-sm' },
        el('span', { class: 't-micro', style: { color: 'var(--primary)' }, text: `STEP ${index + 1} OF ${steps.length}` }),
        el('h1', { class: 't-display', text: title }),
        el('p', { class: 't-caption muted', style: { margin: '0' }, text: subtitle })),
      (CONTENT[step] || (() => el('div')))());

    stepHost.textContent = '';
    stepHost.appendChild(section);

    if (shouldAnimate) {
      staggerIn(section);
      animate(section, [
        { opacity: '0', transform: `translateX(${direction * 26}px)` },
        { opacity: '1', transform: 'translateX(0)' },
      ], { duration: motion.smooth });
    } else {
      for (const child of section.children) child.style.animation = 'none';
    }

    // Footer state.
    const blocked = blockingReason(step);
    blockingNode.textContent = '';
    if (blocked) {
      blockingNode.appendChild(svgIcon('alert', 13));
      blockingNode.appendChild(el('span', { class: 't-caption', text: blocked }));
    }
    blockingNode.style.opacity = blocked ? '1' : '0';
    nextButton.textContent = step === 'summary' ? 'Build my plan' : 'Next';
    nextButton.disabled = !!blocked;
    backButton.disabled = index === 0;
    backButton.style.opacity = index === 0 ? '0.4' : '1';
  }

  function goNext() {
    const steps = stepsInUse();
    const step = steps[index];
    if (blockingReason(step)) return;
    hapticCommit();

    if (step === 'summary') {
      buildPlan();
      return;
    }
    // Keep dependent answers coherent before revealing the next step.
    if (step === 'raceDate') {
      draft.planLength = clamp(weeksToRace(), MIN_PLAN_WEEKS, MAX_PLAN_WEEKS);
    }
    direction = 1;
    index = Math.min(index + 1, steps.length - 1);
    renderStep({ animate: true });
  }

  function goBack() {
    if (index === 0) return;
    direction = -1;
    index -= 1;
    renderStep({ animate: true });
  }

  /* ----------------------------------------------------------- plan build */

  function buildRequest() {
    const anchor = effectiveAnchor();
    return {
      goal: draft.goalKey,
      ability: draft.abilityKey,
      weeks: clamp(draft.planLength, MIN_PLAN_WEEKS, MAX_PLAN_WEEKS),
      startDate: today,
      raceDate: isRaceGoal() ? draft.raceDate : null,
      goalTimeSeconds: null, // Runna never takes a goal time
      recentRaceDistance: anchor.distance,
      recentRaceTime: anchor.time,
      baseWeeklyMeters: draft.weeklyKm * 1000,
      longRunMeters: draft.longestKm * 1000,
      daysPerWeek: draft.runsPerWeek,
      longRunWeekday: dayIndexToWeekday(draft.longRunDay),
      wantsStrength: true,
      trainingLoad: volumeLoadKey(),
      difficulty: difficultyLoadKey(),
      units: draft.units,
    };
  }

  function applyAthlete(request) {
    state.athlete = {
      ...state.athlete,
      units: request.units,
      ability: request.ability,
      goal: request.goal,
      raceDate: request.raceDate ? toISODate(request.raceDate) : null,
      currentTimeSeconds: request.recentRaceTime,
      currentRaceDistanceMeters: request.recentRaceDistance,
      runsPerWeek: request.daysPerWeek,
      longRunDay: draft.longRunDay,
      volume: draft.volume,
      difficulty: draft.difficulty,
    };
  }

  function buildPlan() {
    const request = buildRequest();
    let plan;
    try {
      plan = generatePlan(request);
    } catch (error) {
      // A failed generation must not strand the athlete on the summary step.
      toastText('Could not build the plan — please try again.', 'danger');
      return;
    }
    applyAthlete(request);
    state.plan = plan;
    state.completedSessionIds = [];
    saveState(state);
    if (typeof navigate === 'function') navigate('today');
  }

  /* ------------------------------------------------- sample-data shortcut */

  function plausibleDuration(session) {
    const low = Number(session.targetPaceLowSecondsPerKm) || 0;
    const high = Number(session.targetPaceHighSecondsPerKm) || 0;
    const mid = low > 0 && high > 0 ? (low + high) / 2 : 330;
    const meters = Number(session.distanceMeters) || 0;
    return Math.round((meters / 1000) * mid);
  }

  /**
   * Skip / use sample data — a 16-week marathon block anchored on a 10K of
   * 47:00, started five weeks ago, with every past run already logged so the
   * Progress and Today screens have real history on first paint.
   */
  function seedSampleData() {
    const planStart = addDays(weekStart(today), -35); // five weeks back
    const raceDate = addDays(planStart, 16 * 7);
    const request = {
      goal: 'marathon',
      ability: 'intermediate',
      weeks: 16,
      startDate: planStart,
      raceDate,
      goalTimeSeconds: null,
      recentRaceDistance: 10000,
      recentRaceTime: 47 * 60,
      baseWeeklyMeters: 35000,
      longRunMeters: 16000,
      daysPerWeek: 5,
      longRunWeekday: 1, // Sunday
      wantsStrength: true,
      trainingLoad: 'standard',
      difficulty: 'standard',
      units: 'kilometers',
    };

    let plan;
    try {
      plan = generatePlan(request);
    } catch (error) {
      toastText('Could not build the sample plan.', 'danger');
      return;
    }

    state.plan = plan;
    state.runs = [];
    state.completedSessionIds = [];
    applyAthlete(request);

    for (const week of plan.weeks || []) {
      for (const session of week.sessions || []) {
        const date = startOfDay(session.date);
        if (!date || date >= today) continue;
        const type = String(session.runType || '');
        if (type === 'rest' || type === 'strength' || type === 'mobility') continue;

        const id = sessionId(session);
        const distanceMeters = Number(session.distanceMeters) || 0;
        session.isCompleted = true;
        session.completed = true;

        if (distanceMeters > 0) {
          addRun(state, {
            date: session.date,
            type,
            title: session.runTitle || '',
            distanceMeters,
            durationSeconds: plausibleDuration(session),
            effort: 5,
            sessionId: id,
            source: 'sample',
          });
        }
        markSessionComplete(state, id);
      }
    }

    saveState(state);
    if (typeof navigate === 'function') navigate('today');
  }

  function toastText(message, tone) {
    if (typeof toast === 'function') toast(message, { tone, icon: 'alert' });
  }

  /* ------------------------------------------------------------------ boot */

  root.textContent = '';
  root.appendChild(shell);

  // Seed mileage from the starting ability level, as the native flow does.
  selectAbilityInitial();

  function selectAbilityInitial() {
    const band = ABILITIES[draft.abilityKey].weeklyVolumeBand;
    const midpointKm = (band[0] + band[1]) / 2000;
    draft.weeklyKm = Math.round(midpointKm * 10) / 10;
    draft.longestKm = Math.max(5, Math.round(draft.weeklyKm * 0.4 * 10) / 10);
    draft.runsPerWeek = clamp(draft.runsPerWeek, minRuns(), maxRuns());
    draft.planLength = clamp(weeksToRace(), MIN_PLAN_WEEKS, MAX_PLAN_WEEKS);
  }

  renderStep({ animate: true });
}
