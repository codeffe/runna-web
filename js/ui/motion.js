/**
 * motion.js — the small motion vocabulary screens call.
 *
 * Mirrors app/Runna/DesignSystem/Motion.swift. Everything here either toggles
 * a CSS class, writes a custom property that CSS animates, or drives a number
 * with requestAnimationFrame. No layout-triggering properties are ever
 * animated: transforms and opacity only (the one exception is a ring's
 * stroke-dashoffset, which is paint-only).
 */

/** Durations/springs, kept in step with the --dur-* / --ease-* tokens. */
export const motion = {
  fade: 180,
  quick: 180,
  snappy: 280,
  content: 300,
  smooth: 350,
  hero: 420,
  meter: 500,
  bouncy: 450,
  stagger: 40,
};

/* ------------------------------------------------------------------ reduced */

let _mq = null;

/** True when the person has asked the system to reduce motion. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  if (!_mq) {
    try {
      _mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return false;
    }
  }
  return _mq.matches === true;
}

/** Subscribe to reduce-motion changes. Returns an unsubscribe function. */
export function onReducedMotionChange(fn) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (event) => fn(event.matches === true);
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler);
    else if (mq.removeListener) mq.removeListener(handler);
  };
}

/* ------------------------------------------------------------------ stagger */

/**
 * Number the children of `el` so the CSS rule
 *   .stagger > * { animation-delay: calc(var(--i) * 40ms) }
 * resolves top-to-bottom rather than all at once.
 *
 * @param {Element} el       container carrying the `stagger` class
 * @param {number}  [step]   ms between siblings (default 40, per Motion.swift)
 * @param {number}  [max]    cap on the index, so a 40-row list doesn't crawl
 * @returns {Element} el
 */
export function stagger(el, step = motion.stagger, max = 12) {
  if (!el || !el.children) return el;
  // The delay is expressed in CSS as index * var(--stagger); a custom step is
  // applied by writing the delay directly, which keeps one source of truth.
  const custom = step !== motion.stagger;
  const kids = el.children;
  for (let i = 0; i < kids.length; i++) {
    const idx = Math.min(i, max);
    const child = kids[i];
    child.style.setProperty('--i', String(idx));
    if (custom) child.style.animationDelay = `${idx * step}ms`;
  }
  return el;
}

/** Add the `stagger` class and number the children in one call. */
export function staggerIn(el, step = motion.stagger, max = 12) {
  if (!el) return el;
  el.classList.add('stagger');
  return stagger(el, step, max);
}

/* ------------------------------------------------------------------ countUp */

const counters = new WeakMap();

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate a number from `from` to `to`, writing formatted text into `el`.
 *
 * Honours reduce-motion by jumping straight to the end value. Cancels any
 * animation already running on the same element. Returns a promise that
 * resolves with the final value and carries a `.cancel()`.
 *
 * @param {Element} el
 * @param {number}  from
 * @param {number}  to
 * @param {object}  [opts]
 * @param {number}  [opts.duration]  ms, default 700
 * @param {number}  [opts.delay]     ms before starting, default 0
 * @param {(v:number)=>string} [opts.format]  default: integer with thousands
 * @param {number}  [opts.decimals]  used by the default formatter
 * @param {boolean} [opts.suffix]    appended by the default formatter
 * @param {string}  [opts.ease]      'out' | 'linear'
 */
export function countUp(el, from, to, opts = {}) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  const start = Number.isFinite(from) ? from : 0;
  const end = Number.isFinite(to) ? to : 0;

  const {
    duration = 700,
    delay = 0,
    decimals = 0,
    suffix = '',
    ease = 'out',
    format,
  } = opts;

  const write = typeof format === 'function'
    ? format
    : (v) => {
        const fixed = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
        const [whole, frac] = fixed.split('.');
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (frac ? `${grouped}.${frac}` : grouped) + suffix;
      };

  if (!node) {
    const done = Promise.resolve(end);
    done.cancel = () => {};
    return done;
  }

  // Cancel whatever was already animating this node.
  const previous = counters.get(node);
  if (previous) previous.cancel();

  let raf = 0;
  let timer = 0;
  let cancelled = false;
  let resolveFn = () => {};

  const finish = () => {
    if (cancelled) return;
    node.textContent = write(end);
    counters.delete(node);
    resolveFn(end);
  };

  const promise = new Promise((resolve) => { resolveFn = resolve; });

  const run = () => {
    if (cancelled) return;
    if (prefersReducedMotion() || duration <= 0) {
      finish();
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      if (cancelled) return;
      const t = Math.min(1, (now - t0) / duration);
      const k = ease === 'linear' ? t : easeOutCubic(t);
      node.textContent = write(start + (end - start) * k);
      if (t < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
  };

  if (delay > 0 && !prefersReducedMotion()) timer = setTimeout(run, delay);
  else run();

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    counters.delete(node);
  };

  promise.cancel = cancel;
  counters.set(node, promise);
  return promise;
}

