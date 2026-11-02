/**
 * Date helpers. All days are UTC and formatted as YYYY-MM-DD, which sorts
 * lexicographically in chronological order (handy in SQL).
 */

/** UTC day string for a Date. */
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Add n days (may be negative) to a YYYY-MM-DD string. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d);
}

/** True for a syntactically valid and real calendar day. */
export function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && utcDay(d) === value;
}
