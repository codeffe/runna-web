/**
 * screens/plan.js — Plan tab.
 *
 * Mirrors app/Runna/Features/Plan/PlanTabView.swift: header card with the plan
 * shield, name, ability, week counter, days-to-race and overall progress ring;
 * a week card per week with a phase chip, completion meter and session list;
 * the planned-mileage bar chart; the pace-zone table; and the estimated race
 * times.
 *
 * The two facts this screen exists to state plainly, and repeats in its own
 * words on both the zones and the race-time tables: every pace here comes from
 * ONE Estimated Race Time that describes *current ability*, and it is never a
 * goal time.
 *
 * Contract: `export default function screen(root, state, navigate)`.
 */

import {
  GOALS,
  RUN_TYPES,
  PACE_ZONES,
  PLAN_PHASES,
  TRAINING_ORDER,
} from '../engine/enums.js';
import * as paceEngine from '../engine/pace.js';
import * as raceMath from '../engine/raceMath.js';
import {
  isSessionCompleted,
  planProgress,
  currentWeekNumber,
  daysToRace,
  weekFor,
  startOfDay,
  addDays,
} from '../domain/store.js';
import {
  formatDistance,
  formatDuration,
  formatPaceShort,
  formatDateRange,
  formatRaceDistance,
} from '../domain/format.js';
import {
  el,
  card,
  chip,
  svgIcon,
  ring,
  meter,
  sheet,
  stepRow,
  emptyState,
  sessionRow,
  sectionHeader,
  sessionAccent,
  sessionIcon,
  sessionTypeLabel,
  planShield,
} from '../ui/components.js';
import { motion, countUp, staggerIn, animate } from '../ui/motion.js';

/* ----------------------------------------------------------------- helpers */

function unitsOf(state) {
  return state && state.athlete && state.athlete.units === 'miles' ? 'miles' : 'kilometers';
}

function unitSuffix(units) {
  return units === 'miles' ? 'mi' : 'km';
}

function typeTitle(runType) {
  const meta = RUN_TYPES[runType];
  return meta ? meta.title : sessionTypeLabel(runType);
}

function zoneOf(value) {
  const key = typeof value === 'string' ? value : (value && value.key) || 'easy';
  return PACE_ZONES[key] || PACE_ZONES.easy;
}

function goalMeta(plan) {
  return (plan && GOALS[plan.goal]) || GOALS.tenK;
}

function phaseMeta(key) {
  return PLAN_PHASES[key] || PLAN_PHASES.base;
}

function isCurrentWeek(week, state) {
  return Number(week.weekIndex) === currentWeekNumber(state);
}

function weekSessions(week) {
  const list = Array.isArray(week.sessions) ? week.sessions.slice() : [];
  // The engine pushes training days first and strength days last; the week card
  // reads Monday → Sunday, exactly like `PlanWeek.orderedSessions`.
  list.sort((a, b) => (Number(a.dayIndex) || 0) - (Number(b.dayIndex) || 0));
  return list;
}

function weekPlannedMeters(week) {
  return weekSessions(week).reduce((sum, s) => sum + (Number(s.distanceMeters) || 0), 0);
}

function weekCompletedMeters(state, week) {
  return weekSessions(week)
    .filter((s) => isSessionCompleted(state, s))
    .reduce((sum, s) => sum + (Number(s.distanceMeters) || 0), 0);
}

/** Weeks the plan says it has, falling back to the array itself. */
function orderedWeeks(plan) {
  const weeks = Array.isArray(plan.weeks) ? plan.weeks.slice() : [];
  weeks.sort((a, b) => (Number(a.weekIndex) || 0) - (Number(b.weekIndex) || 0));
  return weeks;
}

/* ------------------------------------------------------------ pace engine */

/**
 * The brief calls the factory `makePaceCalculator`; the engine exports
 * `paceCalculatorFromRace` and the `PaceCalculator` class. Accept any of them.
 */
