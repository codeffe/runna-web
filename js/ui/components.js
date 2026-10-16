/**
 * components.js — DOM builders.
 *
 * Plain functions returning plain DOM nodes: no virtual DOM, no framework.
 * Every builder is deliberately forgiving about its arguments so screens can
 * call them in whichever style reads best:
 *
 *   card(el('div', { text: 'hi' }))
 *   card({ padding: 14 }, el('div', { text: 'hi' }))
 *   chip('Tempo', { color: 'var(--accent-tempo)', icon: 'timer' })
 *   chip({ text: 'Tempo', color: 'var(--accent-tempo)' })
 *
 * Builders that need behaviour (segmented, sheet, toast) still return a DOM
 * node — the behaviour is attached as extra properties on that node.
 *
 * Mirrors app/Runna/DesignSystem/Components.swift. All number formatting goes
 * through domain/format.js so a distance on a card and a distance in a chart
 * can never disagree.
 */

import {
  formatDuration,
  formatDistance,
  formatDistanceWithUnit,
  formatPace,
  formatPaceShort,
  weekdayShort,
} from '../domain/format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'circle', 'ellipse', 'rect',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'linearGradient',
  'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'filter', 'title',
]);

let uid = 0;
const nextId = (prefix) => `${prefix}-${(++uid).toString(36)}${Date.now().toString(36).slice(-3)}`;

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && (v.constructor === Object || v.constructor === undefined);

const isNode = (v) =>
  typeof Node !== 'undefined' && v instanceof Node;

const isArray = Array.isArray;

/** Flatten nested class arrays: ['card', ['stat-tile', false]] → 'card stat-tile'. */
function classList(value, out = []) {
  if (isArray(value)) {
    for (const item of value) classList(item, out);
  } else if (value) {
    out.push(String(value));
  }
  return out;
}

/* --------------------------------------------------------------------- el */

function applyStyle(node, style) {
  if (!style) return;
  if (typeof style === 'string') {
    node.setAttribute('style', style);
    return;
  }
  if (isPlainObject(style)) {
    for (const key of Object.keys(style)) {
      const value = style[key];
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('--')) node.style.setProperty(key, String(value));
      else node.style[key] = typeof value === 'number' && value !== 0 ? `${value}px` : String(value);
    }
  }
}

function appendChild(node, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (isArray(child)) {
    for (const c of child) appendChild(node, c);
    return;
  }
  if (isNode(child)) {
    node.appendChild(child);
    return;
  }
  node.appendChild(document.createTextNode(String(child)));
}

/**
 * Create an element.
 *
 * @param {string} tag
 * @param {object|Node|string|number|null} [props]
 *   `class`/`className` (string or array), `text`, `html`, `style` (object or
 *   string), `dataset`, `attrs`, `on` ({ event: handler }), any `on*` key,
 *   `ref` (fn), anything else becomes an attribute. A Node/string/number in
 *   this position is treated as the first child instead.
 * @param {...(Node|string|number|Array|null)} children
 * @returns {Element}
 */
export function el(tag, props, ...children) {
  const node = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  if (props !== null && props !== undefined) {
    if (isNode(props) || typeof props === 'string' || typeof props === 'number' || isArray(props)) {
      children.unshift(props);
    } else if (isPlainObject(props)) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value === null || value === undefined) continue;

        switch (key) {
          case 'class':
          case 'className': {
            const list = classList(value);
            if (list.length) node.setAttribute('class', list.join(' '));
            break;
          }
          case 'text':
            node.textContent = String(value);
            break;
          case 'html':
            node.innerHTML = String(value);
            break;
          case 'style':
            applyStyle(node, value);
            break;
          case 'dataset':
            for (const d of Object.keys(value)) {
              if (value[d] === null || value[d] === undefined) continue;
              node.dataset[d] = String(value[d]);
            }
            break;
          case 'attrs':
            for (const a of Object.keys(value)) {
              if (value[a] === null || value[a] === undefined || value[a] === false) continue;
              node.setAttribute(a, value[a] === true ? '' : String(value[a]));
            }
            break;
          case 'on':
            for (const evt of Object.keys(value)) {
              if (typeof value[evt] === 'function') node.addEventListener(evt, value[evt]);
            }
            break;
          case 'ref':
            if (typeof value === 'function') value(node);
            break;
          default:
            if (key.startsWith('on') && typeof value === 'function') {
              node.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (value === true) {
              node.setAttribute(key, '');
            } else if (value === false) {
              /* skip */
            } else if (SVG_TAGS.has(tag) && (key === 'width' || key === 'height') && value === 'auto') {
              // SVG geometry attributes only take lengths; "auto" is a CSS
              // value and makes the parser log an error. Send it to CSS, where
              // it means what the caller intended.
              node.style[key] = 'auto';
            } else {
              node.setAttribute(key, String(value));
            }
        }
      }
    }
  }

  for (const child of children) appendChild(node, child);
  return node;
}

/** DocumentFragment from a list of children. */
export function frag(...children) {
  const f = document.createDocumentFragment();
  for (const c of children) appendChild(f, c);
  return f;
}

/** Replace an element's children in one shot. */
export function fill(node, ...children) {
  if (!node) return node;
  node.textContent = '';
  for (const c of children) appendChild(node, c);
  return node;
}

/* ------------------------------------------------------------------- icons */

/**
 * `<svg class="icon"><use href="#icon-run"></use></svg>`
 * `name` may be given with or without the `icon-` prefix and leading `#`.
 */
