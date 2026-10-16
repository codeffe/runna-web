/**
 * profile.js — the Profile tab.
 *
 * Identity, the Runna Level, units, recording preferences, the danger zone and
 * the About block. Mirrors `app/Runna/Features/Profile/ProfileView.swift`,
 * minus everything that only makes sense on iOS (shoes, parkrun barcode, Apple
 * Watch pairing, heart-rate zones).
 *
 * There is no entitlement, billing or plan-tier information anywhere on this
 * screen — every feature in this app is free, so there is nothing to gate.
 *
 * Contract: `export default function profile(root, state, navigate)`.
 */

import {
  el,
  card,
  chip,
  ring,
  segmented,
  sheet,
  toast,
  screenHeader,
  sectionHeader,
  statTile,
  divider,
  svgIcon,
  keyValueRow,
} from '../ui/components.js';

import { countUp, staggerIn, haptic } from '../ui/motion.js';

import {
  saveState,
  resetState,
  currentStreak,
  setPref,
} from '../domain/store.js';

import { formatDistance, formatDate } from '../domain/format.js';

import { UNITS } from '../engine/enums.js';

/* ========================================================================== */
/* constants                                                                  */
/* ========================================================================== */

/**
 * The build this file ships as. Kept in step with the native target's
 * Info.plist (`CFBundleShortVersionString` 1.0, `CFBundleVersion` 1) so the two
 * builds report the same version string.
 */
const APP_VERSION = '1.0';
const APP_BUILD = '1';

/* ========================================================================== */
/* Runna Level                                                                */
/* ========================================================================== */

// RUNNA LEVEL — POINTS AND TIERS
// ---------------------------------------------------------------------------
// Points come from the athlete's own history, in the two currencies Runna's
// ladder rewards: showing up, and covering ground.
//
//     points = 100 x total runs  +  5 x total kilometres
//
// The kilometre total is always computed in kilometres, whatever unit the
// athlete displays, so switching to miles never moves the level. Tiers, in
// order, are the native ladder: Rookie below Bronze, then
// Bronze 150 · Silver 750 · Gold 2,000 · Platinum 7,000 · Diamond 15,000 ·
// Champion 30,000.
//
// The ring shows progress *inside* the current tier — from this tier's
// threshold to the next one's — so it empties at every promotion rather than
// sitting full from Bronze onwards.

const LEVELS = [
  { index: 1, title: 'Bronze', threshold: 150, color: '#CD7F32' },
  { index: 2, title: 'Silver', threshold: 750, color: '#C0C7CF' },
  { index: 3, title: 'Gold', threshold: 2000, color: '#E3A008' },
  { index: 4, title: 'Platinum', threshold: 7000, color: '#7FD8D0' },
  { index: 5, title: 'Diamond', threshold: 15000, color: '#6FB6FF' },
  { index: 6, title: 'Champion', threshold: 30000, color: '#7C52AD' },
];

const ROOKIE = { index: 0, title: 'Rookie', threshold: 0, color: 'var(--text-muted)' };

const LEVEL_FORMULA = 'Level points = 100 per run + 5 per kilometre covered.';

function levelFor(points) {
  let found = null;
  for (const tier of LEVELS) {
    if (points >= tier.threshold) found = tier;
  }
  return found;
}

function nextLevel(tier) {
  if (!tier) return LEVELS[0];
  return LEVELS.find((t) => t.index === tier.index + 1) || null;
}

function levelProgress(points, tier) {
  const next = nextLevel(tier);
  if (!tier) return Math.min(1, points / LEVELS[0].threshold);
  if (!next) return 1;
  const span = next.threshold - tier.threshold;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (points - tier.threshold) / span));
}

/** "1,240 points" / "0 points" — used by the count-up formatter. */
function pointsLabel(value) {
  return `${Math.round(value).toLocaleString()} points`;
}

/* ========================================================================== */
/* preference keys                                                            */
/* ========================================================================== */

// PREFERENCE KEYS — the contract with the Today screen
// ---------------------------------------------------------------------------
// The three recording preferences persist into `state.prefs` under exactly
// these keys, all booleans:
//
//     prefs.audioCues          default true
//     prefs.openWarmUp         default false
//     prefs.intervalsOnTrack   default false
//
// The Today run recorder lives in `screens/today.js`, which is outside this
// screen's file scope, so it cannot be wired from here. These are the keys it
// should read:
//
//   · audioCues        gate the spoken split / pace-alert announcements.
//   · openWarmUp       hold the recorder on the warm-up step until the runner
//                      presses Continue, instead of advancing automatically.
//   · intervalsOnTrack suppress automatic laps and audio guidance for interval
//                      and tempo sessions, because a track lap is not a
//                      distance-split.
//
// Until today.js reads them the toggles are still fully persisted and survive a
// reload — they simply have no effect on the recorder yet.

