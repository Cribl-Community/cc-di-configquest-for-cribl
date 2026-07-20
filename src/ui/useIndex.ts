// Owns the in-memory index and its lifecycle: hydrate from a KV snapshot for
// instant startup, cold-build when empty, and refresh on demand. The git-backed
// age map is built in the background so search/findings never wait on it.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgeInfo, AgeMap, FetchReport, HealthMap, KORecord } from '../data/types';
import { ApiError } from '../data/types';
import { fetchOrg } from '../data/fetchOrg';
import { appTransport } from './appTransport';
import { flatten, normalizeOrg } from '../data/normalize';
import { buildAgeMap, type AgeCheckpoint } from '../data/git/ageIndex';
import { fetchHealth } from '../data/health';
import { loadSnapshot, saveSnapshot } from '../data/snapshot';
import { getChunkedArray, getJSON, setChunkedArray, setJSON, setJSONDetailed } from '../kv';

const AGEMAP_KEY = 'index:agemap';
const LASTCOMMIT_KEY = 'index:lastcommit';
const AGEMAP_VERSION_KEY = 'index:ageversion';
// Bump when the git file→record path mapping changes, so an age map persisted by an
// older mapper is rebuilt from scratch rather than extended incrementally (which
// would leave now-mappable objects permanently blank). v2: pack objects map under
// `groups/<g>/<default|local>/<packId>/…` — previously unmapped, so undated. v3: the map
// is stored as byte-bounded chunks (a full-org map exceeds the ~100 KB KV cap and 413'd as
// a single value); a v2 single-value marker is discarded so the map rebuilds in the new form.
const AGEMAP_VERSION = 3;

export type IndexStatus = 'hydrating' | 'building' | 'ready' | 'error';

export interface IndexState {
  status: IndexStatus;
  /** Structural records only — its identity changes on a real (re)fetch, NOT when the git age
   *  map or health land. Age/health ride in separate maps so the graph, hygiene findings, and
   *  coverage (which depend only on structure) aren't recomputed every time enrichment arrives. */
  records: KORecord[];
  /** Git age/owner per record key, merged into the display list by the consumer. */
  ageMap: AgeMap;
  /** Operational health per record key, merged into the display list by the consumer. */
  healthMap: HealthMap;
  report: FetchReport | null;
  builtAt: string | null;
  error: string | null;
  refreshing: boolean;
  ageAvailable: boolean;
  ageLoading: boolean;
  ageTruncated: boolean;
  healthAvailable: boolean;
  healthLoading: boolean;
  refresh: () => void;
}