function makeCalculator({ recentDistance, recentTime, goalRaceDistance = null, goalRaceTime = null }) {
  const args = { recentDistance, recentTime, goalRaceDistance, goalRaceTime };
  if (typeof paceEngine.makePaceCalculator === 'function') return paceEngine.makePaceCalculator(args);
  if (typeof paceEngine.paceCalculatorFromRace === 'function') return paceEngine.paceCalculatorFromRace(args);
  return new paceEngine.PaceCalculator({
    vdot: raceMath.vdot(recentDistance, recentTime),
    goalRaceDistance,
    goalRaceTime,
  });
}

const FALLBACK_ANCHOR = { distance: 10000, time: 47 * 60 };

/** The single fitness anchor for this screen, plus a plain-English source. */
function resolveAnchor(state) {
  const plan = state.plan || {};
  const athlete = state.athlete || {};
  const goalRaceDistance = Number(plan.raceDistance) || null;
  const goalRaceTime = Number(plan.goalTimeSeconds) || null;

  const distance = Number(athlete.currentRaceDistanceMeters) || 0;
  const time = Number(athlete.currentTimeSeconds) || 0;

  if (distance > 0 && time > 0) {
    return {
      calculator: makeCalculator({ recentDistance: distance, recentTime: time, goalRaceDistance, goalRaceTime }),
      source: `your most recent personal best — ${formatRaceDistance(distance, 'kilometers')} in ${formatDuration(time)}`,
    };
  }

  if (Number(plan.vdot) > 0) {
    return {
      calculator: new paceEngine.PaceCalculator({ vdot: plan.vdot, goalRaceDistance, goalRaceTime }),
      source: 'the fitness anchor this plan was built from',
    };
  }

  return {
    calculator: makeCalculator({ ...FALLBACK_ANCHOR, goalRaceDistance, goalRaceTime }),
    source: 'a 10K in 47:00 — add a current race time in Manage Plan to sharpen every pace here',
  };
}

/* ------------------------------------------------------------------ screen */

