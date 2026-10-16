/**
 * calendar.js — the Calendar tab.
 *
 * One month at a time, built from scratch: no `<input type="date">`, no native
 * date picker, just a 7-column grid of day cells that the plan's sessions hang
 * off. Each cell carries the session-type colours, a tick when the day's work
 * is done, and a ring when it is today.
 *
 * Layout notes, because this screen paints 42 cells at once:
 *   · sessions are bucketed by day key once per render, not filtered per cell;
 *   · the cell reveal is a single directional slide on the week rows, capped at
 *     4 steps of 24 ms over a 120 ms move — the whole grid has settled inside
 *     192 ms, comfortably under the 200 ms budget;
 *   · nothing here observes scroll, so no cell ever re-animates as the page
 *     moves. The only motion is a month change and a day selection.
 *
 * Contract: `export default function calendar(root, state, navigate)`.
 */

import {
  el,
  card,
  chip,
  sheet,
  screenHeader,
  sectionHeader,
  statTile,
  emptyState,
  svgIcon,
  sessionIcon,
  stepRow,
  dayKey,
  toDate,
} from '../ui/components.js';

import { staggerIn, haptic, animate as animateNode } from '../ui/motion.js';

import {
  planSessions,
  planStartDate,
  planRaceDate,
  planWeekCount,
  weekFor,
  isSessionCompleted,
  sessionId,
} from '../domain/store.js';

import {
  formatDistance,
  formatDistanceWithUnit,
  formatPace,
  formatPaceShort,
  formatDuration,
  formatDate,
  relativeDay,
} from '../domain/format.js';

import { RUN_TYPES, PACE_ZONES } from '../engine/enums.js';

/* ========================================================================== */
/* helpers                                                                    */
/* ========================================================================== */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The session's type key, guaranteed to exist in `RUN_TYPES`. */
function typeKey(session) {
  const raw = session && (session.runType || session.type || session.sessionType);
  const key = typeof raw === 'string' ? raw : (raw && raw.key) || '';
  return RUN_TYPES[key] ? key : 'easyRun';
}

/** The session-type accent — the single source of truth for a dot's colour. */
function accentFor(session) {
  return RUN_TYPES[typeKey(session)].accent;
}

function titleFor(session) {
  if (session && session.runTitle) return session.runTitle;
  if (session && session.title) return session.title;
  return RUN_TYPES[typeKey(session)].title;
}

/** Local midnight for a session's date, or null. */
function sessionDate(session) {
  return toDate((session && (session.date || session.startDate)) || null);
}

/* ------------------------------------------------------------------ months */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The first weekday of the grid.
 *
 * `Intl.Locale.weekInfo` gives the device calendar's own first day, which is
 * what iOS reads (`Calendar.current.firstWeekday`). Safari versions without it
 * fall back to Monday — the day Runna's own training weeks start on, and the
 * one `store.weekStart()` uses, so the grid and the plan never disagree.
 *
 * @returns {number} 0 = Sunday … 6 = Saturday
 */
function firstWeekdayIndex() {
  try {
    const locale = new Intl.Locale(navigator.language || 'en-GB');
    const info = typeof locale.getWeekInfo === 'function'
      ? locale.getWeekInfo()
      : (typeof locale.weekInfo === 'object' ? locale.weekInfo : null);
    const first = info && Number(info.firstDay);
    // CLDR: 1 = Monday … 7 = Sunday. JS: 0 = Sunday … 6 = Saturday.
    if (Number.isFinite(first) && first >= 1 && first <= 7) return first % 7;
  } catch {
    /* fall through to Monday */
  }
  return 1;
}

function weekdayHeaders() {
  const first = firstWeekdayIndex();
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_LETTERS[(first + i) % 7]);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function monthTitle(month) {
  return `${MONTH_NAMES[month.getMonth()]} ${month.getFullYear()}`;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Every date in the month, padded out to whole weeks. */
function gridDays(month) {
  const first = startOfMonth(month);
  const firstWeekday = firstWeekdayIndex();
  const leading = (first.getDay() - firstWeekday + 7) % 7;
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const total = Math.ceil((leading + dayCount) / 7) * 7;

  const start = new Date(first);
  start.setDate(start.getDate() - leading);

  return Array.from({ length: total }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return date;
  });
}

/** "Today · Friday 17 October" — the iOS `DayLabel.long` convention. */
function dayLabel(date) {
  const long = date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const relative = relativeDay(date);
  if (relative === 'today') return `Today · ${long}`;
  if (relative === 'tomorrow') return `Tomorrow · ${long}`;
  if (relative === 'yesterday') return `Yesterday · ${long}`;
  return long;
}

