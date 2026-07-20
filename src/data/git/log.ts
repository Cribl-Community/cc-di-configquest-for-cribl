// Read the Leader's git history (Phase 3). `/version` and `/version/show` are
// Leader-context endpoints that require versioning access; a 403 is handled by
// the caller (ageIndex) to hide the age/owner UI entirely.

import { apiGet, type ApiOptions } from '../apiClient';
import { ApiError } from '../types';
import { asRecord, itemsOf, str } from '../raw';

export interface Commit {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
}

/** Commit log, newest-first. `/version` returns a `{ items }` envelope. */
export async function fetchCommits(count: number, opts: ApiOptions = {}): Promise<Commit[]> {
  const payload = await apiGet<unknown>(`/version?count=${count}`, opts);
  const commits: Commit[] = [];
  for (const item of itemsOf(payload)) {
    const obj = asRecord(item);
    const hash = obj && str(obj, 'hash');
    if (!obj || !hash) continue;
    commits.push({
      hash,
      authorName: str(obj, 'author_name') ?? '',
      authorEmail: str(obj, 'author_email') ?? '',
      date: str(obj, 'date') ?? '',
      message: str(obj, 'message') ?? '',
    });
  }
  return commits;
}

export interface CommitFile {
  /** Repo-relative path, e.g. `groups/<g>/local/cribl/pipelines/<id>/conf.yml`. */
  path: string;
  /** Git status letter: `A`dded / `M`odified / `D`eleted / `R`enamed. */
  state: string;
}

// Session caches keyed by the immutable commit hash — a commit's file list and a
// file's diff within it never change, so caching is always safe (never stale) and
// lets the History tab reuse the age-index walk instead of re-fetching the same
// multi-MB payloads. `/version/files` is ~138 bytes where the initial commit's full
// `/version/show` is ~2.5 MB, so the file list is what we walk; diffs are pulled
// per file, only for the handful of commits that actually touched an object.
const fileListCache = new Map<string, CommitFile[]>();
const fileDiffCache = new Map<string, unknown>();

// Not every deployment grants the lighter `/version/files` even when `/version/show`
// works. We probe it once; a 403 flips this latch so the rest of the session goes
// straight to the `/version/show` fallback instead of paying a failing round-trip
// per commit. (A whole-commit `/version/show` is cached under its bare hash so the
// History diff step reuses it rather than re-fetching.)
let filesEndpointDenied = false;

/** Files touched by one commit. Uses `/version/files` (tiny), else falls back to the
 *  full `/version/show` diff. Cached by hash. Deleted files carry state `D`. */
export async function fetchCommitFiles(hash: string, opts: ApiOptions = {}): Promise<CommitFile[]> {
  const cached = fileListCache.get(hash);
  if (cached) return cached;

  let files: CommitFile[] | undefined;
  if (!filesEndpointDenied) {
    try {
      const payload = await apiGet<unknown>(`/version/files?commit=${encodeURIComponent(hash)}`, opts);
      files = [];
      for (const entry of itemsOf(payload)) flattenFileTree(asRecord(entry)?.['items'], '', files);
    } catch (err) {
      // `/version/files` is an optimization, not a requirement: if it's unreachable
      // for any reason (not granted → 403/404, older Leader, transient), fall back
      // to the always-present `/version/show`. Latch only on access-denied statuses
      // so a transient blip doesn't permanently abandon the fast path.
      if (isAccessDenied(err)) filesEndpointDenied = true;
      files = undefined;
    }
  }
  if (!files) files = filesFromShow(await fetchWholeShow(hash, opts));

  fileListCache.set(hash, files);
  return files;
}

/** One file's diff within a commit, as a `/version/show` payload. Prefers a
 *  filename-narrowed fetch (~4 KB); reuses a cached whole-commit diff when the
 *  fallback already pulled it. */
export async function fetchFileDiff(hash: string, filename: string, opts: ApiOptions = {}): Promise<unknown> {
  const whole = fileDiffCache.get(hash);
  if (whole !== undefined) return whole;
  const key = `${hash} ${filename}`;
  const cached = fileDiffCache.get(key);
  if (cached !== undefined) return cached;
  const payload = await apiGet<unknown>(
    `/version/show?commit=${encodeURIComponent(hash)}&filename=${encodeURIComponent(filename)}`,
    opts,
  );
  fileDiffCache.set(key, payload);
  return payload;
}

/** The `diffJson` file entries within one `/version/show` payload (the `{ items: [{
 *  diffJson }] }` envelope), or an empty array. Shared by the History tab and the
 *  Commits page. */
export function diffFilesOf(show: unknown): unknown[] {
  const diffJson = asRecord(itemsOf(show)[0])?.['diffJson'];
  return Array.isArray(diffJson) ? diffJson : [];
}

/** The full `/version/show` diff for a commit (all files), cached under its hash. */
async function fetchWholeShow(hash: string, opts: ApiOptions = {}): Promise<unknown> {
  const cached = fileDiffCache.get(hash);
  if (cached !== undefined) return cached;
  const payload = await apiGet<unknown>(`/version/show?commit=${encodeURIComponent(hash)}`, opts);
  fileDiffCache.set(hash, payload);
  return payload;
}

/** A "you don't have this path" style failure — as opposed to transient/network. */
function isAccessDenied(err: unknown): boolean {
  return err instanceof ApiError && err.kind === 'http' && (err.status === 401 || err.status === 403 || err.status === 404);
}

/** Touched files derived from a full `/version/show` diffJson (the fallback source). */
function filesFromShow(show: unknown): CommitFile[] {
  const out: CommitFile[] = [];
  for (const entry of itemsOf(show)) {
    const diffJson = asRecord(entry)?.['diffJson'];
    if (!Array.isArray(diffJson)) continue;
    for (const file of diffJson) {
      const f = asRecord(file);
      const name = f && (str(f, 'newName') ?? str(f, 'oldName'));
      if (!f || !name) continue;
      out.push({ path: name, state: f['isDeleted'] === true ? 'D' : 'M' });
    }
  }
  return out;
}

/** The config file paths touched by one commit. Deleted files are skipped. */
export async function fetchTouchedFiles(hash: string, opts: ApiOptions = {}): Promise<string[]> {
  const files = await fetchCommitFiles(hash, opts);
  return files.filter((f) => f.state !== 'D').map((f) => f.path);
}

// `/version/files` returns a nested tree of `{ name, state?, children? }`; a leaf
// (no children) is a file whose full path is its ancestors' names joined by `/`.
function flattenFileTree(nodes: unknown, prefix: string, out: CommitFile[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const n = asRecord(node);
    const name = n && str(n, 'name');
    if (!n || !name) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    const children = n['children'];
    if (Array.isArray(children) && children.length > 0) {
      flattenFileTree(children, path, out);
    } else {
      out.push({ path, state: str(n, 'state') ?? '' });
    }
  }
}