export function svgIcon(name, size = 20, opts = {}) {
  const id = `#icon-${String(name).replace(/^#/, '').replace(/^icon-/, '')}`;
  const svg = el('svg', {
    class: opts.class ? `icon ${opts.class}` : 'icon',
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    focusable: 'false',
    'aria-hidden': opts.label ? null : 'true',
  });
  if (opts.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label);
  }
  const use = el('use', { href: id });
  use.setAttributeNS(XLINK_NS, 'xlink:href', id);
  svg.appendChild(use);
  if (opts.style) applyStyle(svg, opts.style);
  return svg;
}

/**
 * Make bare `<svg><use href="#icon-x"></use></svg>` markup written by a screen
 * behave like svgIcon() output: correct box, hidden from assistive tech.
 * app.js calls this after every render.
 */
export function hydrateIcons(root = document) {
  if (!root || !root.querySelectorAll) return root;
  const list = root.querySelectorAll('svg > use');
  for (const use of list) {
    const svg = use.parentElement;
    if (!svg || svg.classList.contains('icon')) continue;
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 24 24');
  }
  return root;
}

/* ---------------------------------------------------------------- palettes */

/**
 * Session-type accents from the live iOS client, keyed by normalised run-type
 * name so 'easyRun', 'easy_run' and 'Easy Run' all resolve. Colours match
 * RunType.accent in js/engine/enums.js.
 */
export const RUN_TYPES = {
  easyrun: { icon: 'run', color: 'var(--accent-easy-run)', label: 'Easy Run', isQuality: false },
  longrun: { icon: 'route', color: 'var(--accent-long-run)', label: 'Long Run', isQuality: false },
  tempo: { icon: 'timer', color: 'var(--accent-tempo)', label: 'Tempo Run', isQuality: true },
  intervals: { icon: 'bolt', color: 'var(--accent-intervals)', label: 'Intervals', isQuality: true },
  interval: { icon: 'bolt', color: 'var(--accent-intervals)', label: 'Intervals', isQuality: true },
  hills: { icon: 'mountain', color: 'var(--accent-hills)', label: 'Hill Reps', isQuality: true },
  hill: { icon: 'mountain', color: 'var(--accent-hills)', label: 'Hill Reps', isQuality: true },
  progression: { icon: 'chart', color: 'var(--accent-progression)', label: 'Progression Run', isQuality: true },
  timetrial: { icon: 'trophy', color: 'var(--accent-time-trial)', label: 'Time Trial', isQuality: true },
  race: { icon: 'flag', color: 'var(--accent-race)', label: 'Race Day', isQuality: true },
  recovery: { icon: 'leaf', color: 'var(--accent-recovery)', label: 'Recovery Run', isQuality: false },
  strength: { icon: 'dumbbell', color: 'var(--accent-strength)', label: 'Strength', isQuality: false },
  crosstraining: { icon: 'heart', color: 'var(--info)', label: 'Cross Training', isQuality: false },
  mobility: { icon: 'activity', color: 'var(--success)', label: 'Mobility', isQuality: false },
  rest: { icon: 'moon', color: 'var(--accent-rest)', label: 'Rest Day', isQuality: false },
};

/** The RUN_TYPES entry for a run type, or null. */
export function runTypeMeta(runType) {
  return RUN_TYPES[runTypeKey(runType)] || null;
}

/** True for quality sessions (tempo, intervals, hills, progression, race). */
export function isQualityRunType(runType) {
  if (runType && typeof runType === 'object' && runType.isQuality !== undefined) {
    return !!runType.isQuality;
  }
  const meta = RUN_TYPES[runTypeKey(runType)];
  return !!(meta && meta.isQuality);
}

/** Normalise a run type that may be a string or an object from the engine. */
export function runTypeKey(runType) {
  const raw = typeof runType === 'string'
    ? runType
    : (runType && (runType.key || runType.id || runType.name || runType.rawValue || runType.title)) || '';
  return String(raw).toLowerCase().replace(/[^a-z]/g, '');
}

/** CSS colour for a session type. */
export function sessionAccent(runType) {
  if (runType && typeof runType === 'object') {
    if (runType.accent) return runType.accent;
    if (runType.color) return runType.color;
  }
  const meta = RUN_TYPES[runTypeKey(runType)];
  return meta ? meta.color : 'var(--primary)';
}

/** Sprite icon name for a session type. */
export function sessionIcon(runType) {
  if (runType && typeof runType === 'object' && runType.icon) return runType.icon;
  const meta = RUN_TYPES[runTypeKey(runType)];
  return meta ? meta.icon : 'run';
}

/** Human title for a session type. */
export function sessionTypeLabel(runType) {
  if (runType && typeof runType === 'object') {
    if (runType.title) return runType.title;
    if (runType.label) return runType.label;
  }
  const meta = RUN_TYPES[runTypeKey(runType)];
  return meta ? meta.label : String(runType || 'Run');
}

/* --------------------------------------------------------------- formatting */
/* Thin aliases over domain/format.js — the canonical Fmt port from Theme.swift.
   They are re-exported here so a screen can pull everything it needs from one
   module, and so no two parts of the UI can format the same number differently. */

export const fmtDuration = formatDuration;
export const fmtDistance = formatDistance;

/** "5:43" — no unit suffix. */
export function fmtPace(secondsPerKm, units = 'kilometers') {
  return formatPaceShort(secondsPerKm, units);
}

/** "5:43–6:31 /km" — the pace band a quality session is run in. */
export function fmtPaceRange(fastSecondsPerKm, slowSecondsPerKm, units = 'kilometers') {
  const fast = Number(fastSecondsPerKm);
  const slow = Number(slowSecondsPerKm);
  if (!Number.isFinite(fast) || fast <= 0) return '';
  if (!Number.isFinite(slow) || slow <= 0 || slow === fast) return formatPace(fast, units);
  // Low seconds-per-km is the FASTER end: show fast–slow.
  const lo = Math.min(fast, slow);
  const hi = Math.max(fast, slow);
  return `${formatPaceShort(lo, units)}–${formatPace(hi, units)}`;
}

