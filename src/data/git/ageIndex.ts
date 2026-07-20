// Build a per-record age/owner map from git history, incrementally. On refresh
// only commits newer than the stored marker are processed and merged, keeping
// the newest commit per record key (the last author is the "owner" proxy).

import { ApiError, locationLabel, type AgeMap, type Finding, type KORecord } from '../types';
import type { ApiOptions } from '../apiClient';
import { asRecord, itemsOf, str } from '../raw';
import { changedKeysInSharedFile, splitSharedFileObjects } from '../diff';
import { isSecretValue } from '../secrets';
import { fetchCommits, fetchCommitFiles, fetchFileDiff, type Commit, type CommitFile } from './log';
import { buildFileMapper, parseConfigPath } from './fileMap';

export const DEFAULT_MAX_COMMITS = 500;
// After the newest this-many commits are attributed, emit a partial map so the
// Overview's "recently changed" renders without waiting for the whole walk. Sized
// to one concurrency batch: since the Leader serializes git ops, a smaller first
// pass surfaces recent changes sooner (a wider one just blocks longer).
export const PROGRESS_AT = 8;

export interface AgeCheckpoint {
  map: AgeMap;
  lastCommit: string;
}

export interface AgeMergeResult {
  map: AgeMap;
  /** Newest commit hash seen; the marker to persist for the next run. */
  lastCommit: string;
  /** Number of commits processed this run (0 when nothing is new). */
  processed: number;
}

/**
 * Merge commit history (newest-first) into an age map. `keysByHash` gives the record
 * keys each commit actually changed (already narrowed — see resolveChangedKeys).
 * Stops at the previous marker so only new commits are processed. Pure/synchronous.
 */
export function mergeAgeMap(
  commits: Commit[],
  keysByHash: Map<string, string[]>,
  previous?: AgeCheckpoint,
): AgeMergeResult {
  const map: AgeMap = { ...(previous?.map ?? {}) };
  const marker = previous?.lastCommit;
  let processed = 0;

  for (const commit of commits) {
    if (marker && commit.hash === marker) break; // reached already-processed history
    processed += 1;
    for (const key of keysByHash.get(commit.hash) ?? []) {
      const existing = map[key];
      // Newest-first walk: overwrite only with a strictly newer commit.
      if (!existing || isNewer(commit.date, existing.lastTouched)) {
        const who = attribution(commit);
        map[key] = { lastTouched: normalizeDate(commit.date), author: who.author, email: who.email };
      }
    }
  }

  return { map, lastCommit: commits[0]?.hash ?? marker ?? '', processed };
}

/** One wholesale-added shared file's per-object block text, tagged with the commit and
 *  the logical scope (`group/pack/type`) that unifies a pack's default and local copies. */
interface WholesaleAdd {
  hash: string;
  logical: string;
  blocks: Map<string, string>;
}

/**
 * A pack object lives in two files — the pristine `default/<pack>/…` copy and the
 * deployed `local/<pack>/…` override — that map to the same record keys and the same
 * logical scope. The first edit of any pack object writes the whole `local` copy, so git
 * shows every object as added and naively attributes the commit to all of them. Here we
 * compare each object's block against the older wholesale copy of the same logical file
 * and drop the ones whose content is byte-identical: an unchanged carry-over isn't a
 * change, so it falls through to the older (pack-install) commit and only the genuinely
 * edited object stays on the newer commit. Returns the map unchanged when nothing prunes
 * (e.g. a file has a single wholesale add — its baseline fell outside the walked window).
 */
function correctWholesaleAdds(
  rawKeysByHash: Map<string, string[]>,
  adds: WholesaleAdd[],
  dateByHash: Map<string, string>,
): Map<string, string[]> {
  const byLogical = new Map<string, WholesaleAdd[]>();
  for (const add of adds) {
    const list = byLogical.get(add.logical);
    if (list) list.push(add);
    else byLogical.set(add.logical, [add]);
  }
  const pruned = new Map<string, Set<string>>(); // commit hash -> record keys to drop
  for (const group of byLogical.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => cmpDate(dateByHash.get(a.hash), dateByHash.get(b.hash)));
    for (let i = 1; i < group.length; i += 1) {
      const older = group[i - 1];
      const newer = group[i];
      for (const [key, text] of newer.blocks) {
        if (older.blocks.get(key) !== text) continue; // a real edit — keep it on the newer commit
        let drop = pruned.get(newer.hash);
        if (!drop) pruned.set(newer.hash, (drop = new Set()));
        drop.add(key);
      }
    }
  }
  if (pruned.size === 0) return rawKeysByHash;
  const out = new Map<string, string[]>();
  for (const [hash, keys] of rawKeysByHash) {
    const drop = pruned.get(hash);
    out.set(hash, drop ? keys.filter((k) => !drop.has(k)) : keys);
  }
  return out;
}

