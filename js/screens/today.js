/**
 * screens/today.js — Today tab.
 *
 * Mirrors app/Runna/Features/Today/TodayView.swift: greeting, today's session
 * hero (or rest / next-up state), the weekly mileage card with a streak badge,
 * a Mon–Sun day rail, and a timer-based run recorder.
 *
 * The run recorder is deliberately self-contained: the timer works with no
 * permissions at all, and `navigator.geolocation` is used only to sharpen the
 * recorded distance when the browser grants it.
 *
 * Contract: `export default function screen(root, state, navigate)`.
 */

import { RUN_TYPES, PACE_ZONES, PLAN_PHASES } from '../engine/enums.js';
import {
  saveState,
  markSessionComplete,
  addRun,
  sessionId,
  isSessionCompleted,
  weekFor,
  todaysSession,
  nextSession,
  currentStreak,
  startOfDay,
} from '../domain/store.js';
import {
  formatDistance,
  formatDuration,
  formatPaceShort,
  relativeDay,
} from '../domain/format.js';
import {
  el,
  card,
  chip,
  svgIcon,
  ring,
  meter,
  sheet,
  toast,
  stepRow,
  emptyState,
  sessionAccent,
  sessionIcon,
  sessionTypeLabel,
} from '../ui/components.js';
import { motion, countUp, staggerIn } from '../ui/motion.js';

/* ----------------------------------------------------------------- helpers */

/** enums gives the canonical session title ('Tempo Run'); components the icon. */
function typeTitle(runType) {
  const meta = RUN_TYPES[runType];
  return meta ? meta.title : sessionTypeLabel(runType);
}

function zoneOf(value) {
  const key = typeof value === 'string' ? value : (value && value.key) || 'easy';
  return PACE_ZONES[key] || PACE_ZONES.easy;
}

function isRunningSession(session) {
  const meta = RUN_TYPES[session && session.runType];
  return !!(meta && meta.isRunning);
}

function unitsOf(state) {
  return state && state.athlete && state.athlete.units === 'miles' ? 'miles' : 'kilometers';
}

