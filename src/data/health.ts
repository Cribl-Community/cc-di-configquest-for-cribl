// Operational health per object, from the group-context status endpoints. This
// is the one live-metric surface an embedded app can actually reach (verified:
// throughput/volume metrics 404). Degrades to "unavailable" when denied — the
// same graceful pattern as git age/owner.

import { apiGet, type ApiOptions } from './apiClient';
import type { HealthMap, HealthState, KORecord } from './types';
import { asRecord, itemsOf, str } from './raw';

export interface HealthResult {
  /** False when every status call was denied — hide the health UI. */
  available: boolean;
  map: HealthMap;
}

export async function fetchHealth(groups: string[], opts: ApiOptions = {}): Promise<HealthResult> {
  const map: HealthMap = {};
  let anyOk = false;
  for (const group of groups) {
    const base = `/m/${encodeURIComponent(group)}/system/status`;
    const [inputs, outputs] = await Promise.allSettled([
      apiGet<unknown>(`${base}/inputs`, opts),
      apiGet<unknown>(`${base}/outputs`, opts),
    ]);
    if (mergeStatus(group, 'source', inputs, map)) anyOk = true;
    if (mergeStatus(group, 'destination', outputs, map)) anyOk = true;
  }
  return { available: anyOk, map };
}

/** Return new records enriched with health from the map. */
export function applyHealth(records: KORecord[], map: HealthMap): KORecord[] {
  return records.map((r) => {
    const health = map[r.key];
    return health ? { ...r, health } : r;
  });
}

function mergeStatus(
  group: string,
  type: 'source' | 'destination',
  res: PromiseSettledResult<unknown>,
  map: HealthMap,
): boolean {
  if (res.status !== 'fulfilled') return false;
  for (const item of itemsOf(res.value)) {
    const obj = asRecord(item);
    const id = obj && str(obj, 'id');
    if (!obj || !id) continue;
    const status = asRecord(obj['status']);
    const health = normalizeHealth(status ? str(status, 'health') : undefined);
    if (health) map[`${group}/-/${type}/${id}`] = health;
  }
  return true;
}

function normalizeHealth(value: string | undefined): HealthState | undefined {
  switch (value?.toLowerCase()) {
    case 'green':
      return 'green';
    case 'yellow':
      return 'yellow';
    case 'red':
      return 'red';
    default:
      return undefined;
  }
}
