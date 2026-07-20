// Relative-time formatting via Intl (no date library).

import type { HealthState } from '../data/types';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1_000],
];

/** The short commit hash shown consistently wherever a commit id appears (list, header,
 *  history, activity), so the same commit never reads as two different ids. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** The right form of a word for a count — returns the noun/verb only (the caller supplies the
 *  number), so counted strings read "1 object" / "2 objects" instead of "1 objects". Irregular
 *  forms pass an explicit plural, e.g. `plural(n, "doesn't", "don't")`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** Title-case a lowercase word for a chip/label (e.g. a filter value "disabled" → "Disabled"). */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The health badge word for a raw health color — green is healthy, red/yellow unhealthy,
 *  absent unknown. Shared so the Browse badge and the detail drawer never disagree. */
export function healthTag(health: HealthState | undefined): 'healthy' | 'unhealthy' | 'unknown' {
  return health === 'green' ? 'healthy' : health === 'red' || health === 'yellow' ? 'unhealthy' : 'unknown';
}

/** "3 days ago", "in 2 hours", etc. */
export function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const diff = t - Date.now(); // negative for the past
  const abs = Math.abs(diff);
  for (const [unit, ms] of UNITS) {
    if (abs >= ms || unit === 'second') return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}