export default function screen(root, state, navigate) {
  if (!root) return;
  if (!state.athlete) state.athlete = {};

  const units = unitsOf(state);
  const suffix = unitSuffix(units);
  const plan = state.plan;

  if (!plan) {
    const body = el('div', { class: 'screen-body' },
      emptyState({
        icon: 'calendar',
        title: 'No training plan yet',
        message: 'Tell Runna your goal, your current fitness and the days you can run, and it will build the whole block around your week.',
        actionTitle: 'Create a new plan',
        onAction: () => { if (typeof navigate === 'function') navigate('onboarding'); },
      }));
    root.textContent = '';
    root.appendChild(body);
    staggerIn(body);
    return;
  }

  const goal = goalMeta(plan);
  const weeks = orderedWeeks(plan);
  const anchor = resolveAnchor(state);
  const progress = planProgress(state);
  const weekNumber = currentWeekNumber(state);
  const toRace = daysToRace(state);
  const progressPercent = Math.round(progress * 100);

  /* --------------------------------------------------------------- header */

  const shield = planShield(plan.iconText || goal.iconText, goal.shieldColor, 68);

  const countdown = (() => {
    if (toRace === null) {
      return {
        text: `No race date — this block runs for ${plan.planLength} weeks.`,
        color: 'var(--text-muted)',
      };
    }
    if (toRace > 1) return { text: `${toRace} days until race day`, color: toRace <= 7 ? 'var(--warning)' : 'var(--text-muted)' };
    if (toRace === 1) return { text: 'Race day is tomorrow', color: 'var(--warning)' };
    if (toRace === 0) return { text: 'Race day is today', color: 'var(--warning)' };
    return { text: 'Race day has passed', color: 'var(--text-muted)' };
  })();

  const progressRing = ring({
    value: progress,
    size: 78,
    lineWidth: 9,
    color: 'var(--primary)',
    track: 'var(--raised)',
    label: '0%',
    caption: 'DONE',
    ariaLabel: `${progressPercent} percent of the plan complete`,
  });

  const headerCard = card({ padding: 16 },
    el('div', { class: 'stack', style: { gap: '16px' } },
      el('div', { class: 'row-top', style: { gap: '14px' } },
        shield,
        el('div', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0' } },
          el('span', { class: 't-headline', text: plan.shortPlanName || goal.title }),
          el('span', { class: 'row-wrap' },
            chip(abilityTitle(plan.ability), { color: 'var(--primary)', icon: 'run' }),
            chip(`Week ${weekNumber} of ${plan.planLength}`, { color: 'var(--info)' })),
          el('span', { class: 't-caption', style: { color: countdown.color }, text: countdown.text })),
        progressRing),
      plan.salesline ? el('p', { class: 't-caption muted', style: { margin: '0' }, text: plan.salesline }) : null,
      el('div', { class: 'grid-3' },
        statTile('COMPLETED', formatDistance(planCompletedMeters(), units), suffix, 'var(--primary)', 'check-circle'),
        statTile('PLANNED', formatDistance(planPlannedMeters(), units), suffix, 'var(--info)', 'chart'),
        statTile('LONGEST RUN', formatDistance(Number(plan.longRunMeters) || 0, units), suffix, 'var(--violet)', 'route'))));

  function abilityTitle(key) {
    const titles = {
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      elite: 'Elite',
      elitePlus: 'Elite+',
    };
    return titles[key] || 'Intermediate';
  }

  function planPlannedMeters() {
    return weeks.reduce((sum, w) => sum + weekPlannedMeters(w), 0);
  }

  function planCompletedMeters() {
    return weeks.reduce((sum, w) => sum + weekCompletedMeters(state, w), 0);
  }

  function statTile(title, value, unit, accent, icon) {
    return card({ padding: 14, class: 'stat-tile', style: { '--tile-accent': accent } },
      el('div', { class: 'stat-tile__head' }, svgIcon(icon, 12),
        el('span', { class: 'stat-tile__label', text: title })),
      el('div', { class: 'stat-tile__value-row' },
        el('span', { class: 'stat-tile__value', text: value }),
        el('span', { class: 'stat-tile__unit', text: unit })));
  }

  /* ---------------------------------------------------------- week cards */

  const weekList = el('div', { class: 'stack' });

  weeks.forEach((week, index) => {
    weekList.appendChild(weekCard(week, index));
  });

  function weekCard(week, index) {
    const current = isCurrentWeek(week, state);
    const all = weekSessions(week);
    const runs = all.filter((s) => s.runType !== 'rest');
    const done = runs.filter((s) => isSessionCompleted(state, s)).length;
    const start = startOfDay(week.startDate) || startOfDay(new Date());
    const end = addDays(start, 6);
    const phase = phaseMeta(week.phase);

    const statusChip = current
      ? chip('Current', { color: 'var(--primary)', filled: true })
      : week.isDeload
        ? chip('Deload', { color: 'var(--info)' })
        : week.isTaper
          ? chip('Taper', { color: 'var(--violet)' })
          : chip(phase.title, { color: phase.color });

    const listHost = el('div', { class: 'stack-sm', style: { marginTop: '4px' } });
    let expanded = current;
    let listBuilt = false;

    const chevron = svgIcon('chevron-down', 14);
    chevron.style.transition = 'transform var(--dur-snappy) var(--ease-snappy)';
    chevron.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';

    const toggle = el('button', {
      type: 'button',
      style: {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: '0',
        padding: '0',
        color: 'inherit',
        font: 'inherit',
      },
      'aria-expanded': expanded ? 'true' : 'false',
      onclick: () => {
        expanded = !expanded;
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        chevron.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        if (expanded && !listBuilt) {
          buildList();
          staggerIn(listHost);
        }
        listHost.style.display = expanded ? '' : 'none';
      },
    },
      el('div', { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } },
        el('div', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0', gap: '5px' } },
          el('span', { class: 't-caption muted', text: formatDateRange(start, end) }),
          el('span', { class: 'row-wrap', style: { gap: '6px' } },
            el('span', { class: 't-headline', text: `Week ${week.weekIndex}` }),
            statusChip),
          el('span', { class: 't-caption faint', text: week.title || `Week ${week.weekIndex}` })),
        el('div', { class: 'stack-sm', style: { alignItems: 'flex-end', flex: '0 0 auto', gap: '2px' } },
          el('span', { class: 'row-sm', style: { alignItems: 'baseline', gap: '1px' } },
            el('span', { class: 'metric-sm tabular', text: String(done) }),
            el('span', { class: 'metric-sm tabular', text: `/${runs.length}` })),
          el('span', { class: 't-micro faint', text: 'DONE' })),
        el('span', { style: { color: 'var(--text-faint)', flex: '0 0 auto' } }, chevron)));

    const card_ = card(
      {
        padding: 16,
        fill: current ? 'var(--raised)' : undefined,
        class: 'week-card',
      },
      el('div', { class: 'stack', style: { gap: '12px' } },
        toggle,
        meter({
          value: done,
          max: Math.max(1, runs.length),
          height: 7,
          color: current ? 'var(--primary)' : 'var(--primary-deep)',
        }),
        el('div', { class: 'stack-sm', style: { gap: '6px' } },
          statLine('Workouts', `${done}/${runs.length}`),
          statLine('Distance', `${formatDistance(weekCompletedMeters(state, week), units)}/${formatDistance(weekPlannedMeters(week), units)} ${suffix.toUpperCase()}`)),
        listHost,
        week.coachNote ? el('span', { class: 't-caption muted', text: week.coachNote }) : null));

    if (current) {
      card_.appendChild(el('span', {
        'aria-hidden': 'true',
        style: {
          position: 'absolute',
          inset: '0',
          borderRadius: 'inherit',
          border: '1.5px solid color-mix(in srgb, var(--primary) 55%, transparent)',
          pointerEvents: 'none',
        },
      }));
    }

    function buildList() {
      listBuilt = true;
      listHost.textContent = '';
      for (const s of all) {
        listHost.appendChild(sessionRow(s, {
          units,
          i: Number(s.dayIndex) || 0,
          onTap: () => openSessionSheet(s, week),
        }));
      }
    }

    if (current) {
      buildList();
      staggerIn(listHost);
    } else {
      listHost.style.display = 'none';
    }

    card_.style.setProperty('--i', String(Math.min(index, 8)));
    card_.classList.add('card-entrance');
    return card_;
  }

  function statLine(label, value) {
    return el('div', { class: 'row-between' },
      el('span', { class: 't-caption muted', text: label }),
      el('span', { class: 't-body-strong tabular', text: value }));
  }

  /* -------------------------------------------------------- mileage chart */

  const mileageValues = weeks.map((w) => weekPlannedMeters(w) / 1000);
  const mileageTotal = mileageValues.reduce((a, b) => a + b, 0);
  const mileagePeak = mileageValues.length ? Math.max(...mileageValues) : 0;
  const currentIndex = weeks.findIndex((w) => isCurrentWeek(w, state));

  const mileageSection = el('section', { class: 'section' },
    sectionHeader('Planned mileage'),
    card({ padding: 16 },
      el('div', { class: 'stack', style: { gap: '14px' } },
        el('div', { class: 'grid-2' },
          statTile('TOTAL PLANNED', formatDistance(mileageTotal * 1000, units), suffix, 'var(--primary)', 'chart'),
          statTile('PEAK WEEK', formatDistance(mileagePeak * 1000, units), suffix, 'var(--pace-threshold)', 'arrow-right')),
        mileageChart(),
        el('div', { class: 'row-wrap' },
          legendDot('var(--primary)', 'Current week'),
          legendDot('var(--text-faint)', 'Planned km per week')),
        el('span', {
          class: 't-caption faint',
          text: "Runna builds mileage week by week with a fixed ceiling on how much it can rise in any single week. The ceiling comes from your current weekly mileage, and the more days a week you run, the smaller that increase is.",
        }))));

  function legendDot(color, label) {
    return el('span', { class: 'row-sm', style: { gap: '6px' } },
      el('span', {
        'aria-hidden': 'true',
        style: { width: '7px', height: '7px', borderRadius: 'var(--radius-pill)', background: color },
      }),
      el('span', { class: 't-caption faint', text: label }));
  }

  /**
   * Inline SVG bar chart. Bars grow from zero with a transform-only scaleY, so
   * nothing here triggers layout on a phone.
   */
  function mileageChart() {
    const count = Math.max(1, weeks.length);
    const VIEW_W = 360;
    const VIEW_H = 116;
    const max = Math.max(1, ...mileageValues);
    const slot = VIEW_W / count;
    const barW = Math.max(3, Math.min(22, slot * 0.62));

    const svg = el('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      width: '100%',
      height: 'auto',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': `Planned weekly distance across ${count} weeks`,
      style: { display: 'block', overflow: 'visible' },
    });

    const bars = [];
    weeks.forEach((week, i) => {
      const value = mileageValues[i];
      const fraction = value / max;
      const h = Math.max(3, VIEW_H * fraction);
      const x = i * slot + (slot - barW) / 2;
      const y = VIEW_H - h;
      const isCurrent = i === currentIndex;

      const rect = el('rect', {
        x: String(x),
        y: String(y),
        width: String(barW),
        height: String(h),
        rx: '4',
        fill: isCurrent ? 'var(--primary)' : 'var(--text-faint)',
        opacity: isCurrent ? '1' : '0.5',
      });

      const group = el('g', {
        style: { transformBox: 'fill-box', transformOrigin: 'bottom' },
      }, rect);

      svg.appendChild(group);

      const title = el('title', {
        text: `Week ${week.weekIndex}: ${value.toFixed(1)} km`,
      });
      group.appendChild(title);
      bars.push({ group, isCurrent, index: i });
    });

    // Week numbers live in HTML so they stay crisp and align by column count.
    const labels = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        gap: '2px',
        marginTop: '6px',
      },
    });
    weeks.forEach((week, i) => {
      labels.appendChild(el('span', {
        class: 't-micro',
        style: {
          textAlign: 'center',
          color: i === currentIndex ? 'var(--primary)' : 'var(--text-faint)',
          fontWeight: i === currentIndex ? '700' : '400',
        },
        text: String(week.weekIndex),
      }));
    });

    // Bars animate up from zero on appear. Under reduce-motion `motion.animate`
    // is a no-op and the natural full-height bars simply stand.
    requestAnimationFrame(() => {
      for (const bar of bars) {
        animate(bar.group, [
          { transform: 'scaleY(0)' },
          { transform: 'scaleY(1)' },
        ], { duration: motion.meter, delay: Math.min(bar.index, 12) * 40 });
      }
    });

    return el('div', {}, svg, labels);
  }

  /* ---------------------------------------------------------- pace zones */

  const targets = anchor.calculator.targets();
  const zoneRows = el('div', { class: 'stack', style: { gap: '12px' } });

  for (const target of targets) {
    const zone = zoneOf(target.zone);
    zoneRows.appendChild(el('div', { class: 'row-top', style: { gap: '10px' } },
      el('span', {
        'aria-hidden': 'true',
        style: {
          width: '9px',
          height: '9px',
          marginTop: '5px',
          flex: '0 0 auto',
          borderRadius: 'var(--radius-pill)',
          background: zone.color,
        },
      }),
      el('div', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0', gap: '2px' } },
        el('span', { class: 't-body-strong', text: zone.title }),
        el('span', { class: 't-caption faint', text: zone.purpose })),
      el('span', { class: 'row-sm nowrap', style: { gap: '3px', flex: '0 0 auto' } },
        el('span', { class: 't-caption', text: formatPaceShort(target.fastSecondsPerKm, units) }),
        el('span', { class: 't-caption faint', text: '–' }),
        el('span', { class: 't-caption', text: formatPaceShort(target.slowSecondsPerKm, units) }),
        el('span', { class: 't-caption faint', text: `/${suffix}` }))));
  }

  const predictions = anchor.calculator.racePredictions(units);

  const raceRows = el('div', { class: 'stack-sm', style: { gap: '8px' } });
  for (const row of predictions) {
    raceRows.appendChild(el('div', { class: 'row-between' },
      el('span', { class: 't-body-sm', text: row.label }),
      el('span', { class: 'row-sm', style: { gap: '3px' } },
        el('span', { class: 't-caption secondary-text tabular', text: formatDuration(row.fast) }),
        el('span', { class: 't-caption faint', text: '–' }),
        el('span', { class: 't-caption secondary-text tabular', text: formatDuration(row.slow) }))));
  }

  const paceSection = el('section', { class: 'section' },
    sectionHeader('Pace Insights & Estimated Race Times'),
    card({ padding: 16 },
      el('div', { class: 'stack', style: { gap: '14px' } },
        el('span', { class: 't-micro', style: { color: 'var(--primary)' }, text: 'CURRENT ABILITY — NOT A GOAL TIME' }),
        el('p', {
          class: 't-caption muted',
          style: { margin: '0' },
          text: 'Runna asks for one Estimated Race Time, which describes the fitness you have today. You cannot enter a goal time, and Runna does not train you towards one. Every pace target below is derived from that single fitness level and is recalculated whenever your race times or preferences change.',
        }),
        el('span', { class: 't-caption faint', text: `Based on ${anchor.source}.` }),
        el('div', { class: 'divider' }),
        el('span', { class: 't-micro faint uppercase', text: 'PACE TARGETS' }),
        zoneRows,
        el('div', { class: 'divider' }),
        el('span', { class: 't-micro faint uppercase', text: 'ESTIMATED RACE TIMES' }),
        el('div', { class: 'row-between' },
          el('span', { class: 't-micro faint', text: 'Distance' }),
          el('span', { class: 't-micro faint', text: 'Fast – slow band' })),
        raceRows,
        el('span', {
          class: 't-caption faint',
          text: 'Estimates are a range, not a single number: expect to finish somewhere inside it. They assume good conditions and a relatively flat road course, and Runna deliberately keeps them conservative.',
        }))),
  );

  /* --------------------------------------------------------- session sheet */

  function openSessionSheet(target, week) {
    if (!target) return;
    const accent = sessionAccent(target.runType);
    const hasPace = Number(target.targetPaceLowSecondsPerKm) > 0 && Number(target.targetPaceHighSecondsPerKm) > 0;
    const zone = zoneOf(target.primaryZone);

    const blocks = el('div', { class: 'stack-sm' });
    const steps = (Array.isArray(target.steps) ? target.steps.slice() : [])
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    if (!steps.length) {
      blocks.appendChild(el('span', { class: 't-caption muted', text: 'No structured steps for this session.' }));
    }

    steps.forEach((step, i) => {
      const stepZone = zoneOf(step.zone);
      const reps = Math.max(1, Number(step.repetitions) || 1);
      const lower = String(step.label || '').toLowerCase();

      let header = step.label || '';
      let caption = step.note || '';
      if (lower.includes('warm')) {
        header = 'Warm-up';
        caption = caption || 'Ease in. The warm-up is part of the session, not a formality.';
      } else if (lower.includes('cool')) {
        header = 'Cool-down';
        caption = caption || 'Bring the heart rate down slowly.';
      } else if (reps > 1) {
        header = `Set · Repeat ${reps}x`;
      }

      blocks.appendChild(el('div', { class: 'row-between', style: { gap: '8px' } },
        el('span', { class: 't-caption', style: { color: stepZone.color, fontWeight: '700' }, text: header }),
        reps > 1 ? el('span', { class: 't-micro faint', text: `${reps} reps` }) : null));
      if (caption) blocks.appendChild(el('span', { class: 't-caption faint', text: caption }));

      blocks.appendChild(stepRow({
        ...step,
        zone: stepZone,
        label: reps > 1 ? 'Rep' : step.label,
        prescription: step.prescription || '',
        i,
      }));

      const recovery = Number(step.recoverySeconds) || 0;
      if (recovery > 0 && reps > 1) {
        blocks.appendChild(stepRow({
          label: 'Rest',
          prescription: formatDuration(recovery),
          zone: PACE_ZONES.recovery,
          note: 'Keep moving, stay relaxed, and start the next rep when you are ready.',
        }));
      }
    });

    // Every zone this session touches, with its band.
    const touched = [];
    for (const step of steps) {
      const key = typeof step.zone === 'string' ? step.zone : (step.zone && step.zone.key);
      if (key && !touched.includes(key)) touched.push(key);
    }
    if (!touched.length) touched.push(zone.key);

    const zoneTable = el('div', { class: 'stack-sm', style: { gap: '10px' } });
    for (const key of touched) {
      const meta = zoneOf(key);
      const target = anchor.calculator.target(key);
      zoneTable.appendChild(el('div', { class: 'row-top', style: { gap: '10px' } },
        el('span', {
          'aria-hidden': 'true',
          style: { width: '9px', height: '9px', marginTop: '5px', flex: '0 0 auto', borderRadius: 'var(--radius-pill)', background: meta.color },
        }),
        el('div', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0', gap: '2px' } },
          el('span', { class: 't-body-strong', text: meta.title }),
          el('span', { class: 't-micro faint', text: meta.purpose })),
        target
          ? el('span', { class: 'row-sm nowrap', style: { gap: '3px', flex: '0 0 auto' } },
            el('span', { class: 't-caption', style: { color: meta.color }, text: formatPaceShort(target.fastSecondsPerKm, units) }),
            el('span', { class: 't-caption faint', text: '–' }),
            el('span', { class: 't-caption', text: formatPaceShort(target.slowSecondsPerKm, units) }))
          : null));
    }

    const content = el('div', { class: 'stack' },
      el('div', { class: 'row-between' },
        chip(typeTitle(target.runType), { color: accent, icon: sessionIcon(target.runType) }),
        el('span', {
          class: 't-caption muted',
          text: `${formatDateRange(target.date, target.date)} · Week ${week ? week.weekIndex : weekNumber}`,
        })),
      el('div', { class: 'grid-3' },
        miniStat('DISTANCE', target.distanceMeters > 0 ? formatDistance(target.distanceMeters, units) : '—', suffix, accent),
        miniStat('EST. TIME', target.durationSeconds > 0 ? formatDuration(target.durationSeconds) : '—', null, 'var(--text-secondary)'),
        miniStat('PACE', hasPace ? formatPaceShort(target.targetPaceLowSecondsPerKm, units) : '—', hasPace ? `/${suffix}` : null, zone.color)),
      target.sessionDescription
        ? el('p', { class: 't-body-sm muted', style: { margin: '0' }, text: target.sessionDescription })
        : null,
      el('span', { class: 't-micro faint uppercase', text: 'Session structure' }),
      card({ padding: 16 }, blocks),
      el('span', {
        class: 't-caption faint',
        text: 'Warm-up → Set (repeating reps) → Rest → Cool-down. Stages advance on distance or time unless you turn on Open Warm-Up or Intervals/Tempo on Track — and hill reps always advance by hand.',
      }),
      el('span', { class: 't-micro faint uppercase', text: 'Pace targets' }),
      card({ padding: 14 }, zoneTable),
      el('span', { class: 't-caption faint', text: `Derived from ${anchor.source}. Paces are regenerated whenever your benchmark changes — they never change on their own.` }),
      target.coachTip
        ? card({ padding: 14, class: 'card--raised' },
          el('div', { class: 'stack-sm' },
            el('span', { class: 't-micro faint uppercase', text: "COACH'S COMMENT" }),
            el('span', { class: 't-body-sm secondary-text', text: target.coachTip }),
            el('span', { class: 't-micro faint', text: 'Written by the Runna coaching team.' })))
        : null);

    const panel = sheet({ title: target.runTitle || typeTitle(target.runType) }, content);
    panel.open();
  }

  function miniStat(label, value, unit, color) {
    return card({ padding: 12, class: 'stat-tile', style: { '--tile-accent': color } },
      el('div', { class: 'stat-tile__head' },
        el('span', { class: 'stat-tile__label', text: label })),
      el('div', { class: 'stat-tile__value-row' },
        el('span', { class: 'stat-tile__value', text: value }),
        unit ? el('span', { class: 'stat-tile__unit', text: unit }) : null));
  }

  /* ---------------------------------------------------------------- mount */

  const body = el('div', { class: 'screen-body' },
    headerCard,
    el('section', { class: 'section' },
      sectionHeader('Your weeks'),
      weekList),
    mileageSection,
    paceSection);

  root.textContent = '';
  root.appendChild(body);

  staggerIn(body, motion.stagger, 4);

  // Roll the header numbers up from zero, matching the native Plan tab.
  const ringValue = progressRing.querySelector('.ring-center__value');
  if (ringValue) countUp(ringValue, 0, progressPercent, { duration: 700, format: (v) => `${Math.round(v)}%` });
}
