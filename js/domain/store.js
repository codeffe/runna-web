/**
 * store.js — persistence and the derived state every screen reads.
 *
 * The state object is the single source of truth and the only thing written to
 * localStorage. Its shape is fixed by the web brief:
 *
 *   {
 *     plan,                                  // engine output, or null
 *     athlete: { name, units, ... },         // units: 'kilometers' | 'miles'
 *     runs: [],                              // recorded runs
 *     prefs: {},                             // free-form preferences
 *     completedSessionIds: []                // ids of ticked-off sessions
 *   }
 *
 * NOTHING here imports the engine or domain/format modules: the store must
 * survive those modules changing shape, so every read of `plan` is defensive.
 * A plan may expose its sessions as `plan.weeks[].sessions` or as a flat
 * `plan.sessions[]` — both are understood.
 */

export const STORAGE_KEY = 'runna.state.v1';
export const STATE_VERSION = 1;

/* ------------------------------------------------------------------ dates */

/** Midnight local time for a date-ish value. Returns null if unparseable. */
export function startOfDay(value) {
  const d = toDate(value);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Accepts Date | epoch ms | ISO string (date-only strings stay local). */
export function toDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD — the currency of every date comparison in the app. */
export function dayKey(value) {
  const d = startOfDay(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(value, days) {
  const d = startOfDay(value);
  if (!d) return null;
  const next = new Date(d);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

/** Whole days from a → b (b - a). */
export function diffDays(a, b) {
  const da = startOfDay(a);
  const db = startOfDay(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
}

/** Monday-based start of the calendar week containing `value`. */
export function weekStart(value) {
  const d = startOfDay(value) || startOfDay(new Date());
  const shift = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  return addDays(d, -shift);
}

export function isSameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

/* ----------------------------------------------------------- default state */

export function defaultState() {
  return {
    version: STATE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    plan: null,
    athlete: {
      // Matches the identity baked into the iOS app, so both builds greet the
      // same person. Change it here (or in Profile) to personalise.
      name: 'Swati Dhiman',
      email: 'dhimanswati39@gmail.com',
      units: 'kilometers',
      ability: null,
      goal: null,
      raceDate: null,
      currentTimeSeconds: null,
      currentRaceDistanceMeters: null,
      runsPerWeek: null,
      longRunDay: null,
      volume: null,
      difficulty: null,
    },
    runs: [],
    prefs: {},
    completedSessionIds: [],
  };
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Fill in anything a stored blob is missing so screens can rely on the shape. */
export function normalizeState(raw) {
  const base = defaultState();
  if (!isObject(raw)) return base;

  const state = { ...base, ...raw };
  state.version = STATE_VERSION;
  state.athlete = { ...base.athlete, ...(isObject(raw.athlete) ? raw.athlete : {}) };
  state.runs = Array.isArray(raw.runs) ? raw.runs.filter(isObject) : [];
  state.prefs = isObject(raw.prefs) ? { ...raw.prefs } : {};
  state.completedSessionIds = Array.isArray(raw.completedSessionIds)
    ? raw.completedSessionIds.filter((id) => id !== null && id !== undefined).map(String)
    : [];
  state.plan = isObject(raw.plan) || Array.isArray(raw.plan) ? raw.plan : null;

  if (state.athlete.units !== 'miles') state.athlete.units = 'kilometers';

  // Re-apply completion flags the plan may have lost.
  if (state.plan && state.completedSessionIds.length) {
    for (const session of planSessions(state)) {
      const id = sessionId(session);
      if (id && state.completedSessionIds.includes(id)) {
        session.isCompleted = true;
        session.completed = true;
      }
    }
  }
  return state;
}

/* ------------------------------------------------------------ load / save */

function storage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch {
    // Safari in private mode throws on access.
    return null;
  }
}

/* Signature of the last state this document read or wrote, excluding the
   bookkeeping timestamp. Used by flushState() to avoid writing a stale copy
   over fresher data — e.g. a backgrounded tab that never had a plan being
   swiped away after another tab saved one. */
let lastSignature = null;

function signature(state) {
  try {
    const { updatedAt, ...rest } = state;
    return JSON.stringify(rest);
  } catch {
    return null;
  }
}

/** Read the persisted state, or a fresh one. Never throws. */
export function loadState() {
  const store = storage();
  if (!store) return defaultState();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const state = normalizeState(JSON.parse(raw));
    lastSignature = signature(state);
    return state;
  } catch {
    // Corrupt payload: better a fresh app than a boot loop.
    return defaultState();
  }
}

/** Persist the state. Never throws (quota / private mode are swallowed). */
export function saveState(state) {
  if (!isObject(state)) return false;
  state.updatedAt = new Date().toISOString();
  const sig = signature(state);
  const store = storage();
  if (!store) {
    // Nothing to write to, but remember the signature so a later flush does
    // not keep retrying the same write.
    lastSignature = sig;
    return false;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return false;
  }
  lastSignature = sig;
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('runna:state', { detail: { state } }));
    }
  } catch {
    /* CustomEvent is a nicety */
  }
  return true;
}

/**
 * Save on the way out (pagehide / tab hidden), but only if this document has
 * actually changed something since it last read or wrote the store. Without
 * this guard an idle tab would overwrite whatever a newer tab saved.
 *
 * @returns {boolean} true if a write happened
 */
export function flushState(state) {
  if (!isObject(state)) return false;
  const sig = signature(state);
  if (sig !== null && sig === lastSignature) return false;
  return saveState(state);
}

/** Wipe everything and hand back a fresh state. */
export function resetState() {
  const store = storage();
  if (store) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  const fresh = defaultState();
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('runna:reset', { detail: { state: fresh } }));
    }
  } catch {
    /* ignore */
  }
  return fresh;
}

