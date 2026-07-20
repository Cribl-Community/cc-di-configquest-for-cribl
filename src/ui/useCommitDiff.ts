// Lazily fetches one commit's full diff for the Commits page — only when a commit
// is selected, refetched when the selection changes. Degrades on a 403 (no
// versioning access) like the rest of the git-backed features.

import { useEffect, useState } from 'react';
import { fetchCommitDiff, type CommitDiff } from '../data/git/commitDetail';
import { ApiError } from '../data/types';
import { appTransport } from './appTransport';

export interface CommitDiffState {
  loading: boolean;
  /** False when `/version/*` returns 403 — no versioning access. */
  available: boolean;
  error: string | null;
  data: CommitDiff | null;
}

const IDLE: CommitDiffState = { loading: false, available: true, error: null, data: null };

export function useCommitDiff(hash: string | null): CommitDiffState {
  const [state, setState] = useState<CommitDiffState>(IDLE);

  useEffect(() => {
    if (!hash) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState({ ...IDLE, loading: true });
    void (async () => {
      try {
        const data = await fetchCommitDiff(hash, { transport: await appTransport() });
        if (!cancelled) setState({ loading: false, available: true, error: null, data });
      } catch (err) {
        if (cancelled) return;
        const available = !(err instanceof ApiError && err.status === 403);
        setState({ loading: false, available, error: err instanceof Error ? err.message : String(err), data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hash]);

  return state;
}
