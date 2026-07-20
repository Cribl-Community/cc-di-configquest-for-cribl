// Per-object change history: walk commits newest-first and keep the ones whose
// touched files map to this record, with the diff for that object. Bounded and
// lazy (fetched only when the History tab opens). Requires versioning access.

import { type ApiOptions } from '../apiClient';
import { asRecord, str } from '../raw';
import { gitToDiffRows, narrowGitFileToObject, type DiffRow } from '../diff';
import { buildFileMapper, parseConfigPath } from './fileMap';
import { diffFilesOf, fetchCommitFiles, fetchCommits, fetchFileDiff, type Commit } from './log';
import type { KORecord } from '../types';

export interface HistoryEntry {
  commit: Commit;
  rows: DiffRow[];
}

export interface HistoryOptions extends ApiOptions {
  maxCommits?: number;
  maxEntries?: number;
}

/** Commits (newest-first) that touched `recordKey`, each with its diff. */
export async function fetchObjectHistory(
  recordKey: string,
  records: KORecord[],
  opts: HistoryOptions = {},
): Promise<HistoryEntry[]> {
  const maxCommits = opts.maxCommits ?? 100;
  const maxEntries = opts.maxEntries ?? 30;
  const record = records.find((r) => r.key === recordKey);
  const mapper = buildFileMapper(records);
  const commits = await fetchCommits(maxCommits, opts);
  const CONCURRENCY = 8;

  // Phase 1 — decide which commits touched this object, and via which file paths,
  // from the lightweight `/version/files` tree (cached, shared with the age-index
  // walk). This avoids pulling any full commit diff (the initial commit alone is
  // ~2.5 MB) just to discover relevance.
  const pathsByCommit: string[][] = new Array(commits.length);
  for (let i = 0; i < commits.length; i += CONCURRENCY) {
    const batch = commits.slice(i, i + CONCURRENCY);
    const lists = await Promise.all(batch.map((c) => fetchCommitFiles(c.hash, opts)));
    lists.forEach((files, j) => {
      pathsByCommit[i + j] = files
        .filter((f) => f.state !== 'D' && mapper(f.path).includes(recordKey))
        .map((f) => f.path);
    });
  }
  const matches = commits
    .map((commit, i) => ({ commit, paths: pathsByCommit[i] }))
    .filter((m) => m.paths.length > 0)
    .slice(0, maxEntries);

  // Phase 2 — fetch only this object's file diff for each matching commit
  // (`/version/show?filename=`, ~4 KB), narrowing shared files to the object.
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < matches.length; i += CONCURRENCY) {
    const batch = matches.slice(i, i + CONCURRENCY);
    const rowsList = await Promise.all(
      batch.map(async (m) => {
        const files: unknown[] = [];
        for (const path of m.paths) files.push(...diffFilesOf(await fetchFileDiff(m.commit.hash, path, opts)));
        return narrowToObject(files, recordKey, record, records, mapper);
      }),
    );
    batch.forEach((m, j) => {
      if (rowsList[j]) entries.push({ commit: m.commit, rows: rowsList[j]! });
    });
  }
  return entries;
}

/** Diff rows for `recordKey` across a commit's touched files, or null if none apply.
 *  Per-object files are kept whole; shared files are narrowed to the object. */
function narrowToObject(
  files: unknown[],
  recordKey: string,
  record: KORecord | undefined,
  records: KORecord[],
  mapper: (path: string) => string[],
): DiffRow[] | null {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const relevant: unknown[] = [];
  for (const file of files) {
    const name = str(asRecord(file) ?? {}, 'newName') ?? str(asRecord(file) ?? {}, 'oldName');
    if (!name || !mapper(name).includes(recordKey)) continue;
    if (parseConfigPath(name)?.id || !record) {
      relevant.push(file);
    } else {
      // The other objects sharing this file, so a deep property edit whose id/name
      // boundary is above the diff context attaches only to the object it belongs to.
      const siblings = mapper(name)
        .map((k) => byKey.get(k))
        .filter((r): r is KORecord => Boolean(r));
      const narrowed = narrowGitFileToObject(file, record, siblings);
      if (narrowed) relevant.push(narrowed);
    }
  }
  return relevant.length > 0 ? gitToDiffRows(relevant) : null;
}