export function useIndex(): IndexState {
  const [records, setRecords] = useState<KORecord[]>([]);
  const [ageMap, setAgeMap] = useState<AgeMap>({});
  const [healthMap, setHealthMap] = useState<HealthMap>({});
  const [report, setReport] = useState<FetchReport | null>(null);
  const [builtAt, setBuiltAt] = useState<string | null>(null);
  const [status, setStatus] = useState<IndexStatus>('hydrating');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ageAvailable, setAgeAvailable] = useState(false);
  const [ageLoading, setAgeLoading] = useState(false);
  const [ageTruncated, setAgeTruncated] = useState(false);
  const [healthAvailable, setHealthAvailable] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);

  // Fetch the org and persist a fresh snapshot. Returns the new records.
  const buildIndex = useCallback(async (): Promise<KORecord[]> => {
    const raw = await fetchOrg({ transport: await appTransport() });
    const built = normalizeOrg(raw);
    // Only the structural records change here; the age/health maps stay in their own state and
    // are re-merged by the consumer, so a refresh doesn't blank the "modified" column or the
    // health panels and then refill — no flash, and no carry-over bookkeeping needed.
    setRecords(built);
    setReport(raw.report);
    setBuiltAt(raw.report.builtAt);
    void saveSnapshot(built, raw.report); // best-effort chunked persist for fast startup
    return built;
  }, []);

  // Build the age map in the background and enrich records when it lands.
  const buildAge = useCallback(async (base: KORecord[]): Promise<void> => {
    setAgeLoading(true);
    try {
      const previous = await loadCheckpoint();
      const age = await buildAgeMap({
        records: base,
        previous,
        transport: await appTransport(),
        // Render "recently changed" and the modified column as soon as the newest
        // commits are attributed, while the rest of the walk continues.
        onProgress: (map) => {
          setAgeAvailable(true);
          setAgeMap(map);
        },
      });
      setAgeAvailable(age.available);
      setAgeTruncated(age.truncated);
      if (age.available) {
        const pruned = pruneToKeys(age.map, base);
        setAgeMap(pruned);
        // Persist the age map as byte-bounded chunks, then only advance the version marker if
        // every chunk and the commit marker actually reached the SHARED store. A full-org map
        // exceeds the ~100 KB KV cap, so a single-value write 413'd remotely while localStorage
        // accepted it — the version then pointed at a map that wasn't in the shared store,
        // so loadCheckpoint returned nothing and the whole walk re-ran on every open.
        void (async () => {
          const mapOk = await setChunkedArray(AGEMAP_KEY, Object.entries(pruned));
          const commitOk = (await setJSONDetailed(LASTCOMMIT_KEY, age.lastCommit)).remoteOk;
          if (mapOk && commitOk) void setJSON(AGEMAP_VERSION_KEY, AGEMAP_VERSION);
        })();
      }
    } catch {
      setAgeAvailable(false); // age is best-effort; never blocks search/findings
    } finally {
      setAgeLoading(false);
    }
  }, []);

  // Health is volatile, so it's fetched fresh (never persisted) whenever records land.
  const buildHealth = useCallback(async (base: KORecord[]): Promise<void> => {
    const groups = [...new Set(base.map((r) => r.group))];
    if (groups.length === 0) return;
    setHealthLoading(true);
    try {
      const { available, map } = await fetchHealth(groups, { transport: await appTransport() });
      setHealthAvailable(available);
      if (available) setHealthMap(map);
    } catch {
      setHealthAvailable(false);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const init = useCallback(async (): Promise<void> => {
    // Only trust a snapshot fully written by the current schema version; a mismatch (or a
    // snapshot that only partly persisted — see saveSnapshot) means the type set/format
    // changed or the write was incomplete, so rebuild rather than serve a stale index.
    const snapshot = await loadSnapshot();
    if (snapshot && snapshot.records.length > 0) {
      // Rebuild the derived searchText that was stripped before persisting (older
      // snapshots that still carry it are left as-is).
      const hydrated = snapshot.records.map((r) => (r.searchText?.length ? r : { ...r, searchText: flatten(r.raw) }));
      const checkpoint = await loadCheckpoint();
      if (checkpoint) {
        setAgeMap(checkpoint.map);
        setAgeAvailable(true);
      }
      setRecords(hydrated);
      setReport(snapshot.report ?? null);
      setBuiltAt(snapshot.builtAt ?? null);
      setStatus('ready');
      void buildHealth(hydrated);
      // No valid age map (fresh, or built by a superseded mapper) → (re)build in the background.
      if (!checkpoint) void buildAge(hydrated);
      return;
    }
    setStatus('building');
    try {
      const built = await buildIndex();
      setStatus('ready');
      void buildAge(built);
      void buildHealth(built);
    } catch (err) {
      setError(errorMessage(err));
      setStatus('error');
    }
  }, [buildIndex, buildAge, buildHealth]);

  // Run once. The ref guard survives React StrictMode's dev remount, and we
  // intentionally don't cancel on cleanup (a single-screen app never unmounts
  // during use, and each request already has the platform's 30s timeout).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void init();
  }, [init]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        const built = await buildIndex();
        setStatus('ready');
        setError(null);
        void buildHealth(built);
        await buildAge(built);
      } catch (err) {
        setError(errorMessage(err));
        setStatus('error');
      } finally {
        setRefreshing(false);
      }
    })();
  }, [buildIndex, buildAge, buildHealth]);

  return {
    status,
    records,
    ageMap,
    healthMap,
    report,
    builtAt,
    error,
    refreshing,
    ageAvailable,
    ageLoading,
    ageTruncated,
    healthAvailable,
    healthLoading,
    refresh,
  };
}

async function loadCheckpoint(): Promise<AgeCheckpoint | undefined> {
  // A checkpoint from a superseded mapper version is discarded so the age map is
  // rebuilt in full (incremental extension can't backfill newly-mappable objects).
  if ((await getJSON<number>(AGEMAP_VERSION_KEY)) !== AGEMAP_VERSION) return undefined;
  const entries = await getChunkedArray<[string, AgeInfo]>(AGEMAP_KEY);
  const lastCommit = await getJSON<string>(LASTCOMMIT_KEY);
  return entries && lastCommit ? { map: Object.fromEntries(entries), lastCommit } : undefined;
}

function pruneToKeys(map: AgeMap, records: KORecord[]): AgeMap {
  const valid = new Set(records.map((r) => r.key));
  const out: AgeMap = {};
  for (const [key, info] of Object.entries(map)) {
    if (valid.has(key)) out[key] = info;
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Access denied listing Worker Groups. You may not have config read permission, or the app's policies.yml needs those paths.";
    return `Could not load Worker Groups (${err.kind}${err.status ? ` ${err.status}` : ''}).`;
  }
  return err instanceof Error ? err.message : 'Unknown error building the index.';
}