/* --------------------------------------------------------- plan accessors */

/** Every session in the plan, flattened. Always an array. */
export function planSessions(state) {
  const plan = state && state.plan;
  if (!plan) return [];
  if (Array.isArray(plan)) return plan.filter(isObject);
  if (Array.isArray(plan.sessions)) return plan.sessions.filter(isObject);
  if (Array.isArray(plan.weeks)) {
    const out = [];
    for (const week of plan.weeks) {
      if (!isObject(week)) continue;
      const list = Array.isArray(week.sessions) ? week.sessions : [];
      // The engine names this `weekIndex` (1-based); accept the other spellings.
      const weekNumber = week.weekIndex ?? week.number
        ?? (week.index !== undefined ? Number(week.index) + 1 : undefined);
      for (const session of list) {
        if (!isObject(session)) continue;
        if (session.weekIndex === undefined && weekNumber !== undefined) session.weekIndex = weekNumber;
        if (!session.date && week.startDate) {
          const dayIndex = Number(session.dayIndex);
          if (Number.isFinite(dayIndex)) session.date = addDays(week.startDate, dayIndex);
        }
        out.push(session);
      }
    }
    return out;
  }
  return [];
}

/** Stable-enough identity for a session (engine ids win, then date+type). */
export function sessionId(session) {
  if (!session || typeof session !== 'object') return '';
  if (session.id !== undefined && session.id !== null) return String(session.id);
  const date = dayKey(session.date);
  const type = session.runType && typeof session.runType === 'object'
    ? (session.runType.key || session.runType.id || '')
    : session.runType || session.type || '';
  return date ? `${date}:${type}` : '';
}

function sessionDate(session) {
  return startOfDay(session && (session.date || session.startDate || session.scheduledDate));
}

export function isSessionCompleted(state, session) {
  if (!session) return false;
  if (session.isCompleted || session.completed || session.done) return true;
  const id = sessionId(session);
  return !!id && Array.isArray(state?.completedSessionIds) && state.completedSessionIds.includes(id);
}

/**
 * True for a rest day. The engine emits a `runType: 'rest'` session for every
 * non-training day, so this is the difference between "nothing scheduled" and
 * "scheduled nothing" — the streak rule cares.
 */