/** The weekly card's formatter: one decimal below 100, none above. */
function weekDistanceText(meters, units) {
  const v = (Number(meters) || 0) / (units === 'miles' ? 1609.344 : 1000);
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(state) {
  const name = String((state.athlete && state.athlete.name) || '').trim();
  if (!name) return 'Runner';
  return name.split(/\s+/)[0];
}

function paceRangeText(session, units) {
  const low = Number(session.targetPaceLowSecondsPerKm) || 0;
  const high = Number(session.targetPaceHighSecondsPerKm) || 0;
  if (!(low > 0 && high > 0)) return '';
  const suffix = units === 'miles' ? 'mi' : 'km';
  return `${formatPaceShort(low, units)} – ${formatPaceShort(high, units)} /${suffix}`;
}

/** Sessions that are worth recording: running types, not rest. */
function isRecordable(session) {
  return !!session && session.runType !== 'rest' && isRunningSession(session);
}

/**
 * The workout grammar: warm-up → set (repeating reps) → rest → cool-down.
 * Step zones arrive as keys, so they are resolved to the `PACE_ZONES` objects
 * `stepRow` expects.
 */
function structureBlocks(session) {
  const raw = Array.isArray(session.steps) ? session.steps.slice() : [];
  raw.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  return raw.map((step) => {
    const zone = zoneOf(step.zone);
    const label = String(step.label || '');
    const lower = label.toLowerCase();
    const reps = Math.max(1, Number(step.repetitions) || 1);

    let header = label;
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

    return { step, zone, header, caption, reps };
  });
}

/** Render the step list for a session into a card. */
function structureCard(session, { compact = false } = {}) {
  const blocks = structureBlocks(session);
  const body = el('div', { class: 'stack-sm' });

  if (!blocks.length) {
    body.appendChild(el('span', {
      class: 't-caption muted',
      text: 'No structured steps for this session — run it by feel at the pace target.',
    }));
    return card({ padding: compact ? 12 : 16 }, body);
  }

  blocks.forEach((block, i) => {
    body.appendChild(el('div', { class: 'row-between', style: { gap: '8px' } },
      el('span', {
        class: 't-caption',
        style: { color: block.zone.color, fontWeight: '700' },
        text: block.header,
      }),
      block.reps > 1
        ? el('span', { class: 't-micro faint', text: `${block.reps} reps` })
        : null));

    if (block.caption) {
      body.appendChild(el('span', { class: 't-caption faint', text: block.caption }));
    }

    body.appendChild(stepRow({
      ...block.step,
      zone: block.zone,
      label: block.reps > 1 ? 'Rep' : block.step.label,
      prescription: block.step.prescription || '',
      i,
    }));

    // The rest between reps is synthesised, never stored.
    const recovery = Number(block.step.recoverySeconds) || 0;
    if (recovery > 0 && block.reps > 1) {
      body.appendChild(stepRow({
        label: 'Rest',
        prescription: formatDuration(recovery),
        zone: PACE_ZONES.recovery,
        note: 'Keep moving, stay relaxed, and start the next rep when you are ready.',
      }));
    }
  });

  return card({ padding: compact ? 12 : 16 }, body);
}

/* ------------------------------------------------------------------ screen */

export default function screen(root, state, navigate) {
  if (!root) return;
  if (!state.athlete) state.athlete = {};
  if (!Array.isArray(state.runs)) state.runs = [];

  const units = unitsOf(state);
  const now = new Date();
  const today = startOfDay(now);
  const plan = state.plan;

  const week = weekFor(state, today);
  const weekSessions = week.sessions || [];
  const weekRunSessions = weekSessions.filter(isRunningSession);

  const plannedMeters = weekSessions.reduce((sum, s) => sum + (Number(s.distanceMeters) || 0), 0);
  const completedMeters = weekSessions
    .filter((s) => isSessionCompleted(state, s))
    .reduce((sum, s) => sum + (Number(s.distanceMeters) || 0), 0);
  const runSessionsDone = weekRunSessions.filter((s) => isSessionCompleted(state, s)).length;

  const session = todaysSession(state, today);
  const streak = currentStreak(state, today);

  /* -------------------------------------------------------------- greeting */

  const greeting = el('div', { class: 'stack-sm' },
    el('h1', { class: 't-display', text: `${greetingFor(now)}, ${firstName(state)}` }),
    el('span', {
      class: 't-caption muted',
      text: now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
    }));

  /* --------------------------------------------------------- session block */

  const sessionSection = el('section', { class: 'section' },
    el('div', { class: 'row-between' },
      el('span', { class: 't-micro faint uppercase', text: "Today's session" }),
      session && isSessionCompleted(state, session)
        ? chip('Completed', { color: 'var(--primary)', icon: 'check-circle', filled: true })
        : null));

  if (!plan) {
    sessionSection.appendChild(emptyState({
      icon: 'calendar',
      title: 'No training plan yet',
      message: 'Tell Runna your goal and your current fitness, and it will build the whole block around your week.',
      actionTitle: 'Build my plan',
      onAction: () => { if (typeof navigate === 'function') navigate('onboarding'); },
    }));
  } else if (session && session.runType === 'rest') {
    sessionSection.appendChild(restCard(session));
  } else if (session) {
    sessionSection.appendChild(heroCard(session));
  } else {
    sessionSection.appendChild(nextUpCard());
  }

  /* ------------------------------------------------------------ rest card */

  function restCard(rest) {
    const upcoming = nextSession(state, today);
    const body = el('div', { class: 'stack-sm' },
      el('span', { class: 't-micro faint uppercase', text: 'REST DAY' }),
      el('span', { class: 't-headline', text: rest.runTitle || 'Rest Day' }),
      el('span', {
        class: 't-body-sm muted',
        text: rest.coachTip || 'Full rest. Adaptation happens when you recover.',
      }),
      upcoming
        ? chip(`Next: ${upcoming.runTitle || typeTitle(upcoming.runType)} · ${relativeDay(upcoming.date)}`, {
          color: 'var(--text-muted)',
          icon: 'calendar',
        })
        : null);

    body.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      onclick: () => openRecorder(upcoming || rest),
    }, svgIcon('plus', 18), el('span', { text: 'Log a run instead' })));

    return card({ padding: 18, class: 'card--raised' }, body);
  }

  /* ---------------------------------------------------------- next-up card */

  function nextUpCard() {
    const upcoming = nextSession(state, today);
    if (!upcoming) {
      return emptyState({
        icon: 'calendar',
        title: 'Nothing scheduled today',
        message: 'There is no session on the plan for today. Add a run whenever you like — it will not change your plan.',
        actionTitle: 'Add Run',
        onAction: () => openRecorder(null),
      });
    }

    const accent = sessionAccent(upcoming.runType);
    const body = el('div', { class: 'stack-sm' },
      el('span', { class: 't-micro uppercase', style: { color: accent }, text: 'NEXT UP' }),
      el('span', {
        class: 't-headline',
        text: `Next: ${upcoming.runTitle || typeTitle(upcoming.runType)} · ${relativeDay(upcoming.date)}`,
      }),
      el('span', { class: 'row-wrap' },
        upcoming.distanceMeters > 0
          ? chip(`${formatDistance(upcoming.distanceMeters, units)} ${units === 'miles' ? 'mi' : 'km'}`, { color: accent })
          : null,
        upcoming.durationSeconds > 0
          ? chip(formatDuration(upcoming.durationSeconds), { color: 'var(--text-muted)' })
          : null,
        chip(RUN_TYPES[upcoming.runType] ? RUN_TYPES[upcoming.runType].title : 'Run', { color: accent })));

    body.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      onclick: () => openSessionSheet(upcoming),
    }, svgIcon('play', 18), el('span', { text: 'View workout' })));

    return card({ padding: 18 }, body);
  }

  /* ------------------------------------------------------------ hero card */

  function heroCard(today0) {
    const accent = sessionAccent(today0.runType);
    const done = isSessionCompleted(state, today0);
    const recordable = isRecordable(today0);
    const hasPace = Number(today0.targetPaceLowSecondsPerKm) > 0 && Number(today0.targetPaceHighSecondsPerKm) > 0;
    const range = paceRangeText(today0, units);

    const glyphTile = el('span', {
      'aria-hidden': 'true',
      style: {
        display: 'grid',
        placeItems: 'center',
        width: '52px',
        height: '52px',
        flex: '0 0 auto',
        borderRadius: 'var(--radius-tile)',
        background: `color-mix(in srgb, ${accent} 18%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 36%, transparent)`,
        color: accent,
      },
    }, svgIcon(sessionIcon(today0.runType), 26));

    const head = el('div', { class: 'row-top', style: { gap: '14px' } },
      glyphTile,
      el('div', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0' } },
        el('span', { class: 't-micro uppercase', style: { color: accent }, text: typeTitle(today0.runType) }),
        el('span', { class: 't-headline', text: today0.runTitle || typeTitle(today0.runType) }),
        el('span', { class: 'row-wrap' },
          done
            ? chip('Completed', { color: 'var(--primary)', icon: 'check-circle', filled: true })
            : chip('Today', { color: 'var(--primary)', icon: 'calendar' }))));

    const stat = (label, value, unit, color) => el('div', { class: 'stack-sm', style: { flex: '1 1 0', minWidth: '0' } },
      el('span', { class: 't-micro faint uppercase', text: label }),
      el('span', { class: 'row-sm', style: { alignItems: 'baseline' } },
        el('span', { class: 'metric-sm', text: value }),
        unit ? el('span', { class: 't-caption', style: { color: color || 'var(--text-muted)' }, text: unit }) : null));

    const stats = el('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } },
      stat('Distance',
        today0.distanceMeters > 0 ? formatDistance(today0.distanceMeters, units) : '—',
        today0.distanceMeters > 0 ? (units === 'miles' ? 'mi' : 'km') : null,
        accent),
      stat('Est. time',
        today0.durationSeconds > 0 ? formatDuration(today0.durationSeconds) : '—',
        null),
      stat('Pace target',
        hasPace ? formatPaceShort(today0.targetPaceLowSecondsPerKm, units) : '—',
        hasPace ? `/${units === 'miles' ? 'mi' : 'km'}` : null,
        zoneOf(today0.primaryZone).color));

    const body = el('div', { class: 'stack', style: { gap: '16px' } }, head, stats);

    if (today0.sessionDescription) {
      body.appendChild(el('p', {
        class: 't-body-sm muted',
        style: { margin: '0' },
        text: today0.sessionDescription,
      }));
    }

    if (range) {
      body.appendChild(el('span', {
        class: 'pace-pill',
        style: { '--chip-color': zoneOf(today0.primaryZone).color },
      },
        el('span', { class: 'pace-pill__dot' }),
        el('span', { class: 'pace-pill__label', text: zoneOf(today0.primaryZone).title }),
        el('span', { text: range })));
    }

    if (Array.isArray(today0.steps) && today0.steps.length) {
      body.appendChild(el('span', { class: 't-micro faint uppercase', text: 'Session structure' }));
      body.appendChild(structureCard(today0, { compact: true }));
    }

    body.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-primary btn-block',
      onclick: () => {
        if (recordable) openRecorder(today0);
        else openSessionSheet(today0);
      },
    }, svgIcon('play', 18),
      el('span', { text: recordable ? (done ? 'Run again' : 'Start run') : 'View workout' })));

    body.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      onclick: () => openSessionSheet(today0),
    }, el('span', { text: 'View workout details' })));

    const node = card({
      padding: 18,
      style: { '--accent': accent },
    }, body);

    // Session-type colour on the card edge.
    node.appendChild(el('span', {
      'aria-hidden': 'true',
      style: {
        position: 'absolute',
        inset: '0',
        borderRadius: 'inherit',
        border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
        pointerEvents: 'none',
      },
    }));
    return node;
  }

  /* ------------------------------------------------------- weekly mileage */

  const fraction = plannedMeters > 0 ? Math.min(1, completedMeters / plannedMeters) : 0;

  const ringNode = ring({
    value: fraction,
    size: 96,
    lineWidth: 10,
    color: 'var(--primary)',
    track: 'var(--raised)',
    label: '0',
    caption: `of ${weekDistanceText(plannedMeters, units)} ${units === 'miles' ? 'mi' : 'km'}`,
    ariaLabel: `${Math.round(fraction * 100)} percent of this week's mileage`,
  });

  const bigStat = (label, value, unit, color) => {
    const valueNode = el('span', { class: 'metric-sm tabular', text: '0' });
    return {
      node: el('div', { class: 'row-between' },
        el('span', { class: 't-body-sm muted', text: label }),
        el('span', { class: 'row-sm', style: { alignItems: 'baseline' } },
          valueNode,
          unit ? el('span', { class: 't-caption', style: { color: color || 'var(--text-muted)' }, text: unit }) : null)),
      valueNode,
    };
  };

  const statCompleted = bigStat('Completed', null, units === 'miles' ? 'mi' : 'km', 'var(--primary)');
  const statPlanned = bigStat('Planned', null, units === 'miles' ? 'mi' : 'km');
  const statSessions = bigStat('Sessions', null, `of ${weekRunSessions.length}`, 'var(--primary)');

  const phaseLabel = week.week
    ? `Week ${week.number} · ${(PLAN_PHASES[week.week.phase] || {}).title || 'Plan'}`
    : `Week ${week.number}`;

  const mileageBody = el('div', { class: 'stack' },
    el('div', { class: 'row', style: { gap: '16px', alignItems: 'center' } },
      ringNode,
      el('div', { class: 'stack-sm', style: { flex: '1 1 auto', minWidth: '0' } },
        statCompleted.node,
        statPlanned.node,
        statSessions.node)),
    meter({ value: fraction, max: 1, height: 8, animate: true }),
    el('div', { class: 'row-between' },
      el('span', { class: 't-micro faint uppercase', text: 'PHASE' }),
      el('span', {
        class: 't-caption',
        style: { color: week.week ? (PLAN_PHASES[week.week.phase] || {}).color || 'var(--text-muted)' : 'var(--text-muted)' },
        text: phaseLabel,
      })),
    dayRail(),
    el('span', { class: 't-caption faint', id: 'day-preview', text: previewFor(today.getDay() === 0 ? 6 : today.getDay() - 1) }));

  const mileageSection = el('section', { class: 'section' },
    el('div', { class: 'row-between', style: { gap: '8px' } },
      el('span', { class: 't-micro faint uppercase', text: 'Weekly mileage' }),
      streak > 0 ? streakBadge(streak) : null),
    plan ? card({ padding: 16 }, mileageBody) : card({ padding: 16 },
      el('span', { class: 't-body-sm muted', text: 'Your weekly mileage appears here once you have an active plan.' })));

  function streakBadge(days) {
    return el('span', { class: 'row-sm', style: { gap: '6px', flex: '0 0 auto' } },
      el('span', {
        style: {
          display: 'grid',
          placeItems: 'center',
          width: '28px',
          height: '28px',
          borderRadius: 'var(--radius-pill)',
          background: 'color-mix(in srgb, var(--streak) 20%, transparent)',
          color: 'var(--streak)',
        },
      }, svgIcon('flame', 15)),
      el('span', { class: 'stack-sm', style: { gap: '0' } },
        el('span', { class: 'metric-sm tabular', style: { color: 'var(--streak)' }, text: String(days) }),
        el('span', { class: 't-micro faint', text: days === 1 ? 'day streak' : 'days streak' })));
  }

  function previewFor(dayIndex) {
    const day = (week.days || [])[dayIndex];
    if (!day) return 'No session scheduled on this day.';
    const name = day.date.toLocaleDateString(undefined, { weekday: 'long' });
    if (!day.session) return `${name} · Rest day`;
    const parts = [name, day.session.runTitle || typeTitle(day.session.runType)];
    if (day.session.distanceMeters > 0) {
      parts.push(`${formatDistance(day.session.distanceMeters, units)} ${units === 'miles' ? 'mi' : 'km'}`);
    }
    if (isSessionCompleted(state, day.session)) parts.push('completed');
    return parts.join(' · ');
  }

  function dayRail() {
    const rail = el('div', { class: 'week-strip' });
    let selected = today.getDay() === 0 ? 6 : today.getDay() - 1;

    const buttons = (week.days || []).map((day, i) => {
      const s = day.session;
      const done = s ? isSessionCompleted(state, s) : false;
      const isToday = day.date.getTime() === today.getTime();
      const accent = s ? sessionAccent(s.runType) : 'var(--text-faint)';

      const button = el('button', {
        type: 'button',
        class: ['week-strip__day', i === selected && 'is-selected', done && 'is-completed', isToday && 'is-today'],
        'aria-label': day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
        onclick: () => {
          selected = i;
          buttons.forEach((b, j) => b.classList.toggle('is-selected', j === i));
          const preview = mileageBody.querySelector('#day-preview');
          if (preview) preview.textContent = previewFor(i);
        },
      },
        el('span', {
          class: 'week-strip__letter',
          text: day.date.toLocaleDateString(undefined, { weekday: 'narrow' }),
        }),
        el('span', {
          class: 'week-strip__circle',
          style: done ? null : { color: accent },
        }, svgIcon(s ? sessionIcon(s.runType) : 'moon', 15)),
        el('span', { class: 'week-strip__dot' }));

      return button;
    });

    for (const button of buttons) rail.appendChild(button);
    return rail;
  }

  /* ------------------------------------------------------------ rendering */

  const body = el('div', { class: 'screen-body' }, greeting, sessionSection, mileageSection);
  root.textContent = '';
  root.appendChild(body);

  // Entrances, then the numbers roll up.
  for (const child of [greeting, sessionSection, mileageSection]) child.classList.add('card-entrance');
  staggerIn(body, motion.stagger, 6);

  const ringValue = ringNode.querySelector('.ring-center__value');
  const completedValue = weekDistanceText(completedMeters, units);
  const plannedValue = weekDistanceText(plannedMeters, units);

  if (ringValue) {
    countUp(ringValue, 0, Number(completedValue), {
      duration: 700,
      format: (v) => (Number(completedValue) >= 100 ? v.toFixed(0) : v.toFixed(1)),
    });
  }
  countUp(statCompleted.valueNode, 0, Number(completedValue), {
    duration: 700,
    delay: 60,
    format: (v) => (Number(completedValue) >= 100 ? v.toFixed(0) : v.toFixed(1)),
  });
  countUp(statPlanned.valueNode, 0, Number(plannedValue), {
    duration: 700,
    delay: 120,
    format: (v) => (Number(plannedValue) >= 100 ? v.toFixed(0) : v.toFixed(1)),
  });
  countUp(statSessions.valueNode, 0, runSessionsDone, { duration: 700, delay: 180 });

  /* --------------------------------------------------------- session sheet */

  function openSessionSheet(target) {
    if (!target) return;
    const accent = sessionAccent(target.runType);
    const hasPace = Number(target.targetPaceLowSecondsPerKm) > 0 && Number(target.targetPaceHighSecondsPerKm) > 0;

    const content = el('div', { class: 'stack' },
      el('div', { class: 'row-between' },
        chip(typeTitle(target.runType), { color: accent, icon: sessionIcon(target.runType) }),
        el('span', { class: 't-caption muted', text: relativeDay(target.date) })),
      el('div', { class: 'grid-3' },
        miniStat('DISTANCE', target.distanceMeters > 0 ? formatDistance(target.distanceMeters, units) : '—', units === 'miles' ? 'mi' : 'km', accent),
        miniStat('EST. TIME', target.durationSeconds > 0 ? formatDuration(target.durationSeconds) : '—', null, 'var(--text-secondary)'),
        miniStat('PACE', hasPace ? formatPaceShort(target.targetPaceLowSecondsPerKm, units) : '—', hasPace ? `/${units === 'miles' ? 'mi' : 'km'}` : null, zoneOf(target.primaryZone).color)),
      target.sessionDescription
        ? el('p', { class: 't-body-sm muted', style: { margin: '0' }, text: target.sessionDescription })
        : null,
      el('span', { class: 't-micro faint uppercase', text: 'Session structure' }),
      structureCard(target),
      target.coachTip
        ? card({ padding: 14, class: 'card--raised' },
          el('div', { class: 'stack-sm' },
            el('span', { class: 't-micro faint uppercase', text: "Coach's comment" }),
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

  /* -------------------------------------------------------------- recorder */

  function openRecorder(target) {
    const plannedMeters = target ? Number(target.distanceMeters) || 0 : 0;
    const targetTitle = target ? (target.runTitle || typeTitle(target.runType)) : 'Run';

    // Recording preferences, written by Profile and persisted in state.prefs.
    //   audioCues        - speak/toast cues at start, each whole unit, and finish
    //   intervalsOnTrack - suppress the automatic per-unit cues; laps are manual
    //   openWarmUp       - hold in a warm-up phase until the runner taps Continue
    const prefs = state.prefs || {};
    const audioCues = prefs.audioCues !== false;
    const intervalsOnTrack = prefs.intervalsOnTrack === true;
    const openWarmUp = prefs.openWarmUp === true;

    const rec = {
      running: false,
      paused: false,
      startedAt: 0,
      accumulated: 0,
      ticker: 0,
      watchId: null,
      gpsMeters: 0,
      lastPosition: null,
      // Cue bookkeeping
      lastCueUnit: 0,
      phase: openWarmUp ? 'warmup' : 'main',
    };

    /** One cue, gated by the audioCues preference. Speech is best-effort. */
    function cue(text) {
      if (!audioCues) return;
      try { toast(text, { duration: 2200 }); } catch { /* toast is optional */ }
      try {
        if (window.speechSynthesis) {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 1.05;
          speechSynthesis.speak(u);
        }
      } catch { /* speech is a bonus, never a failure */ }
    }

    const elapsedMs = () => rec.accumulated + (rec.running && !rec.paused ? Date.now() - rec.startedAt : 0);

    const timeReadout = el('span', { class: 'metric-lg tabular', text: '0:00' });
    const distanceReadout = el('span', { class: 'metric-sm tabular', text: '0.00' });
    const statusNode = el('span', { class: 't-caption muted', text: 'Ready when you are.' });
    const dot = el('span', { class: 'pulse-dot', style: { display: 'none' } });

    const primary = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      style: { flex: '1 1 auto' },
      onclick: () => toggle(),
    }, svgIcon('play', 18), el('span', { text: 'Start' }));

    const finishButton = el('button', {
      type: 'button',
      class: 'btn btn-ghost',
      disabled: true,
      style: { flex: '0 0 auto' },
      onclick: () => finish(),
    }, svgIcon('stop', 18), el('span', { text: 'Finish' }));

    const content = el('div', { class: 'stack' },
      el('div', { class: 'stack-sm', style: { alignItems: 'center', padding: '8px 0' } },
        el('div', { class: 'row-sm', style: { color: 'var(--text-muted)' } }, dot, el('span', { class: 't-micro faint uppercase', text: targetTitle })),
        timeReadout,
        el('div', { class: 'row-sm', style: { alignItems: 'baseline' } },
          distanceReadout,
          el('span', { class: 't-caption muted', text: units === 'miles' ? 'mi' : 'km' })),
        statusNode),
      el('div', { class: 'row', style: { gap: '12px' } }, finishButton, primary),
      el('div', { class: 'divider' }),
      el('span', {
        class: 't-caption faint',
        text: plannedMeters > 0
          ? `Finishing saves the run and marks “${targetTitle}” complete. Distance comes from GPS when you allow it, otherwise from the planned session.`
          : 'Finishing saves the run to your log. Distance comes from GPS when you allow it.',
      }));

    const panel = sheet({ title: 'Record run', onClose: () => teardown() }, content);

    function startTicker() {
      if (rec.ticker) return;
      rec.ticker = setInterval(paint, 250);
    }

    function paint() {
      timeReadout.textContent = formatDuration(Math.floor(elapsedMs() / 1000));
      // Distance is GPS-only while recording — never invented from the clock.
      distanceReadout.textContent = rec.gpsMeters > 0 ? formatDistance(rec.gpsMeters, units) : '0.00';

      // Cue each whole display unit. `intervalsOnTrack` means the runner is
      // taking laps by hand, so the automatic cue would compete with them.
      if (audioCues && !intervalsOnTrack && rec.running && !rec.paused && rec.gpsMeters > 0) {
        const unitMeters = units === 'miles' ? 1609.344 : 1000;
        const whole = Math.floor(rec.gpsMeters / unitMeters);
        if (whole > rec.lastCueUnit) {
          rec.lastCueUnit = whole;
          const label = units === 'miles' ? 'mile' : 'kilometre';
          const secs = Math.floor(elapsedMs() / 1000);
          const pace = whole > 0 ? secs / whole : 0;
          cue(`${whole} ${label}${whole === 1 ? '' : 's'} — ${formatPaceShort(pace, units)} per ${units === 'miles' ? 'mile' : 'km'}`);
        }
      }
    }

    function toggle() {
      if (!rec.running) {
        rec.running = true;
        rec.paused = false;
        rec.startedAt = Date.now();
        startTicker();
        watchPosition();
        dot.style.display = '';
        finishButton.disabled = false;
        if (rec.phase === 'warmup') {
          // Open Warm-Up: the session does not begin until the runner says so,
          // which mirrors the native behaviour (and its documented consequence —
          // no cues fire until you advance past the warm-up).
          statusNode.textContent = 'Warm-up — tap Continue when you are ready for the session.';
          setPrimary('play', 'Continue');
        } else {
          statusNode.textContent = 'Recording — pause any time.';
          setPrimary('pause', 'Pause');
          cue('Session started. ' + (targetTitle || 'Run'));
        }
      } else if (rec.phase === 'warmup') {
        rec.phase = 'main';
        statusNode.textContent = 'Recording — session underway.';
        setPrimary('pause', 'Pause');
        cue('Warm-up over. Session underway.');
      } else if (!rec.paused) {
        rec.accumulated = elapsedMs();
        rec.paused = true;
        dot.style.display = 'none';
        statusNode.textContent = 'Paused — resume when you are moving again.';
        setPrimary('play', 'Resume');
      } else {
        rec.paused = false;
        rec.startedAt = Date.now();
        dot.style.display = '';
        statusNode.textContent = 'Recording — pause any time.';
        setPrimary('pause', 'Pause');
      }
      paint();
    }

    function setPrimary(icon, label) {
      primary.textContent = '';
      primary.appendChild(svgIcon(icon, 18));
      primary.appendChild(el('span', { text: label }));
    }

    /** Optional: accumulate GPS distance. Every failure mode is swallowed. */
    function watchPosition() {
      if (rec.watchId !== null) return;
      try {
        if (!navigator || !navigator.geolocation) return;
        rec.watchId = navigator.geolocation.watchPosition((position) => {
          const { latitude, longitude } = position.coords;
          if (rec.lastPosition && !rec.paused) {
            rec.gpsMeters += haversine(rec.lastPosition, { latitude, longitude });
          }
          rec.lastPosition = { latitude, longitude };
          paint();
        }, () => {
          statusNode.textContent = 'Recording without GPS — distance uses the planned session.';
        }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
      } catch {
        /* geolocation is a bonus, never a requirement */
      }
    }

    function teardown() {
      if (rec.ticker) clearInterval(rec.ticker);
      rec.ticker = 0;
      if (rec.watchId !== null) {
        try { navigator.geolocation.clearWatch(rec.watchId); } catch { /* ignore */ }
        rec.watchId = null;
      }
    }

    function finish() {
      const seconds = Math.max(1, Math.round(elapsedMs() / 1000));
      const usedGps = rec.gpsMeters > 50;
      const meters = usedGps ? Math.round(rec.gpsMeters) : plannedMeters;
      const id = target ? sessionId(target) : '';

      if (meters <= 0 && seconds < 5) {
        toast('Nothing recorded yet — start the timer first.', { tone: 'warning', icon: 'alert' });
        return;
      }

      cue(`Run finished. ${formatDistance(meters, units)} ${units === 'miles' ? 'miles' : 'kilometres'} in ${formatDuration(seconds)}.`);

      // One run, then tick the session off. `markSessionComplete` is called
      // without a run so the activity is never filed twice.
      addRun(state, {
        date: (target && target.date) || new Date().toISOString(),
        type: (target && target.runType) || 'easyRun',
        title: targetTitle,
        distanceMeters: meters,
        durationSeconds: seconds,
        sessionId: id || null,
        source: usedGps ? 'gps' : 'manual',
      });
      if (id) markSessionComplete(state, id);
      saveState(state);

      teardown();
      panel.close();
      render();
      toast('Run saved — session complete', { tone: 'success', icon: 'check-circle' });
    }

    panel.open();
  }

  function haversine(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Re-run the whole screen in place after a state change. */
  function render() {
    const next = screen;
    root.textContent = '';
    next(root, state, navigate);
  }
}
