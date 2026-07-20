// Lazily fetches the CSV content of one or more lookup records — for Compare (two
// lookups) and Across Worker Groups (a lookup's instances). Fetches in parallel and
// degrades to an error message rather than throwing.

import { useEffect, useState } from 'react';
import { fetchLookupContent, type LookupContent } from '../data/lookupContent';
import type { KORecord } from '../data/types';
import { appTransport } from './appTransport';

export interface LookupContentState {
  loading: boolean;
  error: string | null;
  byKey: Map<string, LookupContent>;
}

const EMPTY: LookupContentState = { loading: false, error: null, byKey: new Map() };

export function useLookupContent(records: KORecord[]): LookupContentState {
  const [state, setState] = useState<LookupContentState>(EMPTY);
  const signature = records.map((r) => r.key).join('|');

  useEffect(() => {
    if (records.length === 0) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ loading: true, error: null, byKey: new Map() });
    void (async () => {
      try {
        const transport = await appTransport();
        const entries = await Promise.all(
          records.map(async (r) => [r.key, await fetchLookupContent(r, { transport })] as const),
        );
        if (!cancelled) setState({ loading: false, error: null, byKey: new Map(entries) });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err instanceof Error ? err.message : String(err), byKey: new Map() });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return state;
}