export function isRestSession(session) {
  const type = session && (session.runType ?? session.type);
  const key = typeof type === 'string' ? type : (type && (type.key || type.id));
  return String(key || '').toLowerCase() === 'rest';
}

/** Non-rest sessions only. */
export function trainingSessions(state) {
  return planSessions(state).filter((s) => !isRestSession(s));
}

/** Sessions planned for one calendar day (local), in plan order. */
export function sessionsOn(state, date) {
  const key = dayKey(date);
  if (!key) return [];
  return planSessions(state).filter((s) => dayKey(s.date) === key);
}

/** The plan's own week object containing `date`, if it has one. */
function planWeekContaining(state, date) {
  const plan = state && state.plan;
  if (!isObject(plan) || !Array.isArray(plan.weeks)) return null;
  const target = startOfDay(date);
  if (!target) return null;
  for (const week of plan.weeks) {
    if (!isObject(week)) continue;
    const start = startOfDay(week.startDate || week.start);
    if (!start) continue;
    const end = addDays(start, 7);
    if (target >= start && target < end) return week;
  }
  return null;
}

/**
 * The week containing `date`.
 *
 * @returns {{index:number, number:number, start:Date, end:Date, days:Array,
 *            sessions:Array, week:object|null, completed:number, total:number,
 *            distanceMeters:number}}
 */
export function weekFor(state, date = new Date()) {
  const target = startOfDay(date) || startOfDay(new Date());
  const week = planWeekContaining(state, target);
  const start = week ? (startOfDay(week.startDate || week.start) || weekStart(target)) : weekStart(target);
  const end = addDays(start, 7);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const sessions = sessionsOn(state, day);
    days.push({ date: day, sessions, session: sessions[0] || null, index: i });
  }

  const sessions = days.flatMap((d) => d.sessions);
  const completed = sessions.filter((s) => isSessionCompleted(state, s)).length;
  const distanceMeters = sessions.reduce((sum, s) => sum + (Number(s.distanceMeters) || 0), 0);

  // The engine's week carries a 1-based `weekIndex`; fall back to counting
  // weeks from the plan start when a plan does not say.
  const rawNumber = week
    ? (week.weekIndex ?? week.number ?? (week.index !== undefined ? Number(week.index) + 1 : undefined))
    : undefined;
  const number = Number.isFinite(Number(rawNumber))
    ? Number(rawNumber)
    : Math.max(0, Math.floor(diffDays(planStartDate(state) || start, start) / 7)) + 1;

  return {
    index: number - 1,
    number,
    start,
    end,
    days,
    sessions,
    week: week || null,
    completed,
    total: sessions.length,
    distanceMeters,
  };
}

export function planStartDate(state) {
  const plan = state && state.plan;
  if (!isObject(plan)) return null;
  return startOfDay(plan.startDate || plan.start || null);
}

export function planRaceDate(state) {
  const plan = state && state.plan;
  if (!isObject(plan)) return null;
  return startOfDay(plan.raceDate || plan.endDate || null);
}

export function daysToRace(state, from = new Date()) {
  const race = planRaceDate(state);
  if (!race) return null;
  return diffDays(from, race);
}

/** Total weeks in the plan, if it says. */
export function planWeekCount(state) {
  const plan = state && state.plan;
  if (!isObject(plan)) return 0;
  if (Array.isArray(plan.weeks)) return plan.weeks.length;
  const n = Number(plan.planLength ?? plan.weeks ?? plan.totalWeeks ?? plan.weekCount);
  return Number.isFinite(n) ? n : 0;
}

/** The week number (1-based) of the current date within the plan. */
export function currentWeekNumber(state, date = new Date()) {
  return weekFor(state, date).number;
}

/* --------------------------------------------------------------- today etc */

/** Today's session, or null on a rest day. */
export function todaysSession(state, date = new Date()) {
  const sessions = sessionsOn(state, date);
  if (!sessions.length) return null;
  // Prefer something not yet done, so a double-session day shows what's left.
  return sessions.find((s) => !isSessionCompleted(state, s)) || sessions[0];
}