/**
 * The record keys a commit actually changed. Per-object files (a pipeline dir, a
 * lookup file) map straight to their one record. Shared files (route.yml / inputs.yml
 * / outputs.yml hold every object of a type) are narrowed via the commit's diff, so a
 * single object's edit isn't wrongly attributed to every sibling in the same file.
 */
async function resolveChangedKeys(
  hash: string,
  files: CommitFile[],
  mapper: (path: string) => string[],
  byKey: Map<string, KORecord>,
  opts: ApiOptions,
): Promise<{ keys: string[]; fileKeys: string[]; scopes: string[]; wholesale: WholesaleAdd[] }> {
  const keys = new Set<string>();
  // Every record whose file this commit touched, BEFORE narrowing — used to date an object
  // from the earliest commit that created its file when no specific edit is attributable.
  const fileKeys = new Set<string>();
  // Every group/pack scope this commit touched (even via a file that maps to no current
  // record) — a coarser fallback for objects git never tracks as individual files (a pack's
  // bundled library objects): they inherit the earliest commit that touched their pack subtree,
  // i.e. the pack-install commit (or, for a group object, the group-creation commit).
  const scopes = new Set<string>();
  const wholesale: WholesaleAdd[] = [];
  for (const f of files) {
    if (f.state === 'D') continue;
    const parsed = parseConfigPath(f.path);
    if (parsed) scopes.add(`${parsed.group}/${parsed.pack ?? '-'}`);
    const cands = mapper(f.path);
    if (cands.length === 0) continue;
    for (const k of cands) fileKeys.add(k);
    if (parsed?.id) {
      for (const k of cands) keys.add(k); // per-object file: the file is the object's change
      continue;
    }
    // Shared file: keep only the objects whose section actually changed in the diff.
    const entry = await sharedFileDiff(hash, f.path, opts);
    if (!entry) {
      for (const k of cands) keys.add(k); // couldn't read the diff — keep file-level rather than lose the commit
      continue;
    }
    // Segment the shared diff ONCE and collect every changed object's key, instead of
    // re-narrowing the whole diff per candidate (O(candidates × diff) — ~220× for sds-rules.yml).
    const siblings = cands.map((k) => byKey.get(k)).filter((r): r is KORecord => Boolean(r));
    for (const k of changedKeysInSharedFile(entry, siblings)) keys.add(k);
    // A wholesale add (a file created at this path — e.g. a pack's `local` copy on its
    // first edit) shows every object as inserted, so all are attributed above. Capture
    // each object's block so correctWholesaleAdds can later drop the ones identical to an
    // older copy of the same logical file (the pristine `default`), keeping only real edits.
    if (f.state === 'A' && parsed) {
      const blocks = blocksByKey(entry, cands, byKey);
      if (blocks.size > 0) wholesale.push({ hash, logical: `${parsed.group}/${parsed.pack ?? '-'}/${parsed.type}`, blocks });
    }
  }
  return { keys: [...keys], fileKeys: [...fileKeys], scopes: [...scopes], wholesale };
}

/** Each object segment of a wholesale-added shared file, keyed by its record key,
 *  with the block canonicalized so two copies compare equal iff they mean the same. */
function blocksByKey(entry: unknown, cands: string[], byKey: Map<string, KORecord>): Map<string, string> {
  const recs = cands.map((k) => byKey.get(k)).filter((r): r is KORecord => Boolean(r));
  const out = new Map<string, string>();
  for (const seg of splitSharedFileObjects(entry, recs)) {
    const rec = recs.find((r) => seg.ids.includes(r.id) || seg.ids.includes(r.name));
    if (rec) out.set(rec.key, canonicalizeBlock(seg.text));
  }
  return out;
}

// Cribl reserializes a pack object when it writes the deployed `local` copy, so the
// bytes differ from the pristine `default` even when nothing meaningful changed —
// it drops `key: null` fields, may reorder keys, and fills in secrets (a `token`/
// `password` placeholder like `YOUR_TOKEN` becomes a Cribl secret ref `#42:…`).
// Canonicalize to a null-free, secret-free, order-independent form so only a real
// value edit — not a deploy artifact — reads as a difference between the two copies.
function canonicalizeBlock(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/:\s*null$/.test(l) && !isSubstitutedSecret(l))
    .sort()
    .join('\n');
}

