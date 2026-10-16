# Web build brief

A **no-build, no-dependency** mobile web app: the Runna clone, for an iPhone-only
audience. It is opened in Safari and added to the Home Screen, where it runs
fullscreen with its own icon — indistinguishable from an app to the person using it.

## Hard constraints

- **No build step.** Native ES modules loaded with `<script type="module">`.
  No bundler, no npm packages, no framework, no TypeScript. Plain `.js` + `.css`.
  The whole thing is static files served from GitHub Pages.
- **No dependencies at all.** No React, no Tailwind, no icon fonts. SF Symbols are
  not available on the web — use inline SVG or Unicode.
- **iOS Safari is the target.** Design for a 390×844 viewport first.
- **Works offline** after first load (service worker), because a Home Screen app
  that breaks without signal is worse than no app.

## iOS Safari specifics you must handle

- `viewport-fit=cover` + `env(safe-area-inset-*)` padding, or the tab bar sits
  under the home indicator and the header under the notch.
- Use `100dvh`, never `100vh` — `vh` is wrong when Safari's toolbars are showing.
- `-webkit-tap-highlight-color: transparent` and `touch-action: manipulation`
  to kill the grey tap flash and the 300 ms delay.
- `-webkit-overflow-scrolling: touch` and `overscroll-behavior-y: contain` on
  scroll containers so the page doesn't rubber-band the whole document.
- `apple-mobile-web-app-capable` + `apple-mobile-web-app-status-bar-style` in the
  head, plus a `manifest.webmanifest` with `display: standalone`.
- `apple-touch-icon` (180×180 PNG) or the Home Screen icon is a grey screenshot.
- Use `:active` states, not `:hover` — there is no hover on a phone.

## Architecture

```
web/
  index.html                 shell: head meta, #app root, module script
  manifest.webmanifest
  sw.js                      cache-first service worker
  icons/                     icon-180.png, icon-192.png, icon-512.png
  css/
    tokens.css               design tokens (colours, type, spacing, radii)
    app.css                  layout, components, screens
  js/
    engine/enums.js          Goal, Ability, RunType, PaceZone, Terrain, ...
    engine/raceMath.js       Riegel + Daniels VDOT, pace derivation
    engine/planGenerator.js  periodisation, volume ladder, session mix
    engine/sessionLibrary.js structured workouts
    domain/store.js          localStorage persistence + state
    domain/format.js         distance/pace/duration formatting + units
    ui/components.js         reusable DOM builders
    ui/motion.js             animations (CSS-driven + Web Animations API)
    screens/*.js             one module per screen
    app.js                   router + tab bar + boot
  test/engine.test.mjs       node --test, proves the ported maths is correct
```

## Design tokens — copy these exactly from the iOS app

```
bg #181B21   surface #1F262C   raised #272F36   sunken #12161A
stroke #39434C   strokeSoft #2A323A
primary #35CCB6   onPrimary #0B1F1C   brightGreen #34EC7D
text #FFFFFF   textSecondary #E2E8F0   textMuted #AEB4BF   textFaint #586169
gold #E3A008   danger #E5484D   warning #F5A524   success #30A46C   violet #7C52AD
```

Session-type accents (from the live iOS client):
```
easyRun #9FBE19  longRun #7C52AD  tempo #E3A008  intervals #DC4F27
hills #DB4B29    strength #E05562  recovery #6FBF73  race #35CCB6
progression #4FA8E0  timeTrial #E05562  rest #586169
```

Type: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`.
Card radius 20px, chip 12px, button 28px, gutter 20px.

## Product facts — do not get these wrong

- Trains from **one Estimated Race Time** representing *current* ability, **never a
  goal time**.
- Two independent preference axes: **Training Volume** (Progressive / Steady /
  Gradual) × **Difficulty** (Challenging / Balanced / Comfortable).
- Ability levels gate runs per week: Beginner/Intermediate 2–4, Advanced 2–6,
  Elite/Elite+ 2–7.
- Plans are 6–26 weeks, hard cap 26.
- Workout grammar: **Warm-up → Set (repeating reps) → Rest → Cool-down**.
- **Fartlek is not a Runna session type.** Do not add it.
- **No premium, no paywall, no pricing, no upsell anywhere.** Every feature is free.

## Screens to build

| Screen | Contents |
|---|---|
| **Onboarding** | Wizard: goal → race date → ability → current 5K/10K/Half time → runs/week → long-run day → volume × difficulty → units → plan length. Progress bar, animated step transitions. Generates a plan on finish. |
| **Today** | Today's session (type, distance, duration, pace target, steps), weekly mileage ring + stats, streak, a start-run button (a timer-based run recorder, browser `navigator.geolocation` optional), next session. |
| **Plan** | Header with plan shield, progress, days to race; week cards with sessions; mileage bar chart; pace zones; estimated race times. |
| **Progress** | Completed activity list, weekly mileage chart, personal bests, all-time stats, achievements. |
| **Calendar** | Month grid with per-day session dots, tap a day to see sessions. |
| **Profile** | Name, units, notification-ish preferences, reset data. |

## Motion

Everything animates, tastefully, using the **same springs as the native app**:

- entrances stagger by 40 ms per child
- numbers count up (animate a value and re-render the text)
- progress rings/bars animate their fill on appear
- cards scale to 0.985 and light their border on `:active`
- screen changes cross-fade + slide 12px
- `@media (prefers-reduced-motion: reduce)` disables all of it

Keep animations on `transform` and `opacity` only — never animate `width`,
`height`, `top` or `left`, which forces layout on every frame and is the main
reason mobile web apps feel sluggish.

## Verification (required)

- `node --test web/test/engine.test.mjs` must pass, and must reproduce the same
  numbers as the Swift engine: 5K 20:00 → VDOT 49.8, 10K 47:00 → 43.0,
  marathon 3:00:00 → 53.5, marathon 4:00:00 → 37.9. A 47:00 10K must give an
  Easy pace band of roughly 5:43–6:31 /km.
- No console errors on load, on navigation, or after adding to the Home Screen.
