/**
 * app.js — router, tab bar and boot.
 *
 * The whole app is: one state object, one screen module at a time rendered
 * into #app, and a fixed tab bar. No framework, no build step.
 *
 * ── Screen contract ────────────────────────────────────────────────────────
 * Every module under js/screens/ default-exports
 *
 *     (root, state, navigate) => void
 *
 *   root      an empty <div class="screen"> already in the DOM. Fill it.
 *   state     the shared, live state object (mutate it, then saveState()).
 *   navigate  (target, params) => void — switch tab / open a route.
 *             navigate('plan')            switch to a tab
 *             navigate('calendar', {...}) pass params (also on navigate.params)
 *             navigate({ tab, ...params }) object form
 *             navigate.back()             previous route
 *             navigate.reload()           re-render the current route
 * A 4th argument (params) is also passed; ignore it if you do not need it.
 *
 * ── Shared state ───────────────────────────────────────────────────────────
 *   { plan, athlete: { name, units, ... }, runs: [], prefs: {},
 *     completedSessionIds: [] }
 *
 * Persistence and every derived helper (weekFor, todaysSession, currentStreak,
 * markSessionComplete, …) live in js/domain/store.js.
 */

import {
  loadState,
  saveState,
  flushState,
  resetState,
  markSessionComplete,
  addRun,
  weekFor,
  todaysSession,
  currentStreak,
} from './domain/store.js';

import { el, svgIcon, hydrateIcons } from './ui/components.js';
import { stagger, haptic } from './ui/motion.js';

import onboarding from './screens/onboarding.js';
import today from './screens/today.js';
import plan from './screens/plan.js';
import progress from './screens/progress.js';
import calendar from './screens/calendar.js';
import profile from './screens/profile.js';

/* ------------------------------------------------------------------- tabs */

/** The five tabs, in order. `icon` names a symbol in index.html's sprite. */
export const TABS = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'plan', label: 'Plan', icon: 'flag' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'profile', label: 'Profile', icon: 'person' },
];

const TAB_IDS = TABS.map((t) => t.id);

const SCREENS = { onboarding, today, plan, progress, calendar, profile };

/* ------------------------------------------------------------------ state */

/** The one live state object, restored from localStorage on boot. */
export const state = loadState();

/** Re-exported so a screen only ever needs to import app.js. */
export { loadState, saveState, flushState, resetState, markSessionComplete, addRun, weekFor, todaysSession, currentStreak };

/* ------------------------------------------------------------------ route */

const ROUTE_KEY = 'runna.route.v1';

let currentRoute = { tab: 'today', params: {} };
let routeStack = [];
let screenNode = null;
let tabbarNode = null;

function hasPlan() {
  return !!(state && state.plan);
}