/** The next scheduled session strictly after `date`. */
export function nextSession(state, date = new Date()) {
  const from = startOfDay(date);
  if (!from) return null;
  const upcoming = planSessions(state)
    .filter((s) => {
      const d = sessionDate(s);
      return d && d > from;
    })
    .sort((a, b) => sessionDate(a) - sessionDate(b));
  return upcoming[0] || null;
}

/** How many sessions of the plan are ticked off. */
export function completedCount(state) {
  const sessions = planSessions(state);
  if (sessions.length) return sessions.filter((s) => isSessionCompleted(state, s)).length;
  return Array.isArray(state?.completedSessionIds) ? state.completedSessionIds.length : 0;
}

/** Plan completion as 0…1 (by session count). */
export function planProgress(state) {
  const total = planSessions(state).length;
  if (!total) return 0;
  return Math.min(1, completedCount(state) / total);
}

/**
 * Consecutive days of training, walking back from today.
 *
 * Rest days (the engine emits an explicit `runType: 'rest'` session for every
 * non-training day) neither count nor break the streak — otherwise every plan
 * with a rest day would cap the streak at one. Today's session does not break
 * it either, while the day is still in progress.
 */
export function currentStreak(state, date = new Date()) {
  const done = new Set();
  const planned = new Set();

  for (const session of planSessions(state)) {
    const key = dayKey(session.date);
    if (!key) continue;
    // Rest is not training: it can neither make nor break a streak.
    if (isRestSession(session)) continue;
    planned.add(key);
    if (isSessionCompleted(state, session)) done.add(key);
  }
  for (const run of Array.isArray(state?.runs) ? state.runs : []) {
    const key = dayKey(run.date || run.startDate || run.startedAt);
    if (key) done.add(key);
  }

  let streak = 0;
  const today = startOfDay(date) || startOfDay(new Date());
  for (let i = 0; i < 400; i++) {
    const key = dayKey(addDays(today, -i));
    const wasDone = done.has(key);
    const wasPlanned = planned.has(key);
    if (wasDone) {
      streak += 1;
    } else if (!wasPlanned && i > 0) {
      // Rest day: skip it without breaking or counting.
      continue;
    } else if (i > 0) {
      break;
    }
    // i === 0 and nothing done: today is still open — keep walking back.
  }
  return streak;
}

/** Longest streak on record (nice for the Progress screen). */
export function longestStreak(state) {
  const days = new Set();
  for (const session of planSessions(state)) {
    if (isSessionCompleted(state, session)) {
      const key = dayKey(session.date);
      if (key) days.add(key);
    }
  }
  for (const run of Array.isArray(state?.runs) ? state.runs : []) {
    const key = dayKey(run.date || run.startDate || run.startedAt);
    if (key) days.add(key);
  }
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of sorted) {
    run = previous && diffDays(previous, key) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

/* -------------------------------------------------------------- mutations */

/** Normalise a recorded run before it goes into state.runs. */
export function normalizeRun(run = {}) {
  const date = run.date || run.startDate || run.startedAt || new Date().toISOString();
  const distanceMeters = Number(run.distanceMeters);
  const durationSeconds = Number(run.durationSeconds);
  const id = run.id !== undefined && run.id !== null
    ? String(run.id)
    : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    date,
    type: run.type || 'easyRun',
    title: run.title || '',
    distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    paceSecondsPerKm: Number.isFinite(Number(run.paceSecondsPerKm))
      ? Number(run.paceSecondsPerKm)
      : (Number.isFinite(distanceMeters) && distanceMeters > 0 && Number.isFinite(durationSeconds)
          ? durationSeconds / (distanceMeters / 1000)
          : 0),
    effort: run.effort || null,
    notes: run.notes || '',
    sessionId: run.sessionId !== undefined && run.sessionId !== null ? String(run.sessionId) : null,
    source: run.source || 'manual',
  };
}

