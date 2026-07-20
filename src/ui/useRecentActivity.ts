// Fetches the newest N commits for the Overview's "Recent activity" feed. This is a
// single cheap `/version?count=N` call (no per-commit walk), refreshed whenever the
// index rebuilds (builtAt changes) so it tracks re-indexing / auto-refresh.

import { useEffect, useState } from 'react';
import { fetchCommits } from '../data/git/log';
import { toActivity, type Activity } from '../data/git/activity';
import { ApiError } from '../data/types';
import { appTransport } from './appTransport';

export interface RecentActivity {
  items: Activity[];
  /** False when `/version` returns 403 — no versioning access (hide the feed). */
  available: boolean;
  loading: boolean;
}

export function useRecentActivity(count: number, builtAt: string | null): RecentActivity {
  const [state, setState] = useState<RecentActivity>({ items: [], available: true, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      try {
        const commits = await fetchCommits(count, { transport: await appTransport() });
        if (cancelled) return;
        setState({ items: commits.map(toActivity), available: true, loading: false });
      } catch (err) {
        if (cancelled) return;
        // 403 → no versioning access; degrade like the age/history features. Other
        // errors leave `available` true but yield an empty feed.
        const available = !(err instanceof ApiError && err.status === 403);
        setState({ items: [], available, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [count, builtAt]);

  return state;
}
