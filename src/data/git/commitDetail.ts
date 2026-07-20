// One commit's full change set — every touched file's diff — for the Commits page.
// Bounded to `maxFiles` so a huge commit (the initial import touches everything)
// can't blow up the view; a file whose diff can't be read (e.g. the root commit,
// which the Leader refuses) is kept with no rows rather than dropped.

import { type ApiOptions } from '../apiClient';
import { gitToDiffRows, type DiffRow } from '../diff';
import { diffFilesOf, fetchCommitFiles, fetchFileDiff } from './log';

export interface CommitFileDiff {
  path: string;
  /** Git status letter: `A`dded / `M`odified / `D`eleted / `R`enamed. */
  state: string;
  rows: DiffRow[];
}

export interface CommitDiff {
  files: CommitFileDiff[];
  /** Files the commit touched, before capping. */
  total: number;
  /** Files actually rendered (`files.length`); less than `total` when capped. */
  shown: number;
}

export interface CommitDiffOptions extends ApiOptions {
  maxFiles?: number;
}

const DEFAULT_MAX_FILES = 40;

/** Every touched file's diff for one commit, capped to `maxFiles`. */
export async function fetchCommitDiff(hash: string, opts: CommitDiffOptions = {}): Promise<CommitDiff> {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const files = await fetchCommitFiles(hash, opts);
  const picked = files.slice(0, maxFiles);
  const CONCURRENCY = 8;
  const out: CommitFileDiff[] = [];
  for (let i = 0; i < picked.length; i += CONCURRENCY) {
    const batch = picked.slice(i, i + CONCURRENCY);
    // One bad file (a diff the Leader won't serve) shouldn't sink the whole commit —
    // keep it in the list with an empty diff.
    const settled = await Promise.allSettled(batch.map((f) => fetchFileDiff(hash, f.path, opts)));
    settled.forEach((res, j) => {
      const rows = res.status === 'fulfilled' ? gitToDiffRows(diffFilesOf(res.value)) : [];
      out.push({ path: batch[j].path, state: batch[j].state, rows });
    });
  }
  return { files: out, total: files.length, shown: out.length };
}
