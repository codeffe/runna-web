// Formatting helpers.
//
// Direct port of `Fmt` and the `Units` enum from the native app
// (app/Runna/DesignSystem/Theme.swift) so every number on the web reads
// identically to the iOS build.
//
// All distances are stored in METRES and all paces in SECONDS PER KILOMETRE
// internally. Conversion to miles happens only at the point of display.

export const KM_PER_MILE = 1.609344;

/** Unit metadata. Mirrors the Swift `Units` enum. */
export const UNIT_DEFS = {
  kilometers: { key: 'kilometers', title: 'Kilometers', short: 'km', suffix: 'km', metersPerUnit: 1000 },
  // 1609.344 METRES per mile. (KM_PER_MILE above is kilometres per mile and is
  // used for the pace conversion, where multiplying seconds-per-km by
  // kilometres-per-mile gives seconds-per-mile.)
  miles:      { key: 'miles',      title: 'Miles',      short: 'mi', suffix: 'mi', metersPerUnit: 1609.344 },
};

/** Accepts either a units key ('kilometers') or an object; always returns the object. */
function def(units) {
  if (!units) return UNIT_DEFS.kilometers;
  if (typeof units === 'string') return UNIT_DEFS[units] ?? UNIT_DEFS.kilometers;
  return units;
}

/**
 * "1:02:05" over an hour, "5:05" under it. Matches `Fmt.duration`.
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * "5:05 /km" — pace in seconds per kilometre, displayed in the chosen unit.
 */
export function formatPace(secondsPerKm, units) {
  const short = formatPaceShort(secondsPerKm, units);
  if (short === '--:--') return short;
  return `${short} /${def(units).suffix}`;
}

/** "5:05" — no unit suffix, for dense rows. */
export function formatPaceShort(secondsPerKm, units) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '--:--';
  const u = def(units);
  // Seconds per km -> seconds per displayed unit.
  const v = u.key === 'kilometers' ? secondsPerKm : secondsPerKm * KM_PER_MILE;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  // Rounding seconds can produce 60 (e.g. 4:59.6) — carry it into the minute.
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "8.04" — bare number, two decimals under 100. */
export function formatDistance(meters, units) {
  const u = def(units);
  if (!Number.isFinite(meters)) return '0.00';
  const v = meters / u.metersPerUnit;
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

/** "8.04 km" */
export function formatDistanceWithUnit(meters, units) {
  const u = def(units);
  return `${formatDistance(meters, u)} ${u.suffix}`;
}

/** Speed in metres/second -> pace in seconds per km. Used by the run recorder. */
export function paceFromSpeed(metersPerSecond) {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0.3) return 0;
  return 1000 / metersPerSecond;
}

/** "5K", "10K", "Half Marathon", "Marathon" */
export function formatRaceDistance(meters, units) {
  switch (Math.round(meters)) {
    case 5000: return '5K';
    case 10000: return '10K';
    case 21098: case 21097: return 'Half Marathon';
    case 42195: return 'Marathon';
    default: return formatDistanceWithUnit(meters, units);
  }
}

/** "17-23 Jul" — the date range the iOS week cards use. */
export function formatDateRange(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  const day = (d) => d.getDate();
  const month = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  if (a.getMonth() === b.getMonth()) return `${day(a)}-${day(b)} ${month(b)}`;
  return `${day(a)} ${month(a)} - ${day(b)} ${month(b)}`;
}

/** "Fri 16 Oct" */
export function formatDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "today" / "tomorrow" / "yesterday" / "Fri 16 Oct" */
export function relativeDay(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return formatDate(d);
}

/** "Mon" */
export function weekdayShort(date) {
  return new Date(date).toLocaleDateString(undefined, { weekday: 'short' });
}

/** Midnight local time. */
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole days from a to b. */
export function daysBetween(a, b) {
  return Math.round((startOfDay(new Date(b)) - startOfDay(new Date(a))) / 86400000);
}

/** ISO date string (date only) — the storage format for plan dates. */
export function toISODate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
