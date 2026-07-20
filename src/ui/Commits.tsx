// The Commits page: the environment's git change log as a list-detail browser —
// the commit list on the left, the selected commit's full diff on the right. Reached
// from the nav rail (log, nothing focused), an Overview "Recent activity" item, or a
// detail-drawer History commit link (both focus a specific commit). The focused commit
// lives in the URL (`?commit=<hash>`), so it's shareable and Back-button friendly.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRecentActivity } from './useRecentActivity';
import { useCommitDiff, type CommitDiffState } from './useCommitDiff';
import { DiffView } from './DiffView';
import { PanelEmpty } from './Overview';
import { ChevronDown } from './icons';
import { shortHash, timeAgo } from './format';
import type { Activity } from '../data/git/activity';
import type { CommitFileDiff } from '../data/git/commitDetail';

interface CommitsProps {
  /** Focused commit hash from the URL, or null (log only). */
  commit: string | null;
  builtAt: string | null;
  onSelect: (hash: string | null) => void;
}

export function Commits({ commit, builtAt, onSelect }: CommitsProps) {
  const log = useRecentActivity(100, builtAt);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  // Filter the already-loaded log client-side (message, author, or hash) — no extra fetch.
  const shown = useMemo(
    () => (q ? log.items.filter((a) => `${a.summary} ${a.author} ${a.hash}`.toLowerCase().includes(q)) : log.items),
    [log.items, q],
  );
  const selected = commit ? log.items.find((a) => a.hash === commit || a.hash.startsWith(commit)) : undefined;
  const detail = useCommitDiff(commit);
  const count = log.available && log.items.length ? ` · ${q ? `${shown.length} of ${log.items.length}` : log.items.length} shown` : '';

  return (
    <div className="commits">
      <header className="commits-head">
        <h2 className="commits-title">Commits</h2>
        <span className="commits-sub">Newest first{count}.</span>
      </header>

      <div className="commits-body">
        <aside className="commits-list" aria-label="Commit log">
          {log.available && log.items.length > 0 && (
            <input
              className="commits-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter commits by message, author, or hash…"
              aria-label="Filter commits"
              spellCheck={false}
            />
          )}
          {log.loading ? (
            <div className="panel-loading" role="status" aria-live="polite">
              <span className="hist-spinner" aria-hidden="true" />
              Loading commits…
            </div>
          ) : !log.available ? (
            <PanelEmpty title="Change history unavailable." detail="Needs versioning access on the Leader to read the commit log." />
          ) : log.items.length === 0 ? (
            <PanelEmpty title="No commits yet." detail="Commits to this environment will appear here." />
          ) : shown.length === 0 ? (
            <PanelEmpty title="No commits match your filter." detail="Try a different message, author, or hash." />
          ) : (
            shown.map((a) => (
              <button
                key={a.hash}
                className={`commit-row${a.hash === commit ? ' commit-row-active' : ''}`}
                onClick={() => onSelect(a.hash)}
                aria-current={a.hash === commit ? 'true' : undefined}
              >
                <span className="commit-row-msg">{a.summary}</span>
                <span className="commit-row-meta">
                  <span className="t2">{a.author}</span>
                  <span className="ov-dot" aria-hidden="true">·</span>
                  <span className="mono muted">{shortHash(a.hash)}</span>
                  <span className="ov-dot" aria-hidden="true">·</span>
                  <span className="mono muted">{timeAgo(a.date)}</span>
                </span>
              </button>
            ))
          )}
        </aside>

        <section className="commit-detail" aria-label="Commit detail">
          {commit === null ? (
            <div className="commit-detail-empty">Select a commit to see everything it changed.</div>
          ) : (
            <CommitDetail hash={commit} activity={selected} detail={detail} />
          )}
        </section>
      </div>
    </div>
  );
}