/** The line under the month title: where this month sits in the plan. */
function monthSubtitle(state, month) {
  if (!state.plan) return 'No plan yet';
  const now = new Date();

  if (sameMonth(month, now)) {
    const week = weekFor(state, now);
    const total = planWeekCount(state);
    if (week && total) return `Week ${Math.min(week.number, total)} of ${total}`;
  }

  const start = planStartDate(state);
  const race = planRaceDate(state);
  if (start && new Date(month.getFullYear(), month.getMonth() + 1, 0) < start) {
    return 'Before your plan starts';
  }
  if (race && startOfMonth(month) > race) return 'After race day';
  if (sameMonth(month, now)) return 'This month';
  return startOfMonth(month) < startOfMonth(now) ? 'Past month' : 'Ahead in your plan';
}

/* ========================================================================== */
/* the screen                                                                 */
/* ========================================================================== */

export default function calendar(root, state, navigate) {
  const units = () => (state.athlete && state.athlete.units) || 'kilometers';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let visibleMonth = startOfMonth(today);
  let selectedDay = today;
  // +1 paging forward, -1 back — the side the grid slides in from.
  let monthDirection = 1;
  let firstPaint = true;

  /** Sessions for a day, in plan order. */
  function sessionsByDay() {
    const buckets = new Map();
    for (const session of planSessions(state)) {
      const date = sessionDate(session);
      if (!date) continue;
      const key = dayKey(date);
      const list = buckets.get(key);
      if (list) list.push(session);
      else buckets.set(key, [session]);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => num(a.dayIndex) - num(b.dayIndex));
    }
    return buckets;
  }

  function monthSessions(buckets) {
    const out = [];
    for (const date of gridDays(visibleMonth)) {
      if (!sameMonth(date, visibleMonth)) continue;
      const list = buckets.get(dayKey(date));
      if (list) out.push(...list);
    }
    return out;
  }

  /* ------------------------------------------------------------- day cell */

  function dayCell(date, buckets) {
    const list = buckets.get(dayKey(date)) || [];
    const inMonth = sameMonth(date, visibleMonth);
    const isToday = dayKey(date) === dayKey(today);
    const isSelected = dayKey(date) === dayKey(selectedDay);
    const doneCount = list.filter((session) => isSessionCompleted(state, session)).length;

    const numbers = el('span', { text: String(date.getDate()) });
    if (!inMonth) numbers.style.opacity = '0.45';

    const marks = el('div', {
      class: 'row-sm',
      style: { gap: '2px', height: '8px', alignItems: 'center', justifyContent: 'center' },
    });

    // One dot per session, coloured by the session type's own accent. Four or
    // more sessions collapse to three dots and a count.
    if (list.length) {
      for (const session of list.slice(0, 3)) {
        marks.appendChild(el('span', {
          class: 'day-cell__dot',
          style: { '--dot-color': accentFor(session) },
        }));
      }
      if (list.length > 3) {
        marks.appendChild(el('span', {
          class: 't-micro faint',
          style: { fontSize: '8px', letterSpacing: '0' },
          text: `+${list.length - 3}`,
        }));
      }
      // A tick for completed work. `.icon` pins every sprite to 20 px, so the
      // size is set inline rather than through `svgIcon`'s argument.
      if (doneCount > 0) {
        const tick = svgIcon('check', 9);
        tick.style.width = '9px';
        tick.style.height = '9px';
        tick.style.color = 'var(--bright-green)';
        marks.appendChild(tick);
      }
    } else {
      // Keeps every cell the same height whether or not it has sessions.
      marks.appendChild(el('span', { style: { width: '5px', height: '5px' } }));
    }

    const cell = el(
      'button',
      {
        type: 'button',
        class: [
          'day-cell',
          !inMonth && 'is-muted',
          isToday && 'is-today',
          isSelected && 'is-selected',
        ],
        dataset: { day: dayKey(date) },
        'aria-label': `${dayLabel(date)}${list.length ? `, ${list.length} session${list.length === 1 ? '' : 's'}` : ', rest day'}`,
        'aria-pressed': isSelected ? 'true' : 'false',
        onclick: () => selectDay(date),
      },
      numbers,
      marks,
    );

    // Today's ring. `.is-today` only draws a hairline, so a real ring is set
    // here; a selected cell already owns its background, so the ring steps
    // aside rather than stacking on the same pixels.
    if (isToday && !isSelected) {
      cell.style.boxShadow = 'inset 0 0 0 1.5px var(--primary)';
      cell.style.color = 'var(--primary)';
    }
    if (isWeekend(date) && !isToday && !isSelected) {
      cell.style.color = inMonth ? 'var(--text-muted)' : 'var(--text-faint)';
    }
    return cell;
  }

  /* ------------------------------------------------------------ month grid */

  function monthGrid(buckets) {
    const days = gridDays(visibleMonth);
    const headers = weekdayHeaders();

    const headerRow = el('div', { class: 'day-grid' });
    for (const letter of headers) {
      headerRow.appendChild(el('div', { class: 'day-grid__head', text: letter }));
    }

    const grid = el('div', { class: 'stack-sm', 'data-month-grid': '' }, headerRow);

    // One row per week. Grouping the cells is what lets the month-change
    // animation touch six rows instead of forty-two cells.
    for (let i = 0; i < days.length; i += 7) {
      const row = el('div', { class: 'day-grid', 'data-week-row': '' });
      for (const date of days.slice(i, i + 7)) row.appendChild(dayCell(date, buckets));
      grid.appendChild(row);
    }
    return grid;
  }

  /** The directional slide, capped at four 24 ms steps over a 120 ms move. */
  function animateGrid() {
    const grid = root.querySelector('[data-month-grid]');
    if (!grid) return;
    const offset = monthDirection > 0 ? 18 : -18;
    grid.querySelectorAll('[data-week-row]').forEach((row, index) => {
      animateNode(
        row,
        [
          { opacity: 0, transform: `translateX(${offset}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        {
          duration: 120,
          delay: Math.min(index, 3) * 24,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
    });
  }

  /* ------------------------------------------------------- selected day list */

  function sessionPaceText(session) {
    const low = num(session.targetPaceLowSecondsPerKm);
    const high = num(session.targetPaceHighSecondsPerKm);
    if (low > 0 && high > 0) {
      return `${formatPaceShort(low, units())}–${formatPace(high, units())}`;
    }
    const zone = PACE_ZONES[session.primaryZone];
    return zone ? zone.title : '—';
  }

  function dayList(buckets) {
    const list = buckets.get(dayKey(selectedDay)) || [];
    const wrap = el('div', { class: 'section' });
    wrap.appendChild(sectionHeader(dayLabel(selectedDay)));

    if (!list.length) {
      wrap.appendChild(card(emptyState({
        icon: 'calendar',
        title: 'Nothing scheduled',
        message: `${dayLabel(selectedDay).split(' · ').pop()} is a free day. Rest is part of the plan.`,
      })));
      return wrap;
    }

    const rows = el('div', { class: 'stack-sm' });
    list.forEach((session, index) => {
      const completed = isSessionCompleted(state, session);
      const accent = accentFor(session);
      const meters = num(session.distanceMeters);
      const seconds = num(session.durationSeconds);

      const meta = el('div', { class: 'row-wrap', style: { gap: '10px' } });
      if (meters > 0) {
        meta.appendChild(el('span', { class: 't-caption muted tabular', text: formatDistanceWithUnit(meters, units()) }));
      }
      if (seconds > 0) {
        meta.appendChild(el('span', { class: 't-caption muted tabular', text: formatDuration(seconds) }));
      }
      meta.appendChild(el('span', { class: 't-caption tabular', style: { color: accent }, text: sessionPaceText(session) }));

      const glyph = el(
        'div',
        {
          style: {
            display: 'grid',
            placeItems: 'center',
            width: '44px',
            height: '44px',
            flex: '0 0 auto',
            borderRadius: '13px',
            background: `color-mix(in srgb, ${accent} 16%, transparent)`,
            color: accent,
          },
        },
        svgIcon(sessionIcon(typeKey(session)), 21),
      );

      const trailing = completed
        ? svgIcon('check-circle', 22)
        : el('span', { class: 't-micro faint', text: PACE_ZONES[session.primaryZone] ? PACE_ZONES[session.primaryZone].title.toUpperCase() : 'PLANNED' });
      if (completed) trailing.style.color = 'var(--bright-green)';

      rows.appendChild(el(
        'div',
        {
          class: ['card', 'card--tappable'],
          style: { padding: '10px 14px', '--i': String(Math.min(index, 6)) },
          role: 'button',
          tabindex: '0',
          dataset: { sessionId: sessionId(session) },
          onclick: () => {
            haptic(10);
            openSessionSheet(session);
          },
        },
        el(
          'div',
          { class: 'row', style: { gap: '12px' } },
          glyph,
          el(
            'div',
            { class: 'stack-sm', style: { gap: '3px', minWidth: '0', flex: '1 1 auto' } },
            el('div', { class: 't-body-strong truncate', text: titleFor(session) }),
            meta,
          ),
          trailing,
        ),
      ));
    });
    staggerIn(rows, 40, 6);
    wrap.appendChild(rows);
    return wrap;
  }

  /* ----------------------------------------------------------- session sheet */

  function openSessionSheet(session) {
    const accent = accentFor(session);
    const meters = num(session.distanceMeters);
    const seconds = num(session.durationSeconds);
    const completed = isSessionCompleted(state, session);
    const date = sessionDate(session);

    const chips = el('div', { class: 'row-wrap' });
    chips.appendChild(chip(RUN_TYPES[typeKey(session)].title, { color: accent, icon: sessionIcon(typeKey(session)) }));
    chips.appendChild(completed
      ? chip('Completed', { color: 'var(--bright-green)', icon: 'check' })
      : chip(date ? formatDate(date) : 'Planned', { color: 'var(--text-muted)', icon: 'calendar', neutral: true }));

    const facts = el(
      'div',
      { class: 'grid-3' },
      statTile('Distance', meters > 0 ? formatDistance(meters, units()) : '—', {
        unit: meters > 0 ? (units() === 'miles' ? 'mi' : 'km') : null,
        icon: 'route',
        accent: 'var(--primary)',
      }),
      statTile('Duration', seconds > 0 ? formatDuration(seconds) : '—', {
        icon: 'clock',
        accent: 'var(--info)',
      }),
      statTile('Target', num(session.targetPaceLowSecondsPerKm) > 0
        ? formatPaceShort(num(session.targetPaceLowSecondsPerKm), units())
        : (PACE_ZONES[session.primaryZone] ? PACE_ZONES[session.primaryZone].title : '—'), {
        unit: num(session.targetPaceLowSecondsPerKm) > 0 ? `/${units() === 'miles' ? 'mi' : 'km'}` : null,
        icon: 'timer',
        accent: PACE_ZONES[session.primaryZone] ? PACE_ZONES[session.primaryZone].color : 'var(--primary)',
      }),
    );

    const body = el('div', { class: 'stack-lg' });

    body.appendChild(el(
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
            background: `color-mix(in srgb, ${accent} 16%, transparent)`,
            color: accent,
          },
        },
        svgIcon(sessionIcon(typeKey(session)), 24),
      ),
      el(
        'div',
        { class: 'stack-sm', style: { gap: '6px', minWidth: '0' } },
        el('div', { class: 't-headline', text: titleFor(session) }),
        chips,
      ),
    ));

    if (session.sessionDescription) {
      body.appendChild(el('p', { class: 't-caption muted', style: { margin: '0' }, text: session.sessionDescription }));
    }

    body.appendChild(facts);

    // ── Steps: warm-up → set → rest → cool-down ────────────────────────────
    const steps = Array.isArray(session.steps) ? session.steps.slice() : [];
    if (steps.length) {
      steps.sort((a, b) => num(a.order) - num(b.order));
      const stepList = el('div', { class: 'section' });
      stepList.appendChild(sectionHeader('Session structure'));
      steps.forEach((step, index) => {
        // `step.zone` is a PaceZone *key*; components.stepRow() reads
        // `zone.title` and `zone.color`, so the lookup is passed as the
        // override and the raw key is left untouched.
        const zone = PACE_ZONES[step.zone] || null;
        stepList.appendChild(stepRowFor(step, zone, index === steps.length - 1, index));
      });
      body.appendChild(stepList);
    }

    if (session.coachTip) {
      body.appendChild(card(
        { class: 'section', fill: 'var(--sunken)' },
        sectionHeader("Coach's comment"),
        el('p', { class: 't-caption secondary-text', style: { margin: '0' }, text: session.coachTip }),
      ));
    }

    const node = sheet(
      {
        title: 'Workout',
        onClose: () => setTimeout(() => node.remove(), 600),
      },
      body,
    );
    node.open();
  }

  /* --------------------------------------------------------------- actions */

  function selectDay(date) {
    haptic(10);
    if (dayKey(date) === dayKey(selectedDay)) return;
    selectedDay = date;
    renderDay(false);
  }

  function stepMonth(delta) {
    monthDirection = delta;
    haptic(10);
    visibleMonth = addMonths(visibleMonth, delta);
    // A month change moves the selection to the 1st, exactly as the native
    // screen does, so the day list below never describes an off-screen day.
    selectedDay = new Date(visibleMonth);
    renderMonth(true);
    renderDay(true);
  }

  function jumpToToday() {
    monthDirection = startOfMonth(today) < visibleMonth ? -1 : 1;
    haptic(10);
    visibleMonth = startOfMonth(today);
    selectedDay = today;
    renderMonth(true);
    renderDay(true);
  }

  /* -------------------------------------------------------------- assembly */

  function renderMonth(animate) {
    const host = root.querySelector('[data-month-host]');
    if (!host) return;
    const buckets = sessionsByDay();
    const list = monthSessions(buckets);

    const completed = list.filter((session) => isSessionCompleted(state, session));
    const plannedMeters = list.reduce((sum, s) => sum + num(s.distanceMeters), 0);
    const completedMeters = completed.reduce((sum, s) => sum + num(s.distanceMeters), 0);

    host.textContent = '';

    // ── Month header ───────────────────────────────────────────────────────
    host.appendChild(el(
      'div',
      { class: 'row', style: { gap: '10px' } },
      monthNavButton('chevron-left', 'Previous month', () => stepMonth(-1)),
      el(
        'div',
        { class: 'stack-sm', style: { flex: '1 1 auto', textAlign: 'center', gap: '1px', minWidth: '0' } },
        el('div', { class: 't-headline truncate', text: monthTitle(visibleMonth) }),
        el('div', { class: 't-micro faint truncate', text: monthSubtitle(state, visibleMonth).toUpperCase() }),
      ),
      monthNavButton('chevron-right', 'Next month', () => stepMonth(1)),
    ));

    // ── Summary for the visible month ──────────────────────────────────────
    host.appendChild(el(
      'div',
      { class: 'grid-3' },
      statTile('Planned', formatDistance(plannedMeters, units()), {
        unit: units() === 'miles' ? 'mi' : 'km',
        icon: 'calendar',
        accent: 'var(--primary)',
      }),
      statTile('Completed', formatDistance(completedMeters, units()), {
        unit: units() === 'miles' ? 'mi' : 'km',
        icon: 'check',
        accent: 'var(--bright-green)',
      }),
      statTile('Sessions', `${completed.length}/${list.length}`, {
        icon: 'chart',
        accent: 'var(--info)',
      }),
    ));

    // ── Grid ───────────────────────────────────────────────────────────────
    const gridCard = card({ padding: 14, class: 'section' }, monthGrid(buckets));
    host.appendChild(gridCard);

    // ── Legend ─────────────────────────────────────────────────────────────
    host.appendChild(el(
      'div',
      { class: 'row-wrap', style: { gap: '14px' } },
      legendItem('var(--primary)', 'Today'),
      legendItem('var(--bright-green)', 'Completed'),
      legendItem('var(--text-faint)', 'Rest day'),
      el('span', { class: 'spacer' }),
      el('span', { class: 't-micro faint', text: 'TAP A DAY FOR ITS SESSIONS' }),
    ));

    if (animate && !firstPaint) animateGrid();
    firstPaint = false;
  }

  function renderDay(animate) {
    const host = root.querySelector('[data-day-host]');
    if (!host) return;
    host.textContent = '';
    const view = dayList(sessionsByDay());
    host.appendChild(view);
    if (animate) {
      animateNode(
        view,
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      );
    }
  }

  const todayButton = el('button', {
    type: 'button',
    class: 'section-header__action',
    text: 'Today',
    onclick: () => jumpToToday(),
  });
  todayButton.style.color = 'var(--primary)';

  const body = el(
    'div',
    { class: 'screen-body' },
    screenHeader({ title: 'Calendar', actions: [todayButton] }),
    el('div', { 'data-month-host': '', class: 'stack-lg' }),
    el('div', { 'data-day-host': '' }),
  );

  root.appendChild(body);
  renderMonth(false);
  renderDay(false);
}

/* ========================================================================== */
/* small builders                                                             */
/* ========================================================================== */

function monthNavButton(icon, label, onTap) {
  const button = el(
    'button',
    {
      type: 'button',
      class: 'btn-icon',
      'aria-label': label,
      onclick: onTap,
    },
    svgIcon(icon, 18),
  );
  button.style.background = 'var(--raised)';
  button.style.color = 'var(--text)';
  return button;
}

function legendItem(color, text) {
  return el(
    'span',
    { class: 'row-sm', style: { gap: '5px' } },
    el('span', { style: { width: '7px', height: '7px', borderRadius: '999px', background: color, flex: '0 0 auto' } }),
    el('span', { class: 't-micro faint', text: text.toUpperCase() }),
  );
}

/**
 * A step row with its pace zone resolved.
 *
 * `stepRow` reads `zone.title`, but a planned step carries the zone *key*, so
 * the resolved zone object is handed over as an override and the row keeps the
 * zone's own colour on its rail dot.
 */
function stepRowFor(step, zone, last, index) {
  return stepRow(step, {
    zone: zone || undefined,
    color: zone ? zone.color : 'var(--primary)',
    last,
    i: index,
  });
}
