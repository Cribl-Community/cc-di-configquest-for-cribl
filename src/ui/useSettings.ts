// User-configurable app settings (finding severity tiers + thresholds), persisted
// to the KV store like the theme choice. Defaults apply until the stored value
// loads, so the UI never waits on it.

import { useEffect, useState } from 'react';
import { getJSON, setJSON } from '../kv';
import { DEFAULT_SEVERITY, SEVERITIES, type Severity, type SeverityMap } from '../data/severity';
import { FINDING_LABELS, type FindingCategory } from '../data/types';

const SETTINGS_KEY = 'ui:settings';
const DEFAULT_STALE_DAYS = 90;
const DEFAULT_REFRESH_SECONDS = 300;
export const MIN_REFRESH_SECONDS = 30;

export interface AppSettings {
  severity: SeverityMap;
  staleDays: number;
  /** Re-index the environment on an interval (for always-on oversight screens). */
  autoRefresh: boolean;
  refreshSeconds: number;
}

export function defaultSettings(): AppSettings {
  return {
    severity: { ...DEFAULT_SEVERITY },
    staleDays: DEFAULT_STALE_DAYS,
    autoRefresh: false,
    refreshSeconds: DEFAULT_REFRESH_SECONDS,
  };
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getJSON<Partial<AppSettings>>(SETTINGS_KEY);
      if (!cancelled && stored) setSettings((s) => mergeSettings(s, stored));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = mergeSettings(prev, patch);
      void setJSON(SETTINGS_KEY, next);
      return next;
    });
  };

  return [settings, update];
}

// Merge a (possibly partial or stale-shaped) stored value onto defaults, validating
// each severity tier so an older/hand-edited value can't inject a bad enum.
function mergeSettings(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const severity = { ...base.severity };
  if (patch.severity) {
    for (const c of Object.keys(FINDING_LABELS) as FindingCategory[]) {
      const v = patch.severity[c];
      if (v && (SEVERITIES as readonly string[]).includes(v)) severity[c] = v as Severity;
    }
  }
  const staleDays =
    typeof patch.staleDays === 'number' && Number.isFinite(patch.staleDays) && patch.staleDays > 0
      ? Math.round(patch.staleDays)
      : base.staleDays;
  const autoRefresh = typeof patch.autoRefresh === 'boolean' ? patch.autoRefresh : base.autoRefresh;
  // Store the entered value as-is (so typing isn't fought); the effective interval is
  // floored to MIN_REFRESH_SECONDS where it's actually used (see App's auto-refresh).
  const refreshSeconds =
    typeof patch.refreshSeconds === 'number' && Number.isFinite(patch.refreshSeconds) && patch.refreshSeconds > 0
      ? Math.round(patch.refreshSeconds)
      : base.refreshSeconds;
  return { severity, staleDays, autoRefresh, refreshSeconds };
}
