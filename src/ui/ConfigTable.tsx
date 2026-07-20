import type { SearchResult } from '../data/search';
import { TYPE_LABEL, type FindingCategory } from '../data/types';
import { Highlight } from './highlight';
import { healthTag, timeAgo } from './format';
import type { SortCol, SortState } from './sort';

const FLAG_SHORT: Record<FindingCategory, string> = {
  'orphaned-pipeline': 'unreferenced',
  'dangling-route': 'unresolved',
  'unused-lookup': 'unused',
  disabled: 'disabled',
  'stale-object': 'aging',
  'dead-end-source': 'unrouted',
  'dead-end-destination': 'unreached',
  'unreachable-route': 'unreachable',
};

// Full meaning per flag, surfaced on hover (the short word alone isn't self-explaining).
const FLAG_HELP: Record<FindingCategory, string> = {
  'orphaned-pipeline': 'Unreferenced — no Route, Source, Destination, or Chain uses this pipeline',
  'dangling-route': 'Unresolved — references a pipeline or output that does not exist',
  'unused-lookup': 'Unused — no pipeline Lookup function references this file',
  disabled: 'Disabled — turned off in the configuration',
  'stale-object': 'Aging — untouched longer than the stale-object threshold (Settings)',
  'dead-end-source': 'Unrouted — not wired to any route or destination; its data goes nowhere',
  'dead-end-destination': 'Unreached — no enabled source path reaches this destination',
  'unreachable-route': 'Unreachable — an earlier final route always matches first',
};

const HEALTH_HELP: Record<'healthy' | 'unhealthy' | 'unknown', string> = {
  healthy: 'Reporting healthy on the Leader',
  unhealthy: 'Reporting unhealthy on the Leader',
  unknown: 'No operational status reported for this object',
};

interface ConfigTableProps {
  results: SearchResult[];
  sort: SortState;
  onSort: (col: SortCol) => void;
  selectedKey: string | null;
  healthAvailable: boolean;
  ageAvailable: boolean;
  searching: boolean;
  onOpen: (key: string) => void;
  hasMore: boolean;
  onShowMore: () => void;
  /** Provided only when a query/filter is active, to offer a reset from the empty state. */
  onClearFilters?: () => void;
}

export function ConfigTable(props: ConfigTableProps) {
  const { results, sort, onSort, selectedKey, healthAvailable, ageAvailable, searching, onOpen } = props;

  if (results.length === 0) {
    // A query/filter is active only when onClearFilters is wired; otherwise an empty
    // table means the index itself is empty (no access / all groups skipped), not a
    // filter miss — say which so the reset button isn't offered against nothing.
    const filtered = Boolean(props.onClearFilters);
    return (
      <div className="table-empty" role="status">
        <p>{filtered ? 'No objects match your search and filters.' : 'No objects indexed yet — check that the app has access to your Worker Groups, then Refresh.'}</p>
        {filtered && (
          <button className="btn" onClick={props.onClearFilters}>
            Clear search &amp; filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="ctable">
        <colgroup>
          <col className="col-name" />
          <col className="col-type" />
          <col className="col-group" />
          <col className="col-pack" />
          <col className="col-flags" />
          {ageAvailable && <col className="col-modified" />}
          {searching && <col className="col-match" />}
        </colgroup>
        <thead>
          <tr>
            <Th col="name" sort={sort} onSort={onSort}>
              Name
            </Th>
            <Th col="type" sort={sort} onSort={onSort}>
              Type
            </Th>
            <Th col="group" sort={sort} onSort={onSort}>
              Worker Group
            </Th>
            <th>Pack</th>
            <th>Flags</th>
            {ageAvailable && (
              <Th col="modified" sort={sort} onSort={onSort}>
                Modified
              </Th>
            )}
            {searching && <th>Match</th>}
          </tr>
        </thead>
        <tbody>
          {results.map(({ record: r, nameSpans, matchLines }) => (
            <tr
              key={r.key}
              className={r.key === selectedKey ? 'row-selected' : ''}
              tabIndex={0}
              aria-label={`${r.name}, ${TYPE_LABEL[r.type]}, ${r.group}`}
              onClick={() => onOpen(r.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(r.key);
                }
              }}
            >
              <td className="td-name" title={r.name}>
                <Highlight text={r.name} spans={nameSpans} />
              </td>
              <td>
                <span className={`tag tag-${r.type}`}>{TYPE_LABEL[r.type]}</span>
              </td>
              <td className="td-muted">{r.group}</td>
              <td className="td-muted td-mono">{r.pack ?? ''}</td>
              <td>
                {healthAvailable && (r.type === 'source' || r.type === 'destination') && (
                  <span className={`htag htag-${healthTag(r.health)}`} title={HEALTH_HELP[healthTag(r.health)]}>
                    {healthTag(r.health)}
                  </span>
                )}
                {(r.issues ?? []).map((c) => (
                  <span className={`flag${c === 'disabled' ? ' flag-disabled' : ''}`} key={c} title={FLAG_HELP[c]}>
                    {FLAG_SHORT[c]}
                  </span>
                ))}
              </td>
              {ageAvailable && (
                <td
                  className="td-muted td-time"
                  title={
                    r.lastTouched
                      ? `${r.lastTouchedApprox ? 'Created ' : ''}${r.lastTouched.slice(0, 10)}${r.owner ? ` · ${r.lastTouchedApprox ? 'created by' : 'last changed by'} ${r.owner}` : ''}`
                      : undefined
                  }
                >
                  {r.lastTouched ? `${r.lastTouchedApprox ? '~' : ''}${timeAgo(r.lastTouched)}` : ''}
                </td>
              )}
              {searching && (
                <td className="match-preview" title={matchLines[0]?.text}>
                  {matchLines[0] && <Highlight text={matchLines[0].text} spans={matchLines[0].spans} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {props.hasMore && (
        <button className="btn table-more" onClick={props.onShowMore}>
          Show more ({results.length} shown)
        </button>
      )}
    </div>
  );
}

function Th({
  col,
  sort,
  onSort,
  children,
}: {
  col: SortCol;
  sort: SortState;
  onSort: (col: SortCol) => void;
  children: React.ReactNode;
}) {
  const active = sort.col === col;
  return (
    <th className="sortable" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={() => onSort(col)}>
        {children}
        {active && (
          <span className="sort-arrow" aria-hidden="true">
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </th>
  );
}