// A diff line a deploy fills in differently from the pristine copy — dropping it keeps
// the placeholder→secret substitution from reading as a user edit. (Trade-off: a
// secret-only edit then attributes to the install commit, not the edit — acceptable
// next to the alternative of every sibling looking changed on first deploy.)
function isSubstitutedSecret(line: string): boolean {
  const m = /^(?:-\s+)?([\w.-]+):\s*(.*)$/.exec(line); // allow a `- key: value` list item
  return m ? isSecretValue(m[1], m[2]) : false;
}

/** Ascending git-date comparator (oldest first); undated/unparseable sort oldest. */
function cmpDate(a: string | undefined, b: string | undefined): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? 0 : -1;
  if (Number.isNaN(tb)) return 1;
  return ta - tb;
}

/** The `diffJson` entry for `path` within a commit (filename-narrowed), or null. */
async function sharedFileDiff(hash: string, path: string, opts: ApiOptions): Promise<unknown | null> {
  try {
    const diffJson = asRecord(itemsOf(await fetchFileDiff(hash, path, opts))[0])?.['diffJson'];
    if (!Array.isArray(diffJson)) return null;
    const byName = diffJson.find((file) => {
      const name = str(asRecord(file) ?? {}, 'newName') ?? str(asRecord(file) ?? {}, 'oldName');
      return name === path;
    });
    return byName ?? diffJson[0] ?? null;
  } catch {
    return null;
  }
}

export interface AgeIndex {
  /** False when `/version` returns 403 — hide the age/owner UI. */
  available: boolean;
  map: AgeMap;
  lastCommit: string;
  truncated: boolean;
  processed: number;
}

export interface BuildAgeOptions extends ApiOptions {
  records: KORecord[];
  previous?: AgeCheckpoint;
  maxCommits?: number;
  /** Called once with a partial map after the newest commits are attributed, so the
   *  UI can render recent changes while the rest of the walk continues. */
  onProgress?: (map: AgeMap) => void;
}

/** Fetch history and produce an incremental age index. */
export async function buildAgeMap(opts: BuildAgeOptions): Promise<AgeIndex> {
  const max = opts.maxCommits ?? DEFAULT_MAX_COMMITS;

  let commits: Commit[];
  try {
    commits = await fetchCommits(max, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return {
        available: false,
        map: opts.previous?.map ?? {},
        lastCommit: opts.previous?.lastCommit ?? '',
        truncated: false,
        processed: 0,
      };
    }
    throw err;
  }

  const truncated = commits.length >= max;

  // Incremental: process commits newer than the stored marker and merge. When
  // the marker isn't in the fetched window — history rewrite, or simply more
  // than `max` new commits since the last run — we still merge onto the previous
  // map rather than discard it. The window's newer commits overwrite per key via
  // the isNewer guard, so already-known older records keep their attribution
  // instead of silently losing their persisted age/owner.
  const previous = opts.previous;
  const mapper = buildFileMapper(opts.records);
  const byKey = new Map(opts.records.map((r) => [r.key, r]));

  // New commits since the last run (everything up to the stored marker).
  const candidates: Commit[] = [];
  for (const commit of commits) {
    if (previous && commit.hash === previous.lastCommit) break;
    candidates.push(commit);
  }

  // Walk newest-first in bounded-concurrency batches (a serial await per commit is
  // up to `max` round-trips on a cold build), tracking which records still lack an
  // attribution. Two things ride on this loop:
  //  - progressive: after the newest `PROGRESS_AT` commits are in, emit a partial
  //    map so "recently changed" renders without waiting for the whole walk;
  //  - early exit: once every record has its newest commit, older commits can only
  //    hold older dates that the isNewer guard would reject, so stop fetching.
  const pending = new Set(opts.records.map((r) => r.key));
  const rawKeysByHash = new Map<string, string[]>();
  const fileKeysByHash = new Map<string, string[]>();
  const scopesByHash = new Map<string, string[]>();
  const wholesaleAdds: WholesaleAdd[] = [];
  const dateByHash = new Map<string, string>();
  const fetched: Commit[] = [];
  const CONCURRENCY = 8;
  let emittedProgress = false;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (commit) => {
        const files = await fetchCommitFiles(commit.hash, opts);
        return { commit, result: await resolveChangedKeys(commit.hash, files, mapper, byKey, opts) };
      }),
    );
    for (const { commit, result } of resolved) {
      rawKeysByHash.set(commit.hash, result.keys);
      fileKeysByHash.set(commit.hash, result.fileKeys);
      scopesByHash.set(commit.hash, result.scopes);
      dateByHash.set(commit.hash, commit.date);
      wholesaleAdds.push(...result.wholesale);
      fetched.push(commit);
      for (const key of result.keys) pending.delete(key);
    }
    if (!emittedProgress && opts.onProgress && (fetched.length >= PROGRESS_AT || pending.size === 0)) {
      emittedProgress = true;
      // Correct against whatever wholesale copies are in hand — a pack's default add
      // usually sits within the same first batch as the local edit, so the preview is
      // already right; if not, the final merge below fixes it.
      opts.onProgress(mergeAgeMap(fetched, correctWholesaleAdds(rawKeysByHash, wholesaleAdds, dateByHash), previous).map);
    }
    if (pending.size === 0) break;
  }

  const keysByHash = correctWholesaleAdds(rawKeysByHash, wholesaleAdds, dateByHash);
  const result = mergeAgeMap(fetched, keysByHash, previous);
  // Give every still-undated object a fallback "created / first seen" date from the earliest
  // commit that touched its file — its group's creation or its pack's install. Only on a full
  // build, where `fetched` spans all history (an object stays in `pending`, so the walk never
  // early-exits): an incremental refresh has a partial window, and carries the persisted
  // approx dates forward instead — a real edit later overwrites them via the isNewer guard.
  if (!previous) applyCreationFallback(result.map, opts.records, fetched, fileKeysByHash, scopesByHash);
  return {
    available: true,
    map: result.map,
    lastCommit: result.lastCommit,
    truncated,
    processed: result.processed,
  };
}