/**
 * Count a value up and write it with the element's existing formatter.
 * Convenience wrapper: `countUpTo(el, 42, { suffix: ' km' })`.
 */
export function countUpTo(el, to, opts = {}) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  const from = Number(node?.dataset.from);
  return countUp(node, Number.isFinite(from) ? from : 0, to, opts);
}

/* --------------------------------------------------------------- ring/meter */

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Set the fill fraction of a progress ring (or anything else driven by --p).
 * CSS animates the change; this only writes the property.
 *
 * @param {Element|string} el  element carrying `--p` (or the .ring itself)
 * @param {number} value       0…1
 */
export function ringProgress(el, value) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  if (!node) return null;
  const p = clamp01(value);
  node.style.setProperty('--p', String(p));
  return p;
}

/**
 * Same contract for a meter/bar fill. `value` and `max` are in display units.
 * Also updates a `[data-meter-value]` readout inside the meter, if present.
 */
export function meterProgress(el, value, max = 1) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  if (!node) return null;
  const m = Number(max) > 0 ? Number(max) : 1;
  const p = clamp01(Number(value) / m);
  node.style.setProperty('--p', String(p));
  const readout = node.querySelector('[data-meter-value]');
  if (readout) readout.textContent = `${Math.round(p * 100)}%`;
  return p;
}

/** Move a segmented control's thumb. */
export function segmentTo(el, index) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  if (!node) return;
  node.style.setProperty('--seg-index', String(Math.max(0, index | 0)));
}

/** Set a bar fill's fraction (0…1) inside a `.bars` chart. */
export function barProgress(el, value) {
  const node = typeof el === 'string' ? document.querySelector(el) : el;
  if (!node) return;
  node.style.setProperty('--p', String(clamp01(value)));
}

/* ------------------------------------------------------------------- haptic */

/**
 * A short tap of the Taptic Engine — only iOS Safari exposes navigator.vibrate,
 * and only inside a user gesture, so every failure mode is swallowed.
 * Mirrors Haptics.tap(). Pass a bigger number for a commitment (Haptics.commit).
 */
export function haptic(duration = 10) {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.vibrate === 'function') {
      const ok = nav.vibrate(duration);
      // Safari returns a boolean; some engines return undefined.
      return ok !== false;
    }
  } catch {
    /* vibration is a nicety, never an error */
  }
  return false;
}

/** Heavier confirmation buzz (Haptics.commit). */
export function hapticCommit() {
  return haptic(18);
}

/** Triple-buzz celebration (Haptics.celebrate). */
export function hapticCelebrate() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.vibrate === 'function') {
      return nav.vibrate([0, 24, 60, 24, 60, 40]) !== false;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/* -------------------------------------------------------------- class utils */

/**
 * Add a class, then remove it once its animation/transition finishes (with a
 * timeout fallback for reduce-motion, where the animation is ~0ms and
 * `animationend` may not be reliable).
 *
 * @returns {Promise<void>}
 */
export function animateClass(el, className, timeout = motion.smooth + 80) {
  if (!el) return Promise.resolve();
  el.classList.add(className);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.remove(className);
      el.removeEventListener('animationend', finish);
      el.removeEventListener('transitionend', finish);
      resolve();
    };
    el.addEventListener('animationend', finish, { once: true });
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, timeout);
  });
}

/**
 * Run a Web Animations API animation, or skip straight to the end state when
 * the person prefers reduced motion. Returns the Animation (or null).
 */
export function animate(el, keyframes, options = {}) {
  if (!el || typeof el.animate !== 'function') return null;
  if (prefersReducedMotion()) {
    const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : null;
    if (last && last.opacity !== undefined) el.style.opacity = String(last.opacity);
    return null;
  }
  const anim = el.animate(keyframes, { easing: 'cubic-bezier(0.32, 0.72, 0, 1)', duration: motion.smooth, fill: 'backwards', ...options });
  return anim;
}

/** Next frame, twice — enough for a style change to have been painted. */
export function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default {
  motion,
  prefersReducedMotion,
  onReducedMotionChange,
  stagger,
  staggerIn,
  countUp,
  countUpTo,
  ringProgress,
  meterProgress,
  segmentTo,
  barProgress,
  haptic,
  hapticCommit,
  hapticCelebrate,
  animateClass,
  animate,
  nextFrame,
};
