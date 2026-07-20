import { useEffect, useMemo, useState } from 'react';
import { fetchObjectHistory, type HistoryEntry } from '../data/git/history';
import { ApiError, type KORecord } from '../data/types';
import { appTransport } from './appTransport';
import { toActivity } from '../data/git/activity';
import { DiffView } from './DiffView';
import { PanelEmpty } from './Overview';
import { ChevronDown } from './icons';
import { shortHash, timeAgo } from './format';

type State = 'loading' | 'ready' | 'unavailable' | 'error';

export function History({ record, records, onOpenCommit }: { record: KORecord; records: KORecord[]; onOpenCommit: (hash: string) => void }) {
  const [state, setState] = useState<State>('loading');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [openHashes, setOpenHashes] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);

  // Depend on the record key and a stable signature of the record set — not the `records`
  // array identity, which is rebuilt on every progressive age emit and every refresh. Keying
  // on identity would refetch and collapse the expanded diffs while the drawer sits open.
  // Memoized so the O(records) join doesn't rerun on every drawer re-render (expand/collapse).
  const keysSig = useMemo(() => records.map((r) => r.key).join('|'), [records]);
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const hist = await fetchObjectHistory(record.key, records, { transport: await appTransport() });
        if (cancelled) return;
        setEntries(hist);
        setOpenHashes(new Set(hist[0] ? [hist[0].commit.hash] : []));
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        // A 403 is a missing versioning permission; anything else is a real load failure —
        // don't mislabel a transient error as a permissions problem.
        if (err instanceof ApiError && err.status === 403) {
          setState('unavailable');
        } else {
          setDetail(err instanceof Error ? err.message : null);
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.key, keysSig]);

  const toggle = (hash: string) =>
    setOpenHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });

  if (state === 'loading')
    return (
      <div className="hist-note hist-loading" role="status" aria-live="polite">
        <span className="hist-spinner" aria-hidden="true" />
        Loading change history…
      </div>
    );
  if (state === 'unavailable') return <PanelEmpty title="Change history unavailable." detail="Needs versioning access on the Leader." />;
  if (state === 'error') return <PanelEmpty title="Couldn't load change history." detail={detail ?? undefined} />;
  if (entries.length === 0) return <PanelEmpty title="No recorded changes for this object." />;

  return (
    <div className="history">
      {entries.map((e) => {
        const open = openHashes.has(e.commit.hash);
        // Attribute like the Commits page and Browse: a "Cribl System" commit carries the
        // acting user in its message prefix, so pull the real author and clean summary out.
        const act = toActivity(e.commit);
        return (
          <div className="commit" key={e.commit.hash}>
            <div className="commit-head-row">
              <button className="commit-head" onClick={() => toggle(e.commit.hash)} aria-expanded={open}>
                <span className="commit-caret" aria-hidden="true">
                  <ChevronDown />
                </span>
                <span className="commit-main">
                  <span className="commit-msg">{act.summary}</span>
                  <span className="commit-sub">
                    <span className="commit-who">{act.author}</span>
                    {e.commit.date && (
                      <span className="commit-when">
                        {e.commit.date.slice(0, 10)} · {timeAgo(e.commit.date)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <button className="commit-link" onClick={() => onOpenCommit(e.commit.hash)} title="View the full commit">
                <code>{shortHash(e.commit.hash)}</code>
              </button>
            </div>
            {open && <DiffView rows={e.rows} mode="unified" />}
          </div>
        );
      })}
    </div>
  );
}
