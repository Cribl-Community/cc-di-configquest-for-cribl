import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph } from './data/graph';
import { crossref } from './data/crossref';
import { coverage as computeCoverage } from './data/coverage';
import { applyIssues } from './data/issues';
import { facetValues, search, type SearchResult } from './data/search';
import { applyAgeMap, staleFindings } from './data/git/ageIndex';
import { applyHealth } from './data/health';
import { toCsv } from './data/csv';
import { emptyFilters, filtersActive, type Filters } from './data/types';
import { plural, timeAgo } from './ui/format';
import { useIndex } from './ui/useIndex';
import { emptyUrlState, useUrlState } from './ui/useUrlState';
import { ConfigTable } from './ui/ConfigTable';
import type { SortCol, SortState } from './ui/sort';
import { FilterBar } from './ui/FilterBar';
import { ActiveFilters } from './ui/ActiveFilters';
import { DetailPanel } from './ui/DetailPanel';
import { Compare } from './ui/Compare';
import { Commits } from './ui/Commits';
import { AcrossGroups } from './ui/AcrossGroups';
import { NavRail } from './ui/NavRail';
import { Overview } from './ui/Overview';
import { Settings } from './ui/Settings';
import { Help } from './ui/Help';
import { useTheme } from './ui/useTheme';
import { MIN_REFRESH_SECONDS, useSettings } from './ui/useSettings';
import { useRecentActivity } from './ui/useRecentActivity';
import type { UrlState } from './ui/useUrlState';

const PAGE = 200;

// Resets every page/overlay flag (and the open asset) to closed; a nav handler spreads
// this, then flips on its own page — so pages stay mutually exclusive from one place.
const CLOSE_PAGES: Partial<UrlState> = {
  overview: false,
  browse: false,
  settings: false,
  help: false,
  commits: false,
  commit: null,
  differences: false,
  xgroup: null,
  compare: null,
  asset: null,
};

