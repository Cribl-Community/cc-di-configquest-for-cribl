// The Overview (visibility) page: an operator readout of the loaded index — config
// hygiene (severity-tiered), inventory, health, and recent changes — built from the
// same table/panel primitives as Browse. Every row drills into the Browse table with
// the matching filter applied. Each panel renders its own empty/degraded state.

import { FINDING_LABELS, KO_TYPES, TYPE_LABEL as TYPE_LABELS, emptyFilters, locationLabel, type FindingCategory, type Filters, type KORecord, type KOType } from '../data/types';
import { DEFAULT_SEVERITY, SEVERITY_RANK, type SeverityMap } from '../data/severity';
import type { RecentActivity } from './useRecentActivity';
import { cap, plural, shortHash, timeAgo } from './format';

interface OverviewProps {
  records: KORecord[];
  ageAvailable: boolean;
  builtAt: string | null;
  activity: RecentActivity;
  severity?: SeverityMap;
  onApply: (filters: Filters) => void;
  onOpen: (key: string) => void;
  onOpenCommit: (hash: string) => void;
}

export function Overview({ records, ageAvailable, builtAt, activity, severity = DEFAULT_SEVERITY, onApply, onOpen, onOpenCommit }: OverviewProps) {
  const issueCounts = new Map<FindingCategory, number>();
  const typeCounts = new Map<KOType, number>();
  const groupCounts = new Map<string, number>();
  const groups = new Set<string>();
  const packs = new Set<string>();
  for (const r of records) {
    typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    groupCounts.set(r.group, (groupCounts.get(r.group) ?? 0) + 1);
    groups.add(r.group);
    if (r.pack) packs.add(r.pack);
    for (const i of r.issues ?? []) issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1);
  }

  // Findings that are switched on, ordered by severity then count.
  const findings = (Object.keys(FINDING_LABELS) as FindingCategory[])
    .map((c) => ({ c, count: issueCounts.get(c) ?? 0, sev: severity[c] }))
    .filter((x) => x.count > 0 && x.sev !== 'off')
    .sort((a, b) => SEVERITY_RANK[a.sev] - SEVERITY_RANK[b.sev] || b.count - a.count);
  const findingTotal = findings.reduce((s, x) => s + x.count, 0);

  // Worker groups by object count, most first — the share bar is most telling here.
  const groupRows = [...groupCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maxGroup = Math.max(1, ...groupCounts.values());
  const recent = ageAvailable
    ? records.filter((r) => r.lastTouched && !r.lastTouchedApprox).sort((a, b) => (a.lastTouched! < b.lastTouched! ? 1 : -1)).slice(0, 6)
    : [];

  const only = (patch: Partial<Filters>): Filters => ({ ...emptyFilters(), ...patch });

  // Props for a clickable table row: focusable, keyboard-activatable, and labeled so
  // the drill-down is discoverable (matches the ConfigTable row pattern).
  const clickRow = (onClick: () => void, label: string) => ({
    className: 'click',
    role: 'button' as const,
    tabIndex: 0,
    title: label,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  });

  return (
    <div className="ov">
      <header className="ov-bar">
        <h2 className="ov-title">Overview</h2>
        <span className="ov-meta">
          <span className="mono">{records.length}</span> {plural(records.length, 'object')} <span className="ov-dot" aria-hidden="true">·</span>{' '}
          <span className="mono">{groups.size}</span> {plural(groups.size, 'Worker Group')}
          {packs.size > 0 && (
            <>
              {' '}
              <span className="ov-dot" aria-hidden="true">·</span> <span className="mono">{packs.size}</span> {packs.size === 1 ? 'pack' : 'packs'}
            </>
          )}
          {builtAt && (
            <>
              {' '}
              <span className="ov-dot" aria-hidden="true">·</span> indexed <span className="mono">{timeAgo(builtAt)}</span>
            </>
          )}
        </span>
      </header>

      <div className="ov-grid">
        <div className="ov-row ov-row-3">
        <section className="panel">
          <div className="panel-h">
            <span className="panel-t">Config hygiene</span>
            {findingTotal > 0 && <span className="panel-n">{findingTotal} {plural(findingTotal, 'finding')}</span>}
          </div>
          {findings.length === 0 ? (
            <PanelEmpty title="No issues found." />
          ) : (
            <table className="ptable">
              <tbody>
                {findings.map(({ c, count, sev }) => (
                  <tr key={c} {...clickRow(() => onApply(only({ issues: [c] })), 'Show in Browse')}>
                    <td>
                      <div className="cell">
                        <span className={`sev-count sev-${sev}`}>{count}</span>
                        <span className="rowname">{cap(FINDING_LABELS[c])}</span>
                        <span className="sev-tag" title={`Severity tier — set in Settings`}>{sev}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel-h">
            <span className="panel-t">Inventory</span>
            <span className="panel-n">{records.length} {plural(records.length, 'object')}</span>
          </div>
          <div className="ov-tscroll">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="r">Count</th>
                </tr>
              </thead>
              <tbody>
                {KO_TYPES.filter((t) => typeCounts.get(t)).map((t) => (
                  <tr key={t} {...clickRow(() => onApply(only({ types: [t] })), 'Show in Browse')}>
                    <td>
                      <div className="cell">
                        <span className="kind">{TYPE_LABELS[t]}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell num r">{typeCounts.get(t)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h">
            <span className="panel-t">By Worker Group</span>
            <span className="panel-n">
              {groups.size} {groups.size === 1 ? 'group' : 'groups'}
            </span>
          </div>
          <div className="ov-tscroll">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Worker Group</th>
                  <th className="r">Count</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map(([g, n]) => (
                  <tr key={g} {...clickRow(() => onApply(only({ groups: [g] })), 'Show in Browse')}>
                    <td>
                      <div className="cell rowname">{g}</div>
                    </td>
                    <td>
                      <div className="cell num r">{n}</div>
                    </td>
                    <td>
                      <div className="cell">
                        <span className="share" style={{ width: `${(n / maxGroup) * 100}%` }} title={`${n} of ${records.length} objects`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        </div>

        <div className="ov-row">
        <section className="panel">
          <div className="panel-h">
            <span className="panel-t">Recently changed</span>
          </div>
          {!ageAvailable ? (
            <PanelEmpty title="Change history unavailable." detail="Needs versioning access on the Leader to attribute changes." />
          ) : recent.length === 0 ? (
            <PanelEmpty title="No recorded changes yet." />
          ) : (
            <table className="ptable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Worker Group</th>
                  <th className="r">Changed</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.key} {...clickRow(() => onOpen(r.key), 'Open details')}>
                    <td>
                      <div className="cell rowname">{r.name}</div>
                    </td>
                    <td>
                      <div className="cell">
                        <span className="kind">{TYPE_LABELS[r.type]}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell muted">{locationLabel(r)}</div>
                    </td>
                    <td>
                      <div className="cell num r muted">{timeAgo(r.lastTouched!)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="panel-h">
            <span className="panel-t">Recent activity</span>
          </div>
          {activity.loading ? (
            <div className="panel-loading" role="status" aria-live="polite">
              <span className="hist-spinner" aria-hidden="true" />
              Loading activity…
            </div>
          ) : !activity.available ? (
            <PanelEmpty title="Change history unavailable." detail="Needs versioning access on the Leader to read the commit log." />
          ) : activity.items.length === 0 ? (
            <PanelEmpty title="No recent activity." />
          ) : (
            <div className="ov-feed">
              {activity.items.map((a) => (
                <button className="ov-feeditem" key={a.hash} onClick={() => onOpenCommit(a.hash)} title="Open this commit">
                  <div className="ov-feed-msg">{a.summary}</div>
                  <div className="ov-feed-meta">
                    <span className="t2">{a.author}</span>
                    <span className="ov-dot" aria-hidden="true">·</span>
                    <span className="mono muted">{shortHash(a.hash)}</span>
                    <span className="ov-dot" aria-hidden="true">·</span>
                    <span className="mono muted">{timeAgo(a.date)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}

export function PanelEmpty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="panel-empty">
      <span className="panel-empty-t">{title}</span>
      {detail && <span className="panel-empty-d">{detail}</span>}
    </div>
  );
}

