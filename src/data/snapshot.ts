// KV persistence of the org index. A large org's records (raw config for every object)
// exceed the KV per-value size cap (~100 KB, measured against the Leader), so the index is
// split across chunk values. The version key is invalidated FIRST and written LAST, so a
// snapshot that only partly persisted — or whose write was rejected as too large — is never
// loaded: the app cold-rebuilds instead of serving a stale/older index (the upgrade-staleness
// bug).
//
// The snapshot is SHARED across every user via the remote KV store, so validity is gated on
// the REMOTE write succeeding — never on the per-browser localStorage mirror. If a chunk's
// remote PUT is refused (413/5xx) while localStorage happens to accept it, the version marker
// stays invalid and the next open cold-rebuilds, rather than another user loading a snapshot
// spliced from two generations (a new manifest over a stale, un-overwritten remote chunk).

import type { FetchReport, KORecord, OrgIndex } from './types';
import type { Transport } from './apiClient';
import { byteLength, getJSON, setJSON, setJSONDetailed, KV_VALUE_MAX_BYTES } from '../kv';

const SNAPSHOT_KEY = 'index:snapshot';
const SNAPSHOT_VERSION_KEY = 'index:snapversion';
// Bump when the indexed object types, the record shape, or this storage format change.
//   v1: added the library object types (event breakers, regexes, grok, …).
//   v2: chunked storage — the single-value write 413'd for large orgs and left the
//       previous (smaller) snapshot in place.
export const SNAPSHOT_VERSION = 2;
// Per-chunk byte budget, comfortably under the KV per-value cap. Was 150 KB — over the real
// ~100 KB cap, so every chunk 413'd and the snapshot never persisted, forcing a full cold
// rebuild on each open.
export const SNAPSHOT_CHUNK_BYTES = KV_VALUE_MAX_BYTES;

interface SnapshotManifest {
  builtAt: string;
  report: FetchReport;
  chunks: number;
}

/** Persist the index as version-gated chunks. Best-effort: if any chunk's REMOTE write fails
 *  (e.g. it exceeds the cap, or a transient 5xx), the version is left invalid so the next
 *  load cold-rebuilds — never a shared snapshot spliced from two generations. */
export async function saveSnapshot(records: KORecord[], report: FetchReport, transport?: Transport): Promise<void> {
  await setJSON(SNAPSHOT_VERSION_KEY, 0, transport); // invalidate while (re)writing
  // Drop the derived searchText (recomputed from raw on load) to keep values small.
  const stripped = records.map((r) => ({ ...r, searchText: [] as string[] }));
  const chunks = chunkBySize(stripped, SNAPSHOT_CHUNK_BYTES);
  let remoteOk = true;
  for (let i = 0; i < chunks.length; i += 1) {
    if (!(await setJSONDetailed(`${SNAPSHOT_KEY}:${i}`, chunks[i], transport)).remoteOk) remoteOk = false;
  }
  const manifest: SnapshotManifest = { builtAt: report.builtAt, report, chunks: chunks.length };
  if (remoteOk && !(await setJSONDetailed(SNAPSHOT_KEY, manifest, transport)).remoteOk) remoteOk = false;
  // Only claim the shared snapshot is valid once every chunk + the manifest are in the shared
  // store — the localStorage mirror can't serve other users, so its success must not count.
  if (remoteOk) await setJSON(SNAPSHOT_VERSION_KEY, SNAPSHOT_VERSION, transport);
}

/** Load the index only if a complete snapshot at the current version is present. */
export async function loadSnapshot(transport?: Transport): Promise<OrgIndex | null> {
  if ((await getJSON<number>(SNAPSHOT_VERSION_KEY, transport)) !== SNAPSHOT_VERSION) return null;
  const manifest = await getJSON<SnapshotManifest>(SNAPSHOT_KEY, transport);
  if (!manifest || typeof manifest.chunks !== 'number') return null;
  const records: KORecord[] = [];
  for (let i = 0; i < manifest.chunks; i += 1) {
    const chunk = await getJSON<KORecord[]>(`${SNAPSHOT_KEY}:${i}`, transport);
    if (!Array.isArray(chunk)) return null; // a missing/failed chunk → no valid snapshot
    records.push(...chunk);
  }
  return { builtAt: manifest.builtAt, records, report: manifest.report };
}

/** Split records into chunks whose serialized size each stays under `maxBytes` (a single
 *  oversized record still gets its own chunk). */
export function chunkBySize(records: KORecord[], maxBytes: number): KORecord[][] {
  const chunks: KORecord[][] = [];
  let cur: KORecord[] = [];
  let bytes = 0;
  for (const r of records) {
    const size = byteLength(JSON.stringify(r));
    if (cur.length > 0 && bytes + size > maxBytes) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += size;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}