const PREF_DEFAULTS = {
  audioCues: true,
  openWarmUp: false,
  intervalsOnTrack: false,
};

function pref(state, key) {
  const stored = state.prefs ? state.prefs[key] : undefined;
  return typeof stored === 'boolean' ? stored : PREF_DEFAULTS[key];
}

/* ========================================================================== */
/* the screen                                                                 */
/* ========================================================================== */

export default function profile(root, state, navigate) {
  const athlete = () => (state.athlete = state.athlete || {});
  const units = () => athlete().units || 'kilometers';
  const runs = () => (Array.isArray(state.runs) ? state.runs : []);

  /** Total kilometres, always in km regardless of the display unit. */
  function totalKilometres() {
    return runs().reduce((sum, run) => {
      const meters = Number(run && run.distanceMeters);
      return sum + (Number.isFinite(meters) ? meters : 0);
    }, 0) / 1000;
  }

  function levelPoints() {
    return runs().length * 100 + Math.floor(totalKilometres() * 5);
  }

  /* ------------------------------------------------------------- identity */

  function initials() {
    const parts = String(athlete().name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => part[0]).join('');
    return (letters || 'R').toUpperCase();
  }

  function identityCard() {
    const streak = currentStreak(state);

    const avatar = el(
      'div',
      {
        style: {
          display: 'grid',
          placeItems: 'center',
          width: '62px',
          height: '62px',
          flex: '0 0 auto',
          borderRadius: '999px',
          background: 'linear-gradient(135deg, var(--primary), var(--primary-deep))',
          color: 'var(--on-primary)',
          fontSize: '22px',
          fontWeight: '700',
          letterSpacing: '-0.4px',
        },
        'aria-hidden': 'true',
        text: initials(),
      },
    );

    const nameBlock = el(
      'div',
      { class: 'stack-sm', style: { gap: '3px', minWidth: '0', flex: '1 1 auto' } },
      el('div', { class: 't-title truncate', text: athlete().name || 'Runner' }),
      el('div', {
        class: 't-caption muted truncate',
        text: athlete().email || 'No email on file',
      }),
    );

    const row = el('div', { class: 'row', style: { gap: '14px' } }, avatar, nameBlock);

    if (streak > 0) {
      row.appendChild(chip(
        `${streak} day${streak === 1 ? '' : 's'}`,
        { color: 'var(--streak)', icon: 'flame', class: 'nowrap' },
      ));
    }

    return card({ padding: 16, class: 'section' }, row);
  }

  /* ---------------------------------------------------------- level card */

  function levelCard() {
    const points = levelPoints();
    const tier = levelFor(points);
    const current = tier || ROOKIE;
    const next = nextLevel(tier);
    const progress = levelProgress(points, tier);
    const toNext = next ? Math.max(0, next.threshold - points) : 0;

    const badge = ring({
      value: progress,
      size: 86,
      lineWidth: 9,
      color: current.color,
      label: String(current.index),
      caption: current.title.toUpperCase(),
    });

    const pointsNode = el('div', { class: 'metric-sm tabular', text: '0 points' });
    countUp(pointsNode, 0, points, {
      duration: 900,
      delay: 120,
      format: pointsLabel,
    });

    const detail = el(
      'div',
      { class: 'stack-sm', style: { gap: '5px', minWidth: '0' } },
      pointsNode,
      next
        ? el('div', {
            class: 't-caption',
            style: { color: 'var(--primary)' },
            text: `${toNext.toLocaleString()} points to ${next.title}`,
          })
        : el('div', {
            class: 't-caption gold',
            text: 'Top level reached — every point still counts',
          }),
      el('div', { class: 't-micro faint', text: LEVEL_FORMULA.toUpperCase() }),
    );

    // The tier ladder: one capsule per level, filled once it is banked. The
    // colours are final on first paint, so there is nothing to transition.
    const ladder = el('div', { class: 'grid-3', style: { gap: '6px' } });
    for (const t of [ROOKIE, ...LEVELS]) {
      const banked = points >= t.threshold;
      ladder.appendChild(el(
        'div',
        { class: 'stack-sm', style: { gap: '4px' } },
        el('div', {
          style: {
            height: '6px',
            borderRadius: '999px',
            background: banked ? t.color : 'var(--raised)',
          },
        }),
        el('div', {
          class: 't-micro truncate',
          style: { color: t.index === current.index ? 'var(--text)' : 'var(--text-faint)', fontSize: '9px' },
          text: t.title,
        }),
      ));
    }

    const totals = el(
      'div',
      { class: 'grid-2' },
      statTile('Runs', String(runs().length), { icon: 'run', accent: 'var(--info)' }),
      statTile('Distance', formatDistance(totalKilometres() * 1000, units()), {
        unit: units() === 'miles' ? 'mi' : 'km',
        icon: 'route',
        accent: 'var(--primary)',
      }),
    );

    return card(
      { padding: 16, class: 'section' },
      sectionHeader('Runna Level'),
      el('div', { class: 'row', style: { gap: '16px' } }, badge, detail),
      ladder,
      totals,
    );
  }

  /* ---------------------------------------------------------- units card */

  function unitsCard() {
    const control = segmented(
      [
        { value: 'kilometers', label: "Kilometres" },
        { value: 'miles', label: 'Miles' },
      ],
      {
        value: units(),
        onChange: (next) => {
          if (!UNITS[next] || units() === next) return;
          haptic(10);
          athlete().units = next;
          // Persist first, then re-render: every screen reads `units` off the
          // shared state object, so writing it here is what makes the change
          // immediate everywhere, and `saveState` is what makes it survive a
          // relaunch.
          saveState(state);
          toast(`Units set to ${UNITS[next].title.toLowerCase()}`, { icon: 'route', tone: 'success' });
          render(false);
        },
      },
    );

    return card(
      { padding: 16, class: 'section' },
      sectionHeader('Units'),
      control,
      el('div', {
        class: 't-caption muted',
        text: 'Distances, paces and charts across the app follow this setting immediately. Paces are stored in seconds per kilometre and converted only for display, so switching units never changes your data.',
      }),
    );
  }

  /* ----------------------------------------------------- preferences card */

  /**
   * A settings switch.
   *
   * The thumb moves on `transform` and the "on" fill fades on `opacity` — the
   * two properties the brief allows. Nothing here animates `left`, `width` or
   * `background-color`, so a toggle never costs a layout or a recolor pass.
   */
  function toggleRow({ title, subtitle, value, onChange }) {
    let on = value;

    const thumb = el('span', {
      style: {
        position: 'relative',
        zIndex: '1',
        display: 'block',
        width: '22px',
        height: '22px',
        borderRadius: '999px',
        background: '#FFFFFF',
        transform: `translateX(${on ? 22 : 0}px)`,
        transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        boxShadow: '0 1px 3px rgb(0 0 0 / .35)',
      },
    });

    // The "on" colour is a separate layer that fades, rather than a
    // background-color transition on the track itself.
    const fill = el('span', {
      style: {
        position: 'absolute',
        inset: '0',
        borderRadius: '999px',
        background: 'var(--primary)',
        opacity: on ? '1' : '0',
        transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.30, 1)',
      },
      'aria-hidden': 'true',
    });

    const control = el(
      'span',
      {
        style: {
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '48px',
          height: '28px',
          padding: '3px',
          flex: '0 0 auto',
          borderRadius: '999px',
          background: 'var(--raised)',
          border: '1px solid var(--stroke-soft)',
        },
        'aria-hidden': 'true',
      },
      fill,
      thumb,
    );

    const button = el(
      'button',
      {
        type: 'button',
        class: 'card--tappable',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': title,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          width: '100%',
          padding: '12px 0',
          textAlign: 'left',
        },
      },
      el(
        'span',
        { class: 'stack-sm', style: { gap: '3px', flex: '1 1 auto', minWidth: '0' } },
        el('span', { class: 't-body-strong', text: title }),
        el('span', { class: 't-caption muted', text: subtitle }),
      ),
      control,
    );

    button.addEventListener('click', () => {
      on = !on;
      haptic(10);
      thumb.style.transform = `translateX(${on ? 22 : 0}px)`;
      fill.style.opacity = on ? '1' : '0';
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      onChange(on);
    });

    return button;
  }

  function preferencesCard() {
    return card(
      { padding: 16, class: 'section' },
      sectionHeader('Recording preferences'),
      el(
        'div',
        { class: 'stack-sm', style: { gap: '0' } },
        toggleRow({
          title: 'Audio cues',
          subtitle: 'Read splits, pace alerts and the pause warning through the speaker or headphones.',
          value: pref(state, 'audioCues'),
          onChange: (on) => setPref(state, 'audioCues', on),
        }),
        divider(),
        toggleRow({
          title: 'Open warm-up',
          subtitle: 'Wait for you to press Continue after the warm-up instead of moving on automatically.',
          value: pref(state, 'openWarmUp'),
          onChange: (on) => setPref(state, 'openWarmUp', on),
        }),
        divider(),
        toggleRow({
          title: 'Intervals/Tempo on track',
          subtitle: "Keep interval and tempo sessions on the track: laps don't end automatically.",
          value: pref(state, 'intervalsOnTrack'),
          onChange: (on) => setPref(state, 'intervalsOnTrack', on),
        }),
      ),
      el(
        'div',
        { class: 'row-top', style: { gap: '8px' } },
        svgIcon('alert', 14),
        el('div', {
          class: 't-caption muted',
          text: 'With open warm-up on you will need to press Continue or Lap to advance, and no audio cues are played until you move past the warm-up. Intervals/Tempo on track suppresses automatic laps and audio guidance for the same reason. Leave both off for the full cue experience.',
        }),
      ),
    );
  }

  /* -------------------------------------------------------- danger zone */

  function confirmReset() {
    const node = sheet(
      {
        title: 'Reset all data?',
        onClose: () => setTimeout(() => node.remove(), 600),
      },
      el(
        'div',
        { class: 'stack-lg' },
        el('p', {
          class: 't-caption secondary-text',
          text: 'This permanently removes your training plan, every recorded and logged run, your completed sessions and your preferences from this device. It cannot be undone.',
        }),
        el(
          'div',
          { class: 'stack-sm' },
          el('button', {
            type: 'button',
            class: 'btn btn-danger btn-block',
            text: 'Reset everything',
            onclick: () => {
              haptic(18);
              // `resetState()` clears localStorage and hands back a fresh state
              // object, but app.js holds the live one by reference. Emptying it
              // in place is what makes the router's `hasPlan()` check see an
              // unplanned athlete and fall through to onboarding.
              const fresh = resetState();
              for (const key of Object.keys(state)) delete state[key];
              Object.assign(state, fresh);
              node.close();
              navigate('onboarding');
            },
          }),
          el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-block',
            text: 'Cancel',
            onclick: () => node.close(),
          }),
        ),
      ),
    );
    node.open();
  }

  function dangerCard() {
    return card(
      { padding: 0, class: 'section' },
      el(
        'div',
        { style: { padding: '16px 16px 0' } },
        sectionHeader('Danger zone'),
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'card--tappable',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            padding: '14px 16px',
            textAlign: 'left',
            color: 'var(--danger)',
          },
          onclick: () => {
            haptic(10);
            confirmReset();
          },
        },
        svgIcon('trash', 18),
        el(
          'span',
          { class: 'stack-sm', style: { gap: '2px', flex: '1 1 auto', minWidth: '0' } },
          el('span', { class: 't-body-strong', style: { color: 'var(--danger)' }, text: 'Reset all data' }),
          el('span', { class: 't-caption muted', text: 'Delete the plan, every run and all preferences from this device.' }),
        ),
        svgIcon('chevron-right', 14),
      ),
      el('div', { style: { padding: '0 16px 16px' } }, el('div', {
        class: 't-micro faint',
        text: 'EVERYTHING LIVES IN THIS BROWSER’S LOCAL STORAGE. NOTHING IS UPLOADED, AND NOTHING LEAVES THE DEVICE.',
      })),
    );
  }

  /* --------------------------------------------------------------- about */

  function aboutCard() {
    return card(
      { padding: 16, class: 'section' },
      sectionHeader('About'),
      keyValueRow('Version', `${APP_VERSION} (${APP_BUILD})`),
      divider(),
      keyValueRow('Runs on', 'Safari, from your Home Screen'),
      divider(),
      keyValueRow('Member since', state.createdAt ? formatDate(state.createdAt) : formatDate(new Date())),
      divider(),
      el('p', {
        class: 't-caption muted',
        style: { margin: '0' },
        text: 'This app is an independent educational reimplementation, built to study how a structured running plan is put together and presented. It is not affiliated with, endorsed by, or connected to Runna or Strava. Runna is a Strava product; all trademarks belong to their respective owners.',
      }),
      el('div', {
        class: 't-micro faint',
        text: 'NO ACCOUNT NEEDED. EVERY FEATURE IS FREE, UNGATED AND OFFLINE.',
      }),
    );
  }

  /* ------------------------------------------------------------ assembly */

  function buildBody(animate) {
    const body = el(
      'div',
      { class: 'screen-body' },
      screenHeader({ title: 'Profile', eyebrow: 'RUNNER' }),
      identityCard(),
      levelCard(),
      unitsCard(),
      preferencesCard(),
      dangerCard(),
      aboutCard(),
    );
    if (animate) staggerIn(body, 40, 8);
    return body;
  }

  function render(animate = false) {
    root.textContent = '';
    root.appendChild(buildBody(animate));
  }

  render(false);
}