/** Date each record with no attributed edit from a "created / first seen" commit, flagged
 *  `approx` and never overwriting a real edit. Two tiers, finest first: the earliest commit
 *  that touched the object's own FILE (its creation); failing that — for objects git never
 *  tracks as individual files, like a pack's bundled library objects — the earliest commit
 *  that touched the object's SCOPE at all (the pack-install or group-creation commit). */
function applyCreationFallback(
  map: AgeMap,
  records: KORecord[],
  fetched: Commit[],
  fileKeysByHash: Map<string, string[]>,
  scopesByHash: Map<string, string[]>,
): void {
  const asc = [...fetched].sort((a, b) => cmpDate(a.date, b.date)); // oldest first
  const earliestByKey = new Map<string, Commit>();
  const earliestByScope = new Map<string, Commit>();
  for (const commit of asc) {
    for (const key of fileKeysByHash.get(commit.hash) ?? []) {
      if (!earliestByKey.has(key)) earliestByKey.set(key, commit);
    }
    for (const scope of scopesByHash.get(commit.hash) ?? []) {
      if (!earliestByScope.has(scope)) earliestByScope.set(scope, commit);
    }
  }
  for (const r of records) {
    if (map[r.key]) continue; // a real attribution always wins
    const commit = earliestByKey.get(r.key) ?? earliestByScope.get(`${r.group}/${r.pack ?? '-'}`);
    if (!commit) continue;
    const who = attribution(commit);
    map[r.key] = { lastTouched: normalizeDate(commit.date), author: who.author, email: who.email, approx: true };
  }
}

/** Enrich records with age/owner fields from the map (returns new records). */
export function applyAgeMap(records: KORecord[], map: AgeMap): KORecord[] {
  return records.map((r) => {
    const age = map[r.key];
    if (!age) return r;
    return { ...r, lastTouched: age.lastTouched, owner: age.author, ownerEmail: age.email, lastTouchedApprox: age.approx };
  });
}

/** "Stale objects" findings: records last touched before `minAgeDays` ago. */
export function staleFindings(records: KORecord[], minAgeDays: number): Finding[] {
  const cutoff = Date.now() - minAgeDays * 86_400_000;
  const out: Finding[] = [];
  for (const r of records) {
    if (!r.lastTouched || r.lastTouchedApprox) continue; // a created-only date isn't an edit to age out
    const t = Date.parse(r.lastTouched);
    if (Number.isNaN(t) || t >= cutoff) continue;
    out.push({
      category: 'stale-object',
      recordKey: r.key,
      title: r.name,
      location: locationLabel(r),
      detail: `Last touched ${r.lastTouched.slice(0, 10)} by ${r.owner ?? 'unknown'}`,
    });
  }
  return out;
}

// On Cribl.Cloud every commit is authored by "Cribl System", with the acting
// user in the message as "First Last: <change>". Prefer that name when the
// author is the system account; on-prem commits keep their real git author.
function attribution(commit: Commit): { author: string; email: string } {
  if (/cribl system/i.test(commit.authorName)) {
    const m = /^([^:\n]{1,60}):\s/.exec(commit.message);
    if (m) return { author: m[1].trim(), email: '' };
  }
  return { author: commit.authorName, email: commit.authorEmail };
}

function isNewer(candidate: string, current: string): boolean {
  const a = Date.parse(candidate);
  const b = Date.parse(current);
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a > b;
}

function normalizeDate(date: string): string {
  const t = Date.parse(date);
  return Number.isNaN(t) ? date : new Date(t).toISOString();
}
