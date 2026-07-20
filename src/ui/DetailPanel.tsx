import { useState } from 'react';
import { TYPE_LABEL, locationLabel, type EdgeKind, type GraphEdge, type Graph, type KORecord } from '../data/types';
import type { MatchLine } from '../data/search';
import { Highlight } from './highlight';
import { History } from './History';
import { useDialog } from './useDialog';
import { cap, healthTag, plural, timeAgo } from './format';
import { linkForRecord, type CriblLink } from './linkBuilder';
import { groupInstances } from '../data/crossGroup';
import { isSecretValue, SECRET_MASK } from '../data/secrets';

const EDGE_LABEL: Record<EdgeKind, string> = {
  'source-pipeline': 'pre-process pipeline',
  'source-route': 'routing',
  'source-output': 'direct destination',
  quickconnect: 'QuickConnect',
  'route-pipeline': 'pipeline',
  'route-pack': 'pack',
  'route-output': 'destination',
  chain: 'chains to',
  lookup: 'lookup',
  'dest-pipeline': 'post-process pipeline',
};

interface DetailPanelProps {
  record: KORecord;
  matchLines: MatchLine[];
  graph: Graph;
  byKey: Map<string, KORecord>;
  records: KORecord[];
  onNavigate: (key: string) => void;
  onCompare: (key: string) => void;
  onCompareGroups: (key: string) => void;
  onOpenCommit: (hash: string) => void;
  onClose: () => void;
}