function App() {
  const idx = useIndex();
  const [url, setUrl] = useUrlState();
  const [theme, toggleTheme, setTheme] = useTheme();
  const [settings, updateSettings] = useSettings();
  const activity = useRecentActivity(10, idx.builtAt);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const sort = url.sort; // table sort now lives in the URL, so it's shareable/bookmarkable
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);

  const graph = useMemo(() => buildGraph(idx.records), [idx.records]);
  // Scopes whose fetch had a data hole (a core endpoint failed) — their structural findings
  // are suppressed so a missing pipeline/route/output can't be read as a hygiene defect.
  const unreliableScopes = useMemo(
    () => new Set((idx.report?.partialFailures ?? []).map((f) => `${f.group}/${f.pack ?? '-'}`)),
    [idx.report],
  );
  // Structural hygiene (unreferenced pipelines, unreachable routes, unused lookups, coverage)
  // depends only on the structure, so it keys off the structural records — NOT recomputed when
  // the git age map or health land (which change only enrichment, not structure).
  const baseFindings = useMemo(() => crossref(idx.records, graph, { unreliableScopes }), [idx.records, graph, unreliableScopes]);
  const coverage = useMemo(() => computeCoverage(idx.records, graph, { unreliableScopes }), [idx.records, graph, unreliableScopes]);
  // Merge the git age map in; stale findings are computed FROM the age-merged list (it needs
  // lastTouched), so the stale-object issue tag and its Flags-facet count don't vanish.
  const aged = useMemo(() => applyAgeMap(idx.records, idx.ageMap), [idx.records, idx.ageMap]);
  const findings = useMemo(
    () => ({ ...baseFindings, staleObjects: idx.ageAvailable ? staleFindings(aged, settings.staleDays) : [] }),
    [baseFindings, aged, idx.ageAvailable, settings.staleDays],
  );
  // The display list: tag issues on the age-merged records, then merge in health.
  const records = useMemo(() => applyHealth(applyIssues(aged, findings, coverage), idx.healthMap), [aged, findings, coverage, idx.healthMap]);
  const byKey = useMemo(() => new Map(records.map((r) => [r.key, r])), [records]);
  const facets = useMemo(() => facetValues(records), [records]);

  // Deferred so a keystroke updates the input instantly while the (potentially heavy at
  // scale) search recomputes on a later, interruptible render — no input lag.
  const deferredQ = useDeferredValue(url.q);
  const results = useMemo(() => search(records, deferredQ, url.filters), [records, deferredQ, url.filters]);
  const sorted = useMemo(() => sortResults(results, sort), [results, sort]);
  const visible = useMemo(() => sorted.slice(0, limit), [sorted, limit]);

  useEffect(() => {
    setLimit(PAGE);
  }, [url.q, url.filters, sort]);

  const searching = deferredQ.trim() !== '';
  const filtered = searching || filtersActive(url.filters);
  const openRecord = url.asset ? byKey.get(url.asset) : undefined;
  const openMatchLines = url.asset ? results.find((r) => r.record.key === url.asset)?.matchLines ?? [] : [];
  const skippedDetail = (idx.report?.skippedGroups ?? []).map((s) => `${s.group} (${s.status ?? 'network'})`).join(', ');
  const partialDetail = (idx.report?.partialFailures ?? [])
    .map((f) => `${f.group}${f.pack ? `/${f.pack}` : ''}: ${f.endpoints.join(', ')}${f.status ? ` (${f.status})` : ''}`)
    .join('; ');

  const patch = (next: Partial<typeof url>) => setUrl({ ...url, ...next });
  const openAsset = (key: string | null) => patch({ asset: key });
  const setFilters = (filters: Filters) => patch({ filters });
  const onSort = (col: SortCol) =>
    patch({ sort: sort.col === col ? { col, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const inInput = el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        if (url.compare !== null) patch({ compare: null });
        else if (url.asset) openAsset(null);
        else if (inInput) searchRef.current?.blur();
        return;
      }
      // The table shortcuts ('/', arrows, Enter) are only for the Browse view — bail while
      // typing, while a drawer/overlay owns the keyboard, or on any other page. `!url.browse`
      // covers every non-Browse page and the Compare overlay in one check.
      if (inInput || url.asset !== null || !url.browse) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = visible.findIndex((r) => r.record.key === selectedKey);
        const nextIdx = clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, visible.length - 1);
        setSelectedKey(visible[nextIdx]?.record.key ?? null);
        // Keep the moving highlight on screen when it crosses the fold.
        requestAnimationFrame(() => document.querySelector('.ctable .row-selected')?.scrollIntoView({ block: 'nearest' }));
      } else if (e.key === 'Enter' && selectedKey) {
        openAsset(selectedKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedKey, url.asset, url.compare, url.browse]);

  // Periodic re-index when enabled in Settings. The ref lets the interval skip a tick
  // that would stack a rebuild on one already in flight.
  const refreshingRef = useRef(idx.refreshing);
  refreshingRef.current = idx.refreshing;
  useEffect(() => {
    if (!settings.autoRefresh) return;
    const ms = Math.max(MIN_REFRESH_SECONDS, settings.refreshSeconds) * 1000;
    const id = window.setInterval(() => {
      if (!refreshingRef.current) idx.refresh();
    }, ms);
    return () => window.clearInterval(id);
    // idx.refresh is stable; re-running on the whole idx would rebuild the interval constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoRefresh, settings.refreshSeconds, idx.refresh]);

  if (idx.status === 'hydrating' || (idx.status === 'building' && idx.records.length === 0)) {
    return <Splash message={idx.status === 'building' ? 'Indexing your Cribl configuration…' : 'Loading…'} />;
  }
  if (idx.status === 'error' && idx.records.length === 0) {
    return <ErrorScreen message={idx.error} onRetry={idx.refresh} />;
  }

  return (
    <div className="app">
      <NavRail
        theme={theme}
        refreshing={idx.refreshing}
        compareOpen={url.compare !== null}
        overviewActive={url.overview}
        commitsActive={url.commits}
        differencesActive={url.differences}
        settingsActive={url.settings}
        helpActive={url.help}
        onBrowse={() => setUrl({ ...emptyUrlState(), browse: true, sort: url.sort })}
        onCompare={() => patch({ ...CLOSE_PAGES, compare: [] })}
        onOverview={() => patch({ ...CLOSE_PAGES, overview: true })}
        onCommits={() => patch({ ...CLOSE_PAGES, commits: true })}
        onDifferences={() => patch({ ...CLOSE_PAGES, differences: true })}
        onSettings={() => patch({ ...CLOSE_PAGES, settings: true })}
        onHelp={() => patch({ ...CLOSE_PAGES, help: true })}
        onToggleTheme={toggleTheme}
        onRefresh={idx.refresh}
      />
      {/* The search + export header belongs to Browse only; `browse` is the explicit page flag. */}
      {url.browse && (
        <header className="topbar">
          <div className="topbar-search">
          <span aria-hidden style={{ color: 'var(--muted)' }}>
            ⌕
          </span>
          <input
            ref={searchRef}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            spellCheck={false}
            aria-label="Search names, IDs, and config values"
            placeholder="Search names, IDs, and config values across every Worker Group…"
            value={url.q}
            onChange={(e) => patch({ q: e.target.value })}
          />
          <span className="kbd">/</span>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={() => exportCsv(sorted)} disabled={sorted.length === 0}>
            Export CSV
          </button>
        </div>
        </header>
      )}

      {idx.status === 'error' && idx.records.length > 0 && (
        <div className="error-banner">
          Refresh failed: {idx.error ?? 'unknown error'}. Showing the last successful index.
          <button className="error-retry" onClick={idx.refresh}>
            retry
          </button>
        </div>
      )}

      <div className="main">
        {url.help ? (
          <Help />
        ) : url.settings ? (
          <Settings
            settings={settings}
            onUpdate={updateSettings}
            theme={theme}
            onSetTheme={setTheme}
            version={__APP_VERSION__}
            onRefresh={idx.refresh}
            refreshing={idx.refreshing}
          />
        ) : url.overview ? (
          <Overview
            records={records}
            ageAvailable={idx.ageAvailable}
            builtAt={idx.builtAt}
            activity={activity}
            severity={settings.severity}
            onApply={(filters) => patch({ overview: false, browse: true, filters, q: '' })}
            onOpen={(key) => patch({ overview: false, browse: true, asset: key })}
            onOpenCommit={(hash) => patch({ overview: false, commits: true, commit: hash })}
          />
        ) : url.commits ? (
          <Commits commit={url.commit} builtAt={idx.builtAt} onSelect={(hash) => patch({ commit: hash })} />
        ) : url.differences ? (
          <AcrossGroups xgroup={url.xgroup} records={records} byKey={byKey} onPick={(key) => patch({ xgroup: key })} />
        ) : url.compare !== null ? (
          <Compare
            compare={url.compare}
            byKey={byKey}
            records={records}
            onChange={(keys) => patch({ compare: keys })}
          />
        ) : (
          <>
            <FilterBar
              records={records}
              filters={url.filters}
              facets={facets}
              healthAvailable={idx.healthAvailable}
              ageAvailable={idx.ageAvailable}
              onChange={setFilters}
            />
        <ActiveFilters
          query={url.q}
          filters={url.filters}
          onQuery={(q) => patch({ q })}
          onFilters={setFilters}
          onClearAll={() => setUrl({ ...url, q: '', filters: emptyFilters() })}
        />
        <div className="toolbar">
          <span className="toolbar-count" aria-live="polite">
            <strong>{filtered ? results.length : records.length}</strong>
            {filtered ? ` of ${records.length}` : ''} {plural(records.length, 'object')}
          </span>
          <span className="toolbar-spacer" />
          <span className="statusline">
            <span>{idx.builtAt ? `indexed ${timeAgo(idx.builtAt)}` : 'not indexed'}</span>
            {(idx.report?.skippedGroups.length ?? 0) > 0 && (
              <>
                <span className="statusline-sep">·</span>
                <span
                  className="statusline-warn"
                  title={skippedDetail}
                  aria-label={`${idx.report?.skippedGroups.length} Worker Groups skipped: ${skippedDetail}`}
                >
                  {idx.report?.skippedGroups.length} skipped
                </span>
              </>
            )}
            {(idx.report?.partialFailures.length ?? 0) > 0 && (
              <>
                <span className="statusline-sep">·</span>
                <span
                  className="statusline-warn"
                  title={`Some data could not be loaded, so hygiene findings for it are suppressed: ${partialDetail}`}
                  aria-label={`${idx.report?.partialFailures.length} scopes partially loaded: ${partialDetail}`}
                >
                  {idx.report?.partialFailures.length} partial
                </span>
              </>
            )}
            {!idx.healthAvailable && !idx.healthLoading && (
              <>
                <span className="statusline-sep">·</span>
                <span
                  title="Health needs status access on the Leader."
                  aria-label="No health data: needs status access on the Leader."
                >
                  no health
                </span>
              </>
            )}
          </span>
        </div>

        <ConfigTable
          results={visible}
          sort={sort}
          onSort={onSort}
          selectedKey={selectedKey}
          healthAvailable={idx.healthAvailable}
          ageAvailable={idx.ageAvailable}
          searching={searching}
          onOpen={openAsset}
          hasMore={sorted.length > limit}
          onShowMore={() => setLimit((l) => l + PAGE)}
          onClearFilters={filtered ? () => setUrl({ ...url, q: '', filters: emptyFilters() }) : undefined}
            />
          </>
        )}
      </div>

      {openRecord && (
        <DetailPanel
          record={openRecord}
          matchLines={openMatchLines}
          graph={graph}
          byKey={byKey}
          records={records}
          onNavigate={openAsset}
          onCompare={(key) => patch({ ...CLOSE_PAGES, compare: [key] })}
          onCompareGroups={(key) => patch({ ...CLOSE_PAGES, differences: true, xgroup: key })}
          onOpenCommit={(hash) => patch({ ...CLOSE_PAGES, commits: true, commit: hash })}
          onClose={() => openAsset(null)}
        />
      )}
    </div>
  );
}

function sortResults(results: SearchResult[], sort: SortState): SearchResult[] {
  if (sort.col === 'relevance') return results; // search's rank + name order
  const dir = sort.dir === 'asc' ? 1 : -1;
  const keyOf = (r: SearchResult): string => {
    const rec = r.record;
    switch (sort.col) {
      case 'name':
        return rec.name.toLowerCase();
      case 'type':
        return rec.type;
      case 'group':
        return rec.group;
      case 'modified':
        return rec.lastTouched ?? '';
      default:
        return '';
    }
  };
  return [...results].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -dir : ka > kb ? dir : a.record.name.localeCompare(b.record.name);
  });
}

function exportCsv(results: SearchResult[]): void {
  const csv = toCsv(results.map((r) => r.record));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'cribl-config-inventory.csv';
  a.click();
  URL.revokeObjectURL(href);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function Splash({ message }: { message: string }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-spinner" />
      <p>{message}</p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="splash">
      <h1 className="splash-title">Config Quest for Cribl couldn't load</h1>
      <p className="splash-error">{message ?? 'Unknown error.'}</p>
      <button className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export default App;