function CommitDetail({ hash, activity, detail }: { hash: string; activity?: Activity; detail: CommitDiffState }) {
  const data = detail.data;
  // The files bar sticks directly below the header, whose height depends on how far the
  // commit message wraps — so measure it rather than hard-coding an offset.
  const headRef = useRef<HTMLDivElement>(null);
  const [headHeight, setHeadHeight] = useState(0);
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const measure = () => setHeadHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="commit-detail-head" ref={headRef}>
        <div className="commit-detail-msg">{activity?.summary ?? 'Commit'}</div>
        <div className="commit-detail-meta">
          {activity && (
            <>
              <span className="t2">{activity.author}</span>
              <span className="ov-dot" aria-hidden="true">·</span>
            </>
          )}
          <code className="mono">{shortHash(hash)}</code>
          {activity?.date && (
            <>
              <span className="ov-dot" aria-hidden="true">·</span>
              <span className="muted">
                {activity.date.slice(0, 10)} · {timeAgo(activity.date)}
              </span>
            </>
          )}
        </div>
      </div>

      {detail.loading ? (
        <div className="panel-loading" role="status" aria-live="polite">
          <span className="hist-spinner" aria-hidden="true" />
          Loading changes…
        </div>
      ) : !detail.available ? (
        <div className="hist-note">Change history needs versioning access on the Leader.</div>
      ) : detail.error ? (
        <div className="hist-note">
          Couldn't load this commit's changes.
          <div className="hist-subnote">{detail.error}</div>
        </div>
      ) : !data || data.files.length === 0 ? (
        <div className="hist-note">This commit has no file changes to show.</div>
      ) : (
        <CommitFiles key={hash} files={data.files} shown={data.shown} total={data.total} stickyTop={headHeight} />
      )}
    </>
  );
}

// The commit's per-file diffs, each independently collapsible; a header control folds
// or unfolds them all at once. Collapsed state is keyed by path and resets per commit
// (the component is remounted when `hash` changes upstream).
function CommitFiles({ files, shown, total, stickyTop }: { files: CommitFileDiff[]; shown: number; total: number; stickyTop: number }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const allOpen = collapsed.size === 0;

  return (
    <>
      <div className="commit-files-bar" style={{ top: stickyTop }}>
        <span>
          {total} {total === 1 ? 'file' : 'files'} changed{shown < total ? ` — showing ${shown}` : ''}
        </span>
        <button className="commit-foldall" onClick={() => setCollapsed(allOpen ? new Set(files.map((f) => f.path)) : new Set())}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {files.map((f) => {
        const open = !collapsed.has(f.path);
        const n = diffCounts(f.rows);
        return (
          <div className="commit-file" key={f.path}>
            <button className="commit-file-head" onClick={() => toggle(f.path)} aria-expanded={open}>
              <span className="commit-file-caret" aria-hidden="true">
                <ChevronDown />
              </span>
              <span className={`fstate fstate-${f.state}`} title={fstateLabel(f.state)}>
                {f.state || '·'}
              </span>
              <span className="mono commit-file-path">{f.path}</span>
              <span className="commit-file-stat">
                {n.add > 0 && <span className="stat-add">+{n.add}</span>}
                {n.del > 0 && <span className="stat-del">−{n.del}</span>}
              </span>
            </button>
            {open &&
              (f.rows.length > 0 ? <DiffView rows={f.rows} mode="unified" /> : <div className="commit-file-empty">No diff available for this file.</div>)}
          </div>
        );
      })}
    </>
  );
}

/** Added / deleted line counts for a file's diff rows (a `change` is both). */
function diffCounts(rows: CommitFileDiff['rows']): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const r of rows) {
    if (r.kind === 'add') add += 1;
    else if (r.kind === 'del') del += 1;
    else if (r.kind === 'change') {
      add += 1;
      del += 1;
    }
  }
  return { add, del };
}

function fstateLabel(state: string): string {
  return { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' }[state] ?? 'Changed';
}