function readStoredTab() {
  try {
    const fromHash = (location.hash || '').replace(/^#\/?/, '');
    if (TAB_IDS.includes(fromHash)) return fromHash;
    const stored = localStorage.getItem(ROUTE_KEY);
    if (TAB_IDS.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  return null;
}

function rememberTab(tab) {
  try {
    if (TAB_IDS.includes(tab)) localStorage.setItem(ROUTE_KEY, tab);
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------- navigate */

/**
 * Change route and re-render.
 * @param {string|object} target tab id ('today' | 'plan' | 'progress' |
 *        'calendar' | 'profile' | 'onboarding') or { tab, ...params }
 * @param {object} [params]
 */
export function navigate(target, params = {}) {
  let tab;
  let nextParams = params;

  if (target && typeof target === 'object') {
    const { tab: t, ...rest } = target;
    tab = t;
    nextParams = { ...rest, ...params };
  } else {
    tab = target;
  }

  if (tab === 'back') return navigateBack();
  if (!tab || typeof tab !== 'string') return;

  // No plan yet → onboarding, whatever was asked for. That is the whole
  // "first run" rule.
  if (!hasPlan() && tab !== 'onboarding') tab = 'onboarding';
  if (!SCREENS[tab]) tab = hasPlan() ? 'today' : 'onboarding';

  if (currentRoute.tab !== tab) {
    routeStack.push(currentRoute);
    if (routeStack.length > 20) routeStack = routeStack.slice(-20);
  }
  currentRoute = { tab, params: nextParams || {} };

  render();
}

/** Go back one route (no-op at the bottom of the stack). */
export function navigateBack() {
  const previous = routeStack.pop();
  if (!previous) return;
  currentRoute = previous;
  render({ animate: true, back: true });
}

function render(options = {}) {
  const { animate = true, back = false } = options;
  const app = document.getElementById('app');
  if (!app) return;

  const { tab, params } = currentRoute;
  const factory = SCREENS[tab];

  // The tab bar is chrome, not a screen: it lives outside #app and only
  // appears once there is a plan to navigate around.
  const showTabBar = tab !== 'onboarding' && hasPlan();
  mountTabBar(showTabBar, tab);

  const node = el('div', {
    class: ['screen', tab === 'onboarding' && 'screen--bare'],
    dataset: { route: tab },
  });

  try {
    if (typeof factory === 'function') {
      factory(node, state, navigate, params);
    } else {
      node.appendChild(unavailableScreen(tab));
    }
  } catch (error) {
    console.error(`[runna] screen "${tab}" threw while rendering:`, error);
    node.textContent = '';
    node.appendChild(brokenScreen(tab, error));
  }

  hydrateIcons(node);
  swapScreens(node, animate, back);

  if (TAB_IDS.includes(tab)) rememberTab(tab);
  const hash = `#${tab}`;
  if (location.hash !== hash) {
    try {
      history.pushState({ tab }, '', hash);
    } catch {
      location.hash = hash;
    }
  }
  try {
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch {
    window.scrollTo(0, 0);
  }
}

/* ------------------------------------------------------- screen transition */

function swapScreens(node, animate, back) {
  const app = document.getElementById('app');
  const outgoing = app.querySelector('.screen');

  // Cross-fade: the outgoing screen is taken out of flow so the incoming one
  // occupies the layout immediately. Nothing animated here touches layout.
  if (outgoing && animate) {
    outgoing.classList.add('screen-leave');
    const drop = () => outgoing.remove();
    outgoing.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 400);
  } else if (outgoing) {
    outgoing.remove();
  }

  if (animate) node.classList.add('screen-enter');
  app.appendChild(node);
  screenNode = node;

  if (animate) {
    const done = () => node.classList.remove('screen-enter');
    node.addEventListener('animationend', done, { once: true });
    setTimeout(done, 700);
  }

  // Number the top-level blocks so they resolve top-to-bottom rather than all
  // at once (Motion.swift → StaggeredAppear).
  const body = node.querySelector('.screen-body') || node;
  stagger(body, undefined, 14);

  // A back navigation should not feel like a fresh push; a same-tab switch
  // gets the full entrance.
  if (back && animate) {
    node.classList.remove('screen-enter');
  }
  return node;
}

/* ---------------------------------------------------------------- tab bar */

function buildTabBar() {
  const bar = el('nav', { class: 'tabbar', role: 'tablist', 'aria-label': 'Primary' });
  for (const tab of TABS) {
    const button = el(
      'button',
      {
        type: 'button',
        class: 'tabbar__item',
        role: 'tab',
        dataset: { tab: tab.id },
        'aria-selected': 'false',
        'aria-label': tab.label,
      },
      el('span', { class: 'tabbar__dot', 'aria-hidden': 'true' }),
      svgIcon(tab.icon, 24),
      el('span', { class: 'tabbar__label', text: tab.label }),
    );
    button.addEventListener('click', () => {
      haptic(10);
      if (currentRoute.tab === tab.id) {
        // Tapping the active tab scrolls back to the top, like iOS.
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      navigate(tab.id);
    });
    bar.appendChild(button);
  }
  return bar;
}

function mountTabBar(show, activeTab) {
  if (show) {
    if (!tabbarNode) {
      tabbarNode = buildTabBar();
      document.body.appendChild(tabbarNode);
    }
    tabbarNode.hidden = false;
    for (const item of tabbarNode.children) {
      const active = item.dataset.tab === activeTab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  } else if (tabbarNode) {
    tabbarNode.hidden = true;
  }

  // The toast layer positions itself above the tab bar; tell it whether the
  // bar is on screen.
  const layer = document.querySelector('.toast-layer');
  if (layer) layer.classList.toggle('toast-layer--bare', !show);
}

/* ------------------------------------------------------------ error states */

function brokenScreen(tab, error) {
  return el(
    'div',
    { class: 'screen-body' },
    el(
      'div',
      { class: 'card', style: { marginTop: '40px' } },
      el('div', { class: 'row-sm' }, svgIcon('alert', 18), el('div', { class: 't-headline', text: 'Something went wrong' })),
      el('p', { class: 't-caption muted', style: { marginTop: '8px' }, text: `The ${tab} screen failed to render.` }),
      el('pre', {
        class: 't-caption faint',
        style: { marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        text: String((error && (error.stack || error.message)) || error),
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-block',
        style: { marginTop: '16px' },
        text: 'Reload',
        onclick: () => location.reload(),
      }),
    ),
  );
}

function unavailableScreen(tab) {
  return el(
    'div',
    { class: 'screen-body' },
    el(
      'div',
      { class: 'card', style: { marginTop: '40px' } },
      el('div', { class: 't-headline', text: `${tab} is not available` }),
      el('p', { class: 't-caption muted', style: { marginTop: '8px' }, text: 'This screen module did not export a render function.' }),
    ),
  );
}

/* ------------------------------------------------- service worker + boot */

function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // file:// has no service worker scope; skip and let the app run from disk.
  if (location.protocol === 'file:') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(
      (registration) => {
        // A new shell is waiting: activate it on the next launch so the app is
        // never swapped out from under the person mid-session.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('[runna] new version cached — it will be used next launch');
            }
          });
        });
      },
      (error) => {
        console.info('[runna] service worker not registered:', error && error.message);
      },
    );
  });
}

function persistOnLeave() {
  // flushState, not saveState: a document that changed nothing must not
  // overwrite a newer state written elsewhere (another tab, a reset).
  const flush = () => flushState(state);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function onPopState() {
  const hash = (location.hash || '').replace(/^#\/?/, '');
  const tab = TAB_IDS.includes(hash) ? hash : (hasPlan() ? 'today' : 'onboarding');
  if (tab === currentRoute.tab) return;
  currentRoute = { tab, params: {} };
  render({ animate: true, back: true });
}

function boot() {
  const app = document.getElementById('app');
  if (!app) return;

  // First run, or a plan that was reset → onboarding.
  const stored = hasPlan() ? (readStoredTab() || 'today') : 'onboarding';
  currentRoute = { tab: stored, params: {} };
  routeStack = [];

  render({ animate: false });
  registerServiceWorker();
  persistOnLeave();
  window.addEventListener('popstate', onPopState);

  // Handy for debugging from Safari's Web Inspector; harmless in production.
  try {
    Object.defineProperty(window, 'runna', {
      value: { state, navigate, TABS, render: () => render({ animate: false }) },
      configurable: true,
    });
  } catch {
    /* ignore */
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

export default { state, navigate, navigateBack, TABS, render: (o) => render(o) };