export function DetailPanel({ record, matchLines, graph, byKey, records, onNavigate, onCompare, onCompareGroups, onOpenCommit, onClose }: DetailPanelProps) {
  const [tab, setTab] = useState<'config' | 'history'>('config');
  const dialogRef = useDialog<HTMLElement>();
  const link = linkForRecord(record);
  const [copied, setCopied] = useState(false);
  const matchByText = new Map(matchLines.map((m) => [m.text, m.spans]));

  const uses = (graph.out.get(record.key) ?? []).filter((e) => byKey.has(e.to));
  const usedBy = (graph.in.get(record.key) ?? []).filter((e) => byKey.has(e.from));
  const packRecord = record.pack ? byKey.get(`${record.group}/-/pack/${record.pack}`) : undefined;
  const members =
    record.type === 'pack'
      ? records.filter((r) => r.pack === record.id && r.group === record.group && r.type !== 'pack')
      : [];
  const hasRelationships = uses.length > 0 || usedBy.length > 0 || record.pack !== undefined || members.length > 0;
  // Offer the cross-group comparison only when this object actually lives in 2+ groups.
  const groupCount = record.type === 'pack' ? 1 : groupInstances(record, records).length;

  const copyJson = () => {
    void navigator.clipboard?.writeText(JSON.stringify(record.raw, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-label={`${TYPE_LABEL[record.type]} ${record.name}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="detail-head">
          <span className={`tag tag-${record.type}`}>{TYPE_LABEL[record.type]}</span>
          <span className="detail-title" title={record.name}>
            {record.name}
          </span>
          <button className="detail-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <dl className="detail-meta">
          <Meta label="Location" value={locationLabel(record)} />
          <Meta label="ID" value={record.id} mono />
          {record.disabled && <Meta label="State" value="Disabled" />}
          {record.health && <Meta label="Health" value={cap(healthTag(record.health))} />}
          {record.lastTouched && <Meta label={record.lastTouchedApprox ? 'Created' : 'Modified'} value={`${timeAgo(record.lastTouched)} (${record.lastTouched.slice(0, 10)})`} />}
          {record.owner && <Meta label={record.lastTouchedApprox ? 'Created by' : 'Last modified by'} value={record.ownerEmail ? `${record.owner} <${record.ownerEmail}>` : record.owner} />}
        </dl>

        <div className="detail-actions">
          {link.linkable &&
            (link.href ? (
              <button className="btn btn-primary" onClick={() => window.open(link.href!, '_blank', 'noopener')} title={openTitle(record, link)}>
                Open in Cribl <span aria-hidden="true">↗</span>
              </button>
            ) : (
              <div className="detail-path">
                <code>{link.path}</code>
                <button className="detail-copy" onClick={() => void navigator.clipboard?.writeText(link.path)} title="Copy the Leader path">
                  Copy
                </button>
              </div>
            ))}
          <button className="btn" onClick={() => onCompare(record.key)}>
            Compare
          </button>
          {groupCount > 1 && (
            <button className="btn" onClick={() => onCompareGroups(record.key)} title={`This ${TYPE_LABEL[record.type].toLowerCase()} exists in ${groupCount} Worker Groups`}>
              Compare across groups
            </button>
          )}
          <button className="btn" onClick={copyJson}>
            {copied ? '✓ Copied' : 'Copy JSON'}
          </button>
        </div>
        {!link.linkable && (
          <p className="detail-note" title="Sensitive-Data / Guard rules and protobuf libraries have no dedicated page in the Knowledge menu on this Cribl edition.">
            No dedicated page in the Cribl Leader UI for this object type.
          </p>
        )}

        <div className="detail-tabs">
          <button className={tab === 'config' ? 'tab-active' : ''} onClick={() => setTab('config')}>
            Config
          </button>
          <button className={tab === 'history' ? 'tab-active' : ''} onClick={() => setTab('history')}>
            History
          </button>
        </div>

        <div className="detail-body">
          {tab === 'config' ? (
            <>
              {hasRelationships && (
                <section className="detail-section">
                  <h3 className="detail-subhead">Relationships</h3>
                  {record.pack && (
                    <div className="ref-group">
                      <div className="ref-label">Part of pack</div>
                      {packRecord ? (
                        <button className="ref-row" onClick={() => onNavigate(packRecord.key)}>
                          <span className="tag tag-pack">pack</span>
                          <span className="ref-name">{packRecord.name}</span>
                        </button>
                      ) : (
                        <div className="ref-plain">{record.pack}</div>
                      )}
                    </div>
                  )}
                  {members.length > 0 && <MemberList label="Contains" members={members} onNavigate={onNavigate} />}
                  {usedBy.length > 0 && <RefList label="Used by" edges={usedBy} endpoint="from" byKey={byKey} onNavigate={onNavigate} />}
                  {uses.length > 0 && <RefList label="Uses" edges={uses} endpoint="to" byKey={byKey} onNavigate={onNavigate} />}
                </section>
              )}
              <section className="detail-section">
                <h3 className="detail-subhead">Config ({record.searchText.length} {plural(record.searchText.length, 'setting')})</h3>
                {record.searchText.map((line, i) => {
                  // Mask a secret leaf here too, so the Config tab matches what Compare and
                  // Across Worker Groups show; a masked line is never search-highlighted.
                  const masked = maskConfigLine(line);
                  return (
                    <div className="detail-match" key={i}>
                      {masked === line ? <Highlight text={line} spans={matchByText.get(line) ?? []} /> : masked}
                    </div>
                  );
                })}
              </section>
            </>
          ) : (
            <section className="detail-section">
              <History record={record} records={records} onOpenCommit={onOpenCommit} />
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

function RefList({
  label,
  edges,
  endpoint,
  byKey,
  onNavigate,
}: {
  label: string;
  edges: GraphEdge[];
  endpoint: 'from' | 'to';
  byKey: Map<string, KORecord>;
  onNavigate: (key: string) => void;
}) {
  const rows = edges.slice(0, 25);
  return (
    <div className="ref-group">
      <div className="ref-label">{label}</div>
      {rows.map((e, i) => {
        const key = endpoint === 'from' ? e.from : e.to;
        const rec = byKey.get(key);
        if (!rec) return null;
        return (
          <button className="ref-row" key={`${key}-${i}`} onClick={() => onNavigate(key)}>
            <span className={`tag tag-${rec.type}`}>{TYPE_LABEL[rec.type]}</span>
            <span className="ref-name">{rec.name}</span>
            <span className="ref-kind">{EDGE_LABEL[e.kind]}</span>
          </button>
        );
      })}
      {edges.length > rows.length && <div className="ref-more">+{edges.length - rows.length} more</div>}
    </div>
  );
}

function MemberList({
  label,
  members,
  onNavigate,
}: {
  label: string;
  members: KORecord[];
  onNavigate: (key: string) => void;
}) {
  const rows = members.slice(0, 25);
  return (
    <div className="ref-group">
      <div className="ref-label">{label}</div>
      {rows.map((rec) => (
        <button className="ref-row" key={rec.key} onClick={() => onNavigate(rec.key)}>
          <span className={`tag tag-${rec.type}`}>{TYPE_LABEL[rec.type]}</span>
          <span className="ref-name">{rec.name}</span>
        </button>
      ))}
      {members.length > rows.length && <div className="ref-more">+{members.length - rows.length} more</div>}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail-meta-row">
      <dt>{label}</dt>
      <dd className={mono ? 'td-mono' : undefined}>{value}</dd>
    </div>
  );
}

// A flattened `key: value` config line with any secret value replaced by the mask token.
// Returns the line unchanged when it holds no secret (so it stays search-highlightable).
function maskConfigLine(line: string): string {
  const i = line.indexOf(': ');
  if (i < 0) return line;
  const key = line.slice(0, i);
  return isSecretValue(key, line.slice(i + 2)) ? `${key}: ${SECRET_MASK}` : line;
}

// The "Open in Cribl" tooltip, honest about whether the link reaches the object itself or
// only its list page. Routes are the only linkable type that can't be reached individually
// (the Leader has no per-route page); everything else opens its own object.
function openTitle(record: KORecord, link: CriblLink): string {
  if (link.itemLevel) return `Open this ${TYPE_LABEL[record.type].toLowerCase()} in the Cribl Leader UI`;
  return "Opens the group's Routes page — individual routes aren't addressable in the Leader";
}
