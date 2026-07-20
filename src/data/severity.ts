// Severity tiers for config-hygiene findings. Tiers drive how the Overview orders
// and colours findings (critical first, in red; advisory last, in neutral) and are
// user-configurable in Settings — so each team decides what counts as urgent.

import type { FindingCategory } from './types';

export type Severity = 'critical' | 'warning' | 'advisory' | 'off';

/** Sensible defaults: reachability/data-loss risks are critical, structural cruft is
 *  a warning, and intentional-by-design states (disabled, aging) are advisory. */
export const DEFAULT_SEVERITY: Record<FindingCategory, Severity> = {
  'unreachable-route': 'critical',
  'dangling-route': 'critical',
  'dead-end-destination': 'critical',
  'orphaned-pipeline': 'warning',
  'unused-lookup': 'warning',
  'dead-end-source': 'warning',
  disabled: 'advisory',
  'stale-object': 'advisory',
};

/** Sort rank: lower sorts first (critical → warning → advisory → off). */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, advisory: 2, off: 3 };

export const SEVERITIES: readonly Severity[] = ['critical', 'warning', 'advisory', 'off'];

export type SeverityMap = Record<FindingCategory, Severity>;