/** Append a run and persist. Returns the stored run. */
export function addRun(state, run) {
  if (!state || typeof state !== 'object') return null;
  if (!Array.isArray(state.runs)) state.runs = [];
  const stored = normalizeRun(run || {});
  state.runs.push(stored);
  saveState(state);
  return stored;
}

/**
 * Tick a session off: records the id, flags the plan object, optionally files
 * a run, then persists. Idempotent — completing twice will not duplicate the
 * run or the id.
 */
export function markSessionComplete(state, id, run) {
  if (!state || typeof state !== 'object') return state;
  const key = id === undefined || id === null ? '' : String(id);

  if (key) {
    if (!Array.isArray(state.completedSessionIds)) state.completedSessionIds = [];
    if (!state.completedSessionIds.includes(key)) state.completedSessionIds.push(key);
    for (const session of planSessions(state)) {
      if (sessionId(session) === key) {
        session.isCompleted = true;
        session.completed = true;
        if (session.completedAt === undefined) session.completedAt = new Date().toISOString();
      }
    }
  }

  if (run) {
    const payload = { ...run };
    if (key && payload.sessionId === undefined) payload.sessionId = key;
    const already = payload.sessionId
      && state.runs.some((r) => String(r.sessionId) === String(payload.sessionId));
    if (!already) addRun(state, payload);
  }

  saveState(state);
  return state;
}

/** Undo a completion (long-press / swipe on the Today screen). */
export function markSessionIncomplete(state, id) {
  if (!state || typeof state !== 'object') return state;
  const key = String(id);
  state.completedSessionIds = (state.completedSessionIds || []).filter((x) => String(x) !== key);
  for (const session of planSessions(state)) {
    if (sessionId(session) === key) {
      session.isCompleted = false;
      session.completed = false;
      delete session.completedAt;
    }
  }
  saveState(state);
  return state;
}

/** Set a preference and persist. */
export function setPref(state, key, value) {
  if (!state || typeof state !== 'object') return state;
  if (!state.prefs || typeof state.prefs !== 'object') state.prefs = {};
  state.prefs[key] = value;
  saveState(state);
  return state;
}

/** Replace the plan (onboarding finish / regeneration) and persist. */
export function setPlan(state, plan) {
  if (!state || typeof state !== 'object') return state;
  state.plan = plan || null;
  state.completedSessionIds = [];
  saveState(state);
  return state;
}

/**
 * Attach a plan and everything that came with it. Screens call this at the end
 * of onboarding: `applyPlan(state, { plan, athlete })` then `navigate('today')`.
 */
export function applyPlan(state, patch = {}) {
  if (!state || typeof state !== 'object') return state;
  if (patch.plan !== undefined) state.plan = patch.plan;
  if (isObject(patch.athlete)) state.athlete = { ...state.athlete, ...patch.athlete };
  if (isObject(patch.prefs)) state.prefs = { ...state.prefs, ...patch.prefs };
  if (patch.completedSessionIds) state.completedSessionIds = [];
  if (!state.createdAt) state.createdAt = new Date().toISOString();
  saveState(state);
  return state;
}

export default {
  STORAGE_KEY,
  STATE_VERSION,
  defaultState,
  normalizeState,
  loadState,
  saveState,
  flushState,
  resetState,
  planSessions,
  sessionId,
  sessionsOn,
  isSessionCompleted,
  isRestSession,
  trainingSessions,
  weekFor,
  weekStart,
  planStartDate,
  planRaceDate,
  daysToRace,
  planWeekCount,
  currentWeekNumber,
  todaysSession,
  nextSession,
  completedCount,
  planProgress,
  currentStreak,
  longestStreak,
  normalizeRun,
  addRun,
  markSessionComplete,
  markSessionIncomplete,
  setPref,
  setPlan,
  applyPlan,
  startOfDay,
  addDays,
  diffDays,
  dayKey,
  isSameDay,
  toDate,
};
