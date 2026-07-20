// A commit rendered as a human-readable "recent activity" item for the Overview.
// Sourced from the cheap `/version?count=N` log (no per-commit walk).

import type { Commit } from './log';

export interface Activity {
  hash: string;
  author: string;
  summary: string;
  date: string; // ISO or git date string
}

/**
 * On Cribl.Cloud every commit is authored by "Cribl System", with the acting user
 * and change in the message as "First Last: <what changed>". Pull the user out for
 * the author and use the remainder as the summary. On-prem commits keep their real
 * git author and full message.
 */
export function toActivity(commit: Commit): Activity {
  if (/cribl system/i.test(commit.authorName)) {
    const m = /^([^:\n]{1,60}):\s+([\s\S]+)$/.exec(commit.message);
    if (m) {
      return { hash: commit.hash, author: m[1].trim(), summary: m[2].trim(), date: commit.date };
    }
  }
  return {
    hash: commit.hash,
    author: commit.authorName || 'unknown',
    summary: commit.message || '(no message)',
    date: commit.date,
  };
}
