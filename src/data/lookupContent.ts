// Lookup (.csv) comparison. Cross-group and Compare both cluster by cheap metadata —
// the declared file `size` (already in the inventory, no fetch) — and confirm same-size
// candidates with a content hash, fetching the actual rows only when needed. The Leader
// serves content at /m/<group>/system/lookups/<id>/content as { fields, items }.

import { apiGet, type ApiOptions } from './apiClient';
import { asRecord, itemsOf } from './raw';
import type { KORecord } from './types';

/** A lookup file's tabular content: column names and string-cell rows. */
export interface LookupContent {
  fields: string[];
  rows: string[][];
}

// The platform prepends an internal row-number column; it carries no user data and
// would otherwise read as a difference, so it is dropped from both fields and rows.
const INTERNAL_COL = '__id';

/** Fetch one lookup's content (group-scoped — packs don't expose lookup content). */
export async function fetchLookupContent(record: KORecord, opts: ApiOptions = {}): Promise<LookupContent> {
  const path = `/m/${encodeURIComponent(record.group)}/system/lookups/${encodeURIComponent(record.id)}/content`;
  return parseLookupContent(await apiGet<unknown>(path, opts));
}

/** Shape a raw `{ fields, items }` payload into a LookupContent (exported for tests). */
export function parseLookupContent(raw: unknown): LookupContent {
  const r = asRecord(raw);
  const allFields = Array.isArray(r?.['fields']) ? (r!['fields'] as unknown[]).map((f) => String(f)) : [];
  const keep = allFields.map((f, i) => ({ f, i })).filter((c) => c.f !== INTERNAL_COL);
  const fields = keep.map((c) => c.f);
  const rows = itemsOf(raw).map((row) => {
    const arr = Array.isArray(row) ? row : [];
    return keep.map((c) => cellText(arr[c.i]));
  });
  return { fields, rows };
}

function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
}

/** The declared byte size from the inventory listing (no content fetch). */
export function lookupSize(record: KORecord): number | undefined {
  const s = asRecord(record.raw)?.['size'];
  return typeof s === 'number' ? s : undefined;
}

/** A fast, stable content digest (FNV-1a) for clustering identical lookups. Not
 *  cryptographic — just needs to separate distinct files that share a byte size. */
export function hashContent(content: LookupContent): string {
  let h = 0x811c9dc5;
  const bump = (n: number) => {
    h ^= n;
    h = Math.imul(h, 0x01000193);
  };
  // Feed each string length before its chars so cell/row boundaries cannot collide
  // (["a", "b"] must not hash the same as ["ab"]).
  const feed = (s: string) => {
    bump(s.length);
    for (let i = 0; i < s.length; i += 1) bump(s.charCodeAt(i));
  };
  bump(content.fields.length);
  for (const field of content.fields) feed(field);
  bump(content.rows.length);
  for (const row of content.rows) {
    bump(row.length);
    for (const cell of row) feed(cell);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** One distinct version of a lookup, shared by a set of Worker Groups. */
export interface LookupVariant {
  groups: string[];
  percent: number; // share of present groups
  size?: number; // shared declared size (bytes), if known
  hash?: string; // content hash — set once content confirmed the group
  rows?: number; // row count, when content is loaded
  cols?: number; // column count, when content is loaded
  /** Same-size groups awaiting content to split by hash (still provisionally one variant). */
  pending?: boolean;
}

export interface LookupClusters {
  variants: LookupVariant[]; // majority-first
  present: string[];
}

/** The instances whose size collides with another group's, so content must be fetched
 *  to tell them apart. Distinct sizes are already known-different — no fetch needed. */
export function sizeCollisionRecords(instances: KORecord[]): KORecord[] {
  return [...bucketBySize(instances).values()].filter((recs) => recs.length > 1).flat();
}

/** Cluster a lookup's group instances by size, then split same-size buckets by content
 *  hash where content is available. Scales to large files: distinct sizes never fetch. */
export function clusterLookups(instances: KORecord[], contentByKey: Map<string, LookupContent>): LookupClusters {
  const present = instances.map((r) => r.group).sort();
  const variants: LookupVariant[] = [];
  for (const recs of bucketBySize(instances).values()) {
    const size = lookupSize(recs[0]);
    if (recs.length === 1) {
      variants.push({ groups: [recs[0].group], percent: 0, size, ...contentMeta(recs[0], contentByKey) });
      continue;
    }
    // Same size, multiple groups — split by content hash where content is loaded.
    const byHash = new Map<string, KORecord[]>();
    const unloaded: KORecord[] = [];
    for (const r of recs) {
      const content = contentByKey.get(r.key);
      if (!content) {
        unloaded.push(r);
        continue;
      }
      const h = hashContent(content);
      const g = byHash.get(h);
      if (g) g.push(r);
      else byHash.set(h, [r]);
    }
    for (const group of byHash.values()) {
      variants.push({ groups: group.map((r) => r.group).sort(), percent: 0, size, ...contentMeta(group[0], contentByKey) });
    }
    if (unloaded.length > 0) {
      variants.push({ groups: unloaded.map((r) => r.group).sort(), percent: 0, size, pending: true });
    }
  }
  variants.sort((a, b) => b.groups.length - a.groups.length);
  const denom = present.length || 1;
  for (const v of variants) v.percent = Math.round((v.groups.length / denom) * 100);
  return { variants, present };
}

/** Metadata comparison of two lookups for the Compare page: sizes/counts, the shared vs.
 *  one-sided columns, and an identical verdict from the content hash. */
export interface LookupMetaDiff {
  aRows: number;
  bRows: number;
  aCols: string[];
  bCols: string[];
  onlyA: string[]; // columns only in A
  onlyB: string[]; // columns only in B
  identical: boolean; // same content hash
}

export function lookupMetaDiff(a: LookupContent, b: LookupContent): LookupMetaDiff {
  const aSet = new Set(a.fields);
  const bSet = new Set(b.fields);
  return {
    aRows: a.rows.length,
    bRows: b.rows.length,
    aCols: a.fields,
    bCols: b.fields,
    onlyA: a.fields.filter((f) => !bSet.has(f)),
    onlyB: b.fields.filter((f) => !aSet.has(f)),
    identical: hashContent(a) === hashContent(b),
  };
}

function bucketBySize(instances: KORecord[]): Map<string, KORecord[]> {
  const bySize = new Map<string, KORecord[]>();
  for (const r of instances) {
    const key = String(lookupSize(r) ?? 'unknown');
    const list = bySize.get(key);
    if (list) list.push(r);
    else bySize.set(key, [r]);
  }
  return bySize;
}

function contentMeta(r: KORecord, contentByKey: Map<string, LookupContent>): { rows?: number; cols?: number; hash?: string } {
  const c = contentByKey.get(r.key);
  return c ? { rows: c.rows.length, cols: c.fields.length, hash: hashContent(c) } : {};
}