export function unitSuffix(units) {
  return units === 'miles' ? 'mi' : 'km';
}

/** Day key without time — the currency of every date comparison in the app. */
export function dayKey(date) {
  const d = toDate(date);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function weekdayUpper(date) {
  const d = toDate(date);
  if (!d) return '';
  return weekdayShort(d).toUpperCase();
}

function isToday(date) {
  return dayKey(date) === dayKey(new Date());
}

/* -------------------------------------------------------------------- card */

/**
 * The lit-surface card from Theme.swift's CardBackground: gradient fill, a
 * 1px edge-light gradient border, one soft shadow.
 *
 * @param {object} [opts] { padding, radius, fill, class, style, tappable,
 *                          onTap, i, id, dataset }
 * @param {...(Node|string)} children
 */
export function card(opts, ...children) {
  if (!isPlainObject(opts)) {
    if (opts !== null && opts !== undefined) children.unshift(opts);
    opts = {};
  }
  const {
    padding, radius, fill, class: klass, style, tappable, onTap, i, id, dataset, ...rest
  } = opts;

  const node = el('div', {
    class: ['card', klass],
    id,
    dataset,
  });

  if (padding !== undefined) node.style.padding = typeof padding === 'number' ? `${padding}px` : padding;
  if (radius !== undefined) node.style.borderRadius = typeof radius === 'number' ? `${radius}px` : radius;
  if (fill !== undefined) {
    const value = typeof fill === 'string' && CSS_SUITS_COLOR_MIX && fill.startsWith('var(')
      ? `linear-gradient(${fill}, color-mix(in srgb, ${fill} 82%, transparent))`
      : fill;
    node.style.background = value;
  }
  if (style) applyStyle(node, style);
  if (i !== undefined) node.style.setProperty('--i', String(i));
  for (const key of Object.keys(rest)) {
    if (rest[key] === null || rest[key] === undefined || rest[key] === false) continue;
    node.setAttribute(key, rest[key] === true ? '' : String(rest[key]));
  }

  for (const child of children) appendChild(node, child);

  if (tappable || onTap) {
    node.classList.add('card--tappable');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    if (typeof onTap === 'function') {
      node.addEventListener('click', (event) => {
        hapticTap();
        onTap(event);
      });
    }
  }
  return node;
}

// color-mix() is the brief's requirement for the card fill; if the browser
// can't parse it the plain --surface fallback already in CSS stands.
const CSS_SUITS_COLOR_MIX =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('background', 'color-mix(in srgb, red 82%, transparent)')
    : true;

function hapticTap() {
  try {
    if (navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10);
  } catch {
    /* haptics are optional */
  }
}

/** Tappable wrapper for any node: adds press feedback + a click handler. */
export function tappable(node, onTap, opts = {}) {
  if (!node) return node;
  node.style.cursor = 'pointer';
  const scaleClass = opts.class || 'card--tappable';
  node.classList.add(scaleClass);
  if (onTap) node.addEventListener('click', onTap);
  return node;
}

/* ------------------------------------------------------------- session row */

/**
 * One row of a plan / activity list.
 *
 * Accepts a PlannedSession-ish object and reads it defensively, because the
 * engine's exact shape is not fixed:
 *   id, date, runType | type | sessionType, runTitle | title,
 *   distanceMeters | distanceKm | distance, durationSeconds | duration,
 *   paceRangeText | paceText, isCompleted | completed, isToday
 *
 * @param {object} session
 * @param {object} [opts] { units, showWeekday, onTap, i, completed, trailing,
 *                          format:{distance,duration} }
 */
export function sessionRow(session = {}, opts = {}) {
  const {
    units = 'kilometers',
    showWeekday = true,
    onTap,
    i,
    trailing,
    format = {},
  } = opts;

  const runType = session.runType || session.sessionType || session.type || 'easyRun';
  const accent = sessionAccent(runType);
  const completed = opts.completed !== undefined
    ? !!opts.completed
    : !!(session.isCompleted || session.completed || session.done);
  const today = session.isToday !== undefined ? !!session.isToday : isToday(session.date);

  const title = session.runTitle || session.title || session.name || sessionTypeLabel(runType);

  let meters = Number(session.distanceMeters);
  if (!Number.isFinite(meters)) meters = Number(session.distanceKm) * 1000;
  if (!Number.isFinite(meters)) meters = Number(session.distance) * 1000;
  if (!Number.isFinite(meters)) meters = 0;

  let seconds = Number(session.durationSeconds);
  if (!Number.isFinite(seconds)) seconds = Number(session.duration) || 0;

  const paceText = session.paceRangeText
    || session.paceText
    || (session.targetPaceLowSecondsPerKm || session.targetPaceHighSecondsPerKm
      ? fmtPaceRange(
          session.targetPaceLowSecondsPerKm,
          session.targetPaceHighSecondsPerKm,
          units,
        )
      : '');

  const distanceText = format.distance
    ? format.distance(meters)
    : formatDistanceWithUnit(meters, units);
  const durationText = format.duration ? format.duration(seconds) : formatDuration(seconds);

  const meta = el('div', { class: 'session-row__meta' });
  if (meters > 0) meta.appendChild(el('span', { text: distanceText }));
  if (seconds > 0) meta.appendChild(el('span', { text: durationText }));
  // Pace only for quality work, matching SessionRow in the native app.
  if (paceText && isQualityRunType(runType)) {
    meta.appendChild(el('span', { class: 'session-row__pace', text: String(paceText) }));
  }

  const titleRow = el('div', { class: 'session-row__title' });
  if (showWeekday && session.date) {
    titleRow.appendChild(el('span', { class: 'session-row__weekday', text: weekdayUpper(session.date) }));
  }
  titleRow.appendChild(el('span', { class: 'truncate', text: String(title) }));

  let trailingNode = trailing;
  if (!trailingNode) {
    if (completed) {
      trailingNode = svgIcon('check-circle', 22);
      trailingNode.style.color = 'var(--primary)';
    } else if (today) {
      trailingNode = el('span', { class: 'badge-today', text: 'TODAY' });
    } else {
      trailingNode = svgIcon('chevron-right', 14);
    }
  }

  const row = el(
    'div',
    {
      class: ['session-row', completed && 'is-completed', today && 'is-today', (onTap || opts.tappable) && 'session-row--tappable'],
      style: { '--accent': accent },
      dataset: { sessionId: session.id || '' },
    },
    el('div', { class: 'session-row__icon' }, svgIcon(sessionIcon(runType), 22)),
    el('div', { class: 'session-row__main' }, titleRow, meta),
    el('div', { class: 'session-row__trailing' }, trailingNode),
  );

  if (i !== undefined) row.style.setProperty('--i', String(i));
  if (onTap || opts.tappable) {
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    if (typeof onTap === 'function') {
      row.addEventListener('click', (event) => {
        hapticTap();
        onTap(event, session);
      });
    }
  }
  return row;
}

/* -------------------------------------------------------------------- chip */

/**
 * chip('Tempo', { color, icon, filled, onTap }) or chip({ text, ... }).
 */
export function chip(text, opts = {}) {
  let label = text;
  let options = opts;
  if (isPlainObject(text)) {
    options = text;
    label = options.text || options.label || '';
  }
  const {
    color, icon, filled, outline, neutral, class: klass, style, onTap, i,
  } = options;

  const node = el('span', {
    class: ['chip', filled && 'chip--filled', outline && 'chip--outline', neutral && 'chip--neutral', klass],
    style: { '--chip-color': color || undefined, ...(isPlainObject(style) ? style : {}) },
  });
  if (typeof style === 'string') node.setAttribute('style', style);
  if (icon) node.appendChild(svgIcon(icon, 12));
  node.appendChild(el('span', { text: String(label) }));
  if (i !== undefined) node.style.setProperty('--i', String(i));
  if (onTap) {
    node.setAttribute('role', 'button');
    node.addEventListener('click', (event) => {
      hapticTap();
      onTap(event);
    });
  }
  return node;
}

/** Pace pill: coloured dot + zone name + value (Components.swift → PacePill). */
export function pacePill(zone, value, opts = {}) {
  return el(
    'span',
    { class: ['pace-pill', opts.class], style: { '--chip-color': opts.color || 'var(--primary)' } },
    el('span', { class: 'pace-pill__dot' }),
    el('span', { class: 'pace-pill__label', text: String(zone || '') }),
    el('span', { text: String(value || '') }),
  );
}

/* --------------------------------------------------------------- stat tile */

/**
 * statTile('Distance', '5.00', { unit: 'km', icon: 'shoe', accent })
 * or statTile({ title, value, unit, icon, accent, caption, i })
 */
export function statTile(title, value, opts = {}) {
  let t = title;
  let v = value;
  let options = opts;
  if (isPlainObject(title)) {
    options = title;
    t = options.title || options.label || '';
    v = options.value;
  }
  const {
    unit, icon, accent, caption, class: klass, style, i, onTap,
  } = options;

  const head = el('div', { class: 'stat-tile__head' });
  if (icon) head.appendChild(svgIcon(icon, 12));
  head.appendChild(el('span', { class: 'stat-tile__label', text: String(t) }));

  const valueRow = el(
    'div',
    { class: 'stat-tile__value-row' },
    el('span', { class: 'stat-tile__value', text: v === undefined || v === null ? '—' : String(v) }),
    unit ? el('span', { class: 'stat-tile__unit', text: String(unit) }) : null,
  );

  const node = card(
    {
      class: ['stat-tile', klass],
      padding: 14,
      style: { '--tile-accent': accent || undefined, ...(isPlainObject(style) ? style : {}) },
      onTap,
      i,
    },
    head,
    valueRow,
    caption ? el('div', { class: 'stat-tile__caption', text: String(caption) }) : null,
  );
  if (typeof style === 'string') node.setAttribute('style', style);
  return node;
}

/* -------------------------------------------------------------------- ring */

/**
 * Progress ring. The fill is an SVG circle whose stroke-dashoffset is driven
 * by --p, so motion.ringProgress(el, 0.62) animates it.
 *
 * @param {object} opts { value 0…1, size, lineWidth, color, label, caption,
 *                        track, i, animate }
 */
export function ring(opts = {}) {
  const {
    value = 0,
    progress,
    size = 84,
    lineWidth = 9,
    color = 'var(--primary)',
    track,
    label,
    caption,
    i,
    animate = true,
    class: klass,
  } = opts;

  const p = clamp01(value !== undefined ? value : progress);
  const gradId = nextId('ringgrad');
  // stroke-width lives in viewBox units (100 across), so convert px → units.
  const widthUnits = Math.max(2, Math.min(12, (Number(lineWidth) / Number(size)) * 100));
  const labelSize = Math.max(13, Math.round(Number(size) * 0.26));

  const svg = el('svg', { class: 'ring-svg', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
  const defs = el('defs');
  const grad = el('linearGradient', { id: gradId, x1: '0', y1: '1', x2: '1', y2: '0' });
  grad.appendChild(el('stop', { offset: '0' }));
  grad.appendChild(el('stop', { offset: '1' }));
  defs.appendChild(grad);
  svg.appendChild(defs);
  svg.appendChild(el('circle', { class: 'ring-track', cx: 50, cy: 50, r: 45 }));
  svg.appendChild(el('circle', { class: 'ring-fill', cx: 50, cy: 50, r: 45, stroke: `url(#${gradId})` }));

  const center = el('div', { class: 'ring-center' });
  if (label !== undefined && label !== null && label !== '') {
    center.appendChild(el('span', { class: 'ring-center__value', text: String(label) }));
  }
  if (caption) center.appendChild(el('span', { class: 'ring-center__caption', text: String(caption) }));

  const node = el(
    'div',
    {
      class: ['ring', klass],
      style: {
        '--ring-size': `${size}px`,
        '--ring-width': String(widthUnits),
        '--ring-color': color,
        '--ring-track-color': track || undefined,
        '--ring-label-size': `${labelSize}px`,
        '--p': animate ? '0' : String(p),
        '--i': i,
      },
      role: 'img',
      'aria-label': opts.ariaLabel || `${Math.round(p * 100)} percent`,
    },
    svg,
    center,
  );

  node.dataset.value = String(p);
  /** Set the fill directly on this ring. */
  node.setProgress = (next) => {
    const np = clamp01(next);
    node.dataset.value = String(np);
    node.style.setProperty('--p', String(np));
    node.setAttribute('aria-label', `${Math.round(np * 100)} percent`);
    return np;
  };

  if (animate && p > 0) {
    afterPaint(() => node.style.setProperty('--p', String(p)));
  }
  return node;
}

/* ------------------------------------------------------------------- meter */

/**
 * Linear progress meter. Animates with transform: scaleX(--p) — never width.
 *
 * @param {object} opts { value, max, label, color, height, showValue, caption }
 */
export function meter(opts = {}) {
  const {
    value = 0,
    max = 1,
    label,
    color = 'var(--primary)',
    height = 8,
    showValue = false,
    caption,
    i,
    animate = true,
    class: klass,
    format,
  } = opts;

  const m = Number(max) > 0 ? Number(max) : 1;
  const p = clamp01(Number(value) / m);

  const valueText = typeof format === 'function'
    ? format(Number(value), m)
    : `${Math.round(p * 100)}%`;

  const head = el('div', { class: 'meter__head' });
  if (label) head.appendChild(el('span', { class: 'meter__label', text: String(label) }));
  if (showValue) head.appendChild(el('span', { class: 'meter__value', text: valueText, attrs: { 'data-meter-value': '' } }));

  const track = el('div', { class: 'meter__track' }, el('div', { class: 'meter__fill' }));

  const node = el(
    'div',
    {
      class: ['meter', klass],
      style: {
        '--meter-color': color,
        '--meter-height': `${height}px`,
        '--p': animate ? '0' : String(p),
        '--i': i,
      },
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': String(m),
      'aria-valuenow': String(Number(value) || 0),
    },
    (label || showValue) ? head : null,
    track,
    caption ? el('div', { class: 'meter__caption stat-tile__caption', text: String(caption) }) : null,
  );

  node.dataset.value = String(p);
  node.setProgress = (next, nextMax) => {
    const mm = Number(nextMax) > 0 ? Number(nextMax) : m;
    const np = clamp01(Number(next) / mm);
    node.dataset.value = String(np);
    node.style.setProperty('--p', String(np));
    node.setAttribute('aria-valuenow', String(Number(next) || 0));
    const readout = node.querySelector('[data-meter-value]');
    if (readout) readout.textContent = typeof format === 'function' ? format(Number(next), mm) : `${Math.round(np * 100)}%`;
    return np;
  };
  if (showValue && format) {
    const readout = node.querySelector('[data-meter-value]');
    if (readout) readout.textContent = format(Number(value), m);
  }

  if (animate && p > 0) {
    afterPaint(() => node.style.setProperty('--p', String(p)));
  }
  return node;
}

/** Alias — some screens will reach for this name. */
export const progressBar = meter;

/* --------------------------------------------------------------- segmented */

/**
 * Segmented control with a thumb that slides on transform.
 *
 * @param {Array<string|{value,label}>} options
 * @param {object} [opts] { value, onChange, quiet, i }
 * @returns {HTMLElement} node with `.value`, `.setValue(v, silent)`
 */
export function segmented(options = [], opts = {}) {
  const items = options.map((o) => (isPlainObject(o) ? o : { value: o, label: String(o) }));
  let current = opts.value !== undefined ? opts.value : (items[0] && items[0].value);
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

  const count = Math.max(1, items.length);
  const index = Math.max(0, items.findIndex((it) => it.value === current));

  const thumb = el('div', { class: 'segmented__thumb', 'aria-hidden': 'true' });
  const buttons = items.map((item, idx) => el('button', {
    type: 'button',
    class: ['segmented__item', idx === index && 'is-active'],
    role: 'tab',
    'aria-selected': idx === index ? 'true' : 'false',
    dataset: { index: idx, value: String(item.value) },
    text: String(item.label !== undefined ? item.label : item.value),
  }));

  const node = el(
    'div',
    {
      class: ['segmented', opts.quiet && 'segmented--quiet', opts.class],
      style: {
        '--seg-count': String(count),
        '--seg-index': String(index),
        '--i': opts.i,
      },
      role: 'tablist',
    },
    thumb,
    ...buttons,
  );

  function select(value, silent) {
    const idx = items.findIndex((it) => it.value === value || String(it.value) === String(value));
    if (idx < 0) return current;
    current = items[idx].value;
    node.value = current;
    node.dataset.value = String(current);
    node.style.setProperty('--seg-index', String(idx));
    buttons.forEach((b, i) => {
      b.classList.toggle('is-active', i === idx);
      b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    if (!silent && onChange) onChange(current, idx);
    return current;
  }

  node.addEventListener('click', (event) => {
    const button = event.target.closest('.segmented__item');
    if (!button || !node.contains(button)) return;
    hapticTap();
    select(button.dataset.value);
  });

  node.value = current;
  node.setValue = select;
  node.options = items;
  node.dataset.value = String(current);
  return node;
}

/* ------------------------------------------------------------------- sheet */

/**
 * Bottom sheet: slides up on transform, with a grabber, a backdrop, drag-to-
 * dismiss and Escape-to-close.
 *
 * @param {object} [opts] { title, closeLabel, footer, onClose, class, bare }
 * @param {...Node} children  body content
 * @returns {HTMLElement} node with `.open()`, `.close()`, `.isOpen`, `.body`,
 *                        `.footer`, `.panel`
 */
export function sheet(opts = {}, ...children) {
  const { title, footer, onClose, class: klass } = opts;

  const grabber = el('div', { class: 'sheet__grabber' });
  const header = el(
    'div',
    { class: 'sheet__header' },
    el('div', { class: 'sheet__title', text: title ? String(title) : '' }),
    el('button', {
      type: 'button',
      class: 'btn-icon',
      'aria-label': 'Close',
      onclick: () => close(),
    }, svgIcon('close', 18)),
  );
  if (!title) header.style.display = 'none';

  const body = el('div', { class: 'sheet__body' });
  for (const child of children) appendChild(body, child);

  const footerNode = el('div', { class: 'sheet__footer' });
  if (footer) appendChild(footerNode, footer);

  const panel = el(
    'div',
    { class: ['sheet', klass], role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Sheet' },
    grabber,
    header,
    body,
    footer ? footerNode : null,
  );

  const backdrop = el('div', { class: 'sheet-backdrop' });
  const root = el('div', { class: 'sheet-root', hidden: true }, backdrop, panel);
  document.body.appendChild(root);

  let open = false;
  let lastFocus = null;

  function lockScroll(lock) {
    if (lock) {
      root.dataset.prevOverflow = document.body.style.overflow || '';
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = root.dataset.prevOverflow || '';
      delete root.dataset.prevOverflow;
    }
  }

  function openSheet() {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    root.hidden = false;
    lockScroll(true);
    requestAnimationFrame(() => root.classList.add('is-open'));
    panel.focus?.({ preventScroll: true });
    document.addEventListener('keydown', onKey);
  }

  function close() {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    lockScroll(false);
    document.removeEventListener('keydown', onKey);
    const finish = () => {
      if (!open) root.hidden = true;
    };
    panel.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 500);
    if (typeof onClose === 'function') onClose();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  backdrop.addEventListener('click', close);

  /* Drag the grabber/header down to dismiss — transform only. */
  let startY = 0;
  let dy = 0;
  let dragging = false;

  function onDown(event) {
    if (!event.target.closest('.sheet__grabber, .sheet__header')) return;
    dragging = true;
    startY = event.clientY;
    dy = 0;
    panel.style.transition = 'none';
    panel.setPointerCapture?.(event.pointerId);
  }
  function onMove(event) {
    if (!dragging) return;
    dy = Math.max(0, event.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) close();
  }

  panel.addEventListener('pointerdown', onDown);
  panel.addEventListener('pointermove', onMove);
  panel.addEventListener('pointerup', onUp);
  panel.addEventListener('pointercancel', onUp);

  root.open = openSheet;
  root.close = close;
  root.panel = panel;
  root.body = body;
  root.footer = footerNode;
  Object.defineProperty(root, 'isOpen', { get: () => open });
  root.setTitle = (text) => {
    header.style.display = text ? '' : 'none';
    header.firstChild.textContent = text ? String(text) : '';
  };
  return root;
}

/* ------------------------------------------------------------------- toast */

let toastLayer = null;
let toastTimer = 0;

function ensureToastLayer() {
  const bare = !document.querySelector('.tabbar');
  if (toastLayer && toastLayer.isConnected && toastLayer.classList.contains('toast-layer--bare') === bare) {
    return toastLayer;
  }
  toastLayer = el('div', { class: ['toast-layer', bare && 'toast-layer--bare'], 'aria-live': 'polite' });
  document.body.appendChild(toastLayer);
  return toastLayer;
}

/**
 * Show a transient message. Self-mounting: it appends itself and cleans up.
 *
 * @param {string|object} message
 * @param {object} [opts] { duration, icon, tone: 'default'|'success'|'danger'|'warning' }
 * @returns {HTMLElement} node with `.dismiss()`
 */
export function toast(message, opts = {}) {
  let text = message;
  let options = opts;
  if (isPlainObject(message)) {
    options = message;
    text = options.text || options.message || '';
  }
  const {
    duration = 2200,
    icon,
    tone = 'default',
  } = options;

  const layer = ensureToastLayer();
  const node = el(
    'div',
    { class: ['toast', tone !== 'default' && `toast--${tone}`], role: 'status' },
    icon ? el('span', { class: 'toast__icon' }, svgIcon(icon, 18)) : null,
    el('span', { text: String(text) }),
  );
  layer.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 400);
  };

  node.dismiss = dismiss;
  if (toastTimer) clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(dismiss, duration);
  return node;
}

/* ----------------------------------------------------------- screen header */

/**
 * screenHeader({ title, subtitle, eyebrow, back, onBack, action, actions,
 *                compact })
 */
export function screenHeader(opts = {}) {
  const {
    title, subtitle, eyebrow, back, onBack, action, actions, compact, class: klass, id,
  } = opts;

  const node = el('header', {
    class: ['screen-header', compact && 'screen-header--compact', klass],
    id,
  });

  let main = null;

  if (back) {
    const label = typeof back === 'string' ? back : 'Back';
    node.appendChild(el(
      'button',
      {
        type: 'button',
        class: 'back-button',
        onclick: (event) => {
          hapticTap();
          if (typeof onBack === 'function') onBack(event);
          else if (typeof history !== 'undefined') history.back();
        },
      },
      svgIcon('chevron-left', 20),
      el('span', { text: label }),
    ));
  }

  if (title || subtitle || eyebrow) {
    main = el(
      'div',
      { class: 'screen-header__main' },
      eyebrow ? el('div', { class: 'screen-header__eyebrow', text: String(eyebrow) }) : null,
      title ? el('h1', { class: 'screen-header__title', text: String(title) }) : null,
      subtitle ? el('div', { class: 'screen-header__subtitle', text: String(subtitle) }) : null,
    );
    node.appendChild(main);
  } else {
    node.appendChild(el('div', { class: 'screen-header__main' }));
  }

  const actionsNode = el('div', { class: 'screen-header__actions' });
  if (Array.isArray(actions)) for (const a of actions) appendChild(actionsNode, a);
  if (action && action.label) {
    actionsNode.appendChild(el('button', {
      type: 'button',
      class: ['section-header__action', action.class],
      onclick: (event) => {
        hapticTap();
        if (typeof action.onTap === 'function') action.onTap(event);
      },
      text: String(action.label),
    }));
  }
  if (actionsNode.childNodes.length) node.appendChild(actionsNode);

  node.main = main;
  return node;
}

/** Section header inside a screen body. */
export function sectionHeader(title, opts = {}) {
  let t = title;
  let options = opts;
  if (isPlainObject(title)) {
    options = title;
    t = options.title || '';
  }
  const { action, onAction, class: klass } = options;
  const node = el(
    'div',
    { class: ['section-header', klass] },
    el('span', { class: 'section-header__title', text: String(t) }),
  );
  if (action) {
    node.appendChild(el('button', {
      type: 'button',
      class: 'section-header__action',
      text: String(action),
      onclick: (event) => {
        hapticTap();
        if (typeof onAction === 'function') onAction(event);
      },
    }));
  }
  return node;
}

/* ------------------------------------------------------------- empty state */

/**
 * emptyState({ icon, title, message, actionTitle, onAction })
 */
export function emptyState(opts = {}) {
  const {
    icon = 'run', title, message, actionTitle, onAction, class: klass,
  } = opts;

  const node = el(
    'div',
    { class: ['empty-state', klass] },
    el('div', { class: 'empty-state__icon' }, svgIcon(icon, 42)),
    title ? el('div', { class: 'empty-state__title', text: String(title) }) : null,
    message ? el('p', { class: 'empty-state__message', text: String(message) }) : null,
  );

  if (actionTitle) {
    node.appendChild(el(
      'div',
      { class: 'empty-state__action' },
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: String(actionTitle),
        onclick: (event) => {
          hapticTap();
          if (typeof onAction === 'function') onAction(event);
        },
      }),
    ));
  }
  return node;
}

/* ------------------------------------------------------------- plan shield */

/**
 * The hexagon-ish shield from Components.swift → ShieldShape, as inline SVG.
 *
 * @param {string} iconText  e.g. '5K', 'HM', 'M'
 * @param {string} [color]   CSS colour, default var(--primary)
 * @param {number} [size]    px, default 64
 */
export function planShield(iconText, color = 'var(--primary)', size = 64) {
  const gradId = nextId('shieldgrad');
  const s = Number(size) || 64;

  const svg = el('svg', {
    class: 'plan-shield',
    viewBox: '0 0 100 100',
    width: s,
    height: s,
    style: { color, width: `${s}px`, height: `${s}px` },
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const defs = el('defs');
  const grad = el('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '1', y2: '1' });
  const stopA = el('stop', { offset: '0' });
  stopA.setAttribute('stop-color', 'currentColor');
  stopA.setAttribute('stop-opacity', '0.85');
  const stopB = el('stop', { offset: '1' });
  stopB.setAttribute('stop-color', 'currentColor');
  grad.appendChild(stopA);
  grad.appendChild(stopB);
  defs.appendChild(grad);
  svg.appendChild(defs);

  // ShieldShape.path(in:) with w = h = 100, corner = 16.
  const SHIELD_PATH = 'M16 0 H84 Q100 0 100 16 V55 Q88 88 50 100 Q12 88 0 55 V16 Q0 0 16 0 Z';
  svg.appendChild(el('path', { d: SHIELD_PATH, fill: `url(#${gradId})` }));
  svg.appendChild(el('path', {
    d: SHIELD_PATH,
    fill: 'none',
    stroke: '#ffffff',
    'stroke-opacity': '0.28',
    'stroke-width': '2',
  }));

  if (iconText !== undefined && iconText !== null && iconText !== '') {
    const text = el('text', {
      x: '50',
      y: '40',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': '30',
      'font-weight': '900',
      class: 'plan-shield__text',
      text: String(iconText),
    });
    svg.appendChild(text);
  }

  const glyph = el('use', { href: '#icon-run', x: '41', y: '55', width: '18', height: '18' });
  glyph.setAttributeNS(XLINK_NS, 'xlink:href', '#icon-run');
  glyph.setAttribute('style', 'color:#fff;opacity:.9');
  svg.appendChild(glyph);

  return svg;
}

/* -------------------------------------------------------------- small bits */

/** A shimmering placeholder block. */
export function skeleton(opts = {}) {
  if (typeof opts === 'number') return el('div', { class: 'skeleton', style: { height: `${opts}px` } });
  const { height, width, radius, class: klass } = opts;
  const node = el('div', { class: ['skeleton', klass] });
  if (height !== undefined) node.style.height = typeof height === 'number' ? `${height}px` : height;
  if (width !== undefined) node.style.width = typeof width === 'number' ? `${width}px` : width;
  if (radius !== undefined) node.style.borderRadius = typeof radius === 'number' ? `${radius}px` : radius;
  return node;
}

/** The "recording" dot. Holds steady under reduce-motion (see app.css). */
export function pulseDot(opts = {}) {
  const { color = 'var(--bright-green)', size = 8, class: klass } = opts;
  return el('span', {
    class: ['pulse-dot', klass],
    style: { '--pulse-color': color, '--pulse-size': `${size}px` },
    'aria-hidden': 'true',
  });
}

/** A hairline rule. */
export function divider(opts = {}) {
  return el('div', { class: ['divider', opts.inset && 'divider-inset', opts.class], role: 'presentation' });
}

/**
 * Mini bar chart (Components.swift → MiniBarChart).
 *
 * @param {Array<{label,value,color?}>} entries
 * @param {object} [opts] { height, color }
 */
export function bars(entries = [], opts = {}) {
  const { height = 130, color = 'var(--primary)', class: klass } = opts;
  const max = Math.max(1, ...entries.map((e) => Number(e.value) || 0));

  const chart = el('div', { class: ['bars', klass], style: { '--bars-height': `${height}px` } });
  const labels = el('div', { class: 'bars-labels' });

  for (const entry of entries) {
    const value = Number(entry.value) || 0;
    const h = entry.empty || value <= 0 ? 0 : Math.max(4, (value / max) * 100);
    const fill = el('div', {
      class: ['bars__fill', h === 0 && 'bars__fill--muted'],
      style: {
        '--h': `${h}%`,
        '--bar-color': entry.color || color,
        '--p': '0',
      },
      attrs: { title: `${entry.label}: ${value}` },
    });
    chart.appendChild(el('div', { class: 'bars__col' }, fill));
    labels.appendChild(el('span', { text: String(entry.label) }));
  }

  const node = el('div', {}, chart, labels);
  node.chart = chart;
  node.labels = labels;
  afterPaint(() => {
    for (const fill of chart.querySelectorAll('.bars__fill')) fill.style.setProperty('--p', '1');
  });
  return node;
}

/**
 * Step timeline row (Components.swift → StepRow).
 * step: { label, prescription | value, zone | color, note, recoverySeconds }
 */
export function stepRow(step = {}, opts = {}) {
  const {
    label, prescription, value, note, recoverySeconds, last, i,
  } = { ...step, ...opts };
  const color = step.color || step.zone?.color || opts.color || 'var(--primary)';

  return el(
    'div',
    { class: 'step-row', style: { '--step-color': color, '--i': i } },
    el(
      'div',
      { class: 'step-row__rail' },
      el('div', { class: 'step-row__dot' }),
      last ? null : el('div', { class: 'step-row__line' }),
    ),
    el(
      'div',
      { class: 'step-row__main' },
      el(
        'div',
        { class: 'step-row__head' },
        el('span', { class: 'step-row__label', text: String(label || '') }),
        el('span', { class: 'step-row__prescription', text: String(prescription || value || '') }),
      ),
      (step.zone?.title || recoverySeconds)
        ? el(
            'div',
            { class: 'step-row__meta' },
            step.zone?.title ? el('span', { text: String(step.zone.title) }) : null,
            recoverySeconds ? el('span', { text: `· ${Math.round(recoverySeconds)}s recovery` }) : null,
          )
        : null,
      note ? el('div', { class: 'step-row__note', text: String(note) }) : null,
    ),
  );
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Run `fn` after the browser has actually painted the element's initial state.
 *
 * A single requestAnimationFrame is not enough: rAF callbacks run *before*
 * style recalc/paint, so a value set in the same frame as the insert is
 * coalesced into one style change and no CSS transition ever starts — the ring
 * or bar just appears already full. Two frames guarantee frame 1 painted the
 * empty state and frame 2's change is a real transition.
 */
function afterPaint(fn) {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** Convenience: a row with a label on the left and a value on the right. */
export function keyValueRow(label, value, opts = {}) {
  return el(
    'div',
    { class: ['row-between', opts.class], style: opts.style },
    el('span', { class: 't-body muted', text: String(label) }),
    el('span', { class: 't-body-strong tabular', text: value === undefined || value === null ? '—' : String(value) }),
  );
}

/** A screen body wrapper with the standard gutter + section rhythm. */
export function screenBody(...children) {
  const node = el('div', { class: 'screen-body' });
  for (const child of children) appendChild(node, child);
  return node;
}

export default {
  el,
  frag,
  fill,
  svgIcon,
  hydrateIcons,
  card,
  tappable,
  sessionRow,
  chip,
  pacePill,
  statTile,
  ring,
  meter,
  progressBar,
  segmented,
  sheet,
  toast,
  screenHeader,
  sectionHeader,
  emptyState,
  planShield,
  skeleton,
  pulseDot,
  divider,
  bars,
  stepRow,
  keyValueRow,
  screenBody,
  RUN_TYPES,
  runTypeMeta,
  isQualityRunType,
  sessionAccent,
  sessionIcon,
  sessionTypeLabel,
  runTypeKey,
  fmtDuration,
  fmtDistance,
  fmtPace,
  fmtPaceRange,
  unitSuffix,
  dayKey,
  toDate,
};
