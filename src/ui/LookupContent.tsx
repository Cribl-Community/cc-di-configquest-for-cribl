// Renders lookup (.csv) comparison. Compare shows a metadata summary of two lookups
// (size, row/column counts, identical-by-hash). Across Worker Groups clusters a lookup's
// instances by size — and content hash for same-size groups — so a large file is compared
// without fetching every row; content is fetched lazily (same-size disambiguation, drill-in).

import { useMemo, useState } from 'react';
import { clusterLookups, lookupMetaDiff, lookupSize, sizeCollisionRecords, type LookupContent, type LookupVariant } from '../data/lookupContent';
import { locationLabel, type KORecord } from '../data/types';
import { useLookupContent } from './useLookupContent';
import { ChevronDown } from './icons';

const ROW_CAP = 200; // rows rendered on drill-in before a "+N more" note

// ---- Compare: two lookups, metadata summary --------------------------------------

export function LookupCompare({ a, b }: { a: KORecord; b: KORecord }) {
  const { loading, error, byKey } = useLookupContent(useMemo(() => [a, b], [a, b]));
  const ca = byKey.get(a.key);
  const cb = byKey.get(b.key);
  const diff = useMemo(() => (ca && cb ? lookupMetaDiff(ca, cb) : null), [ca, cb]);

  if (loading) return <div className="cmp-note">Loading lookup content…</div>;
  if (error) return <div className="cmp-note lkp-err">Couldn't load lookup content: {error}</div>;
  if (!diff) return <div className="cmp-note">No content to compare.</div>;
  const allShared = diff.onlyA.length === 0 && diff.onlyB.length === 0;

  return (
    <div className="lkp-meta">
      <div className="lkp-metahead">
        <span className="lkp-metahead-label">Content</span>
        <span className={`lkp-verdict ${diff.identical ? 'ok' : 'diff'}`}>{diff.identical ? 'Identical' : 'Different'}</span>
      </div>
      <div className="lkp-scroll">
        <table className="lkp-metatable">
          <thead>
            <tr>
              <th />
              <th>{a.name}</th>
              <th>{b.name}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Worker Group</td>
              <td>{locationLabel(a)}</td>
              <td>{locationLabel(b)}</td>
            </tr>
            <tr>
              <td>Size</td>
              <td>{fmtSize(lookupSize(a))}</td>
              <td>{fmtSize(lookupSize(b))}</td>
            </tr>
            <tr className={diff.aRows !== diff.bRows ? 'lkp-mrow-diff' : undefined}>
              <td>Rows</td>
              <td>{diff.aRows}</td>
              <td>{diff.bRows}</td>
            </tr>
            <tr className="lkp-colrow">
              <td>Columns</td>
              <td>
                <ColumnChips cols={diff.aCols} uniq={diff.onlyA} />
              </td>
              <td>
                <ColumnChips cols={diff.bCols} uniq={diff.onlyB} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="lkp-collegend">
        <span className="lkp-legrow">
          <span className="lkp-col shared">green</span>
          {allShared ? `all ${diff.aCols.length} columns are shared by both lookups` : 'columns are shared by both lookups'}
        </span>
        {!allShared && (
          <span className="lkp-legrow">
            <span className="lkp-col uniq">amber</span> columns exist in only one of the two lookups
          </span>
        )}
      </div>
    </div>
  );
}

// A lookup's columns as chips: shared columns green, columns present on only one side amber,
// so a schema difference reads at a glance without a separate one-line callout.
function ColumnChips({ cols, uniq }: { cols: string[]; uniq: string[] }) {
  return (
    <div className="lkp-cols-cell">
      {cols.map((c) => (
        <span key={c} className={`lkp-col ${uniq.includes(c) ? 'uniq' : 'shared'}`} title={uniq.includes(c) ? 'Only in this lookup' : 'Shared by both lookups'}>
          {c}
        </span>
      ))}
    </div>
  );
}

// ---- Across Worker Groups: cluster by size, then content hash ---------------------

export function LookupGroups({ instances }: { instances: KORecord[] }) {
  // Only same-size groups need content to tell apart; distinct sizes are known-different.
  const pending = useMemo(() => sizeCollisionRecords(instances), [instances]);
  const { loading, error, byKey } = useLookupContent(pending);
  const clusters = useMemo(() => clusterLookups(instances, byKey), [instances, byKey]);

  if (error) return <div className="xg-note lkp-err">Couldn't load lookup content: {error}</div>;
  if (clusters.present.length === 0) return <div className="xg-note">No lookup instances to compare.</div>;

  const identical = clusters.variants.length === 1 && !clusters.variants[0].pending;
  return (
    <>
      <div className="xg-sum">
        Across <b>{clusters.present.length}</b> Worker Groups
        <span className="xg-dot" aria-hidden="true">·</span>
        {identical ? <>identical everywhere</> : <><b>{clusters.variants.length}</b> distinct versions</>}
        {loading && (
          <>
            <span className="xg-dot" aria-hidden="true">·</span>
            <span className="lkp-checking">confirming same-size files…</span>
          </>
        )}
      </div>
      <div className="lkp-variants">
        {clusters.variants.map((v, i) => (
          <VariantCard key={i} variant={v} rank={i} instances={instances} loaded={byKey} />
        ))}
      </div>
    </>
  );
}

function VariantCard({ variant, rank, instances, loaded }: { variant: LookupVariant; rank: number; instances: KORecord[]; loaded: Map<string, LookupContent> }) {
  // The majority version opens by default — it's the one you almost always want to see;
  // the outlying variants stay collapsed so the page doesn't fetch every file up front.
  const [open, setOpen] = useState(rank === 0);
  const sample = instances.find((r) => variant.groups.includes(r.group));
  // Reuse content already fetched for clustering; otherwise fetch on drill-in only.
  const need = open && sample && !loaded.has(sample.key) ? [sample] : [];
  const { byKey: drill } = useLookupContent(need);
  const content = sample ? loaded.get(sample.key) ?? drill.get(sample.key) : undefined;

  return (
    <div className="lkp-variant">
      <button className={`lkp-vhead${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="lkp-vcaret" aria-hidden="true">
          <ChevronDown />
        </span>
        <span className="lkp-vtitle">{rank === 0 ? 'Majority version' : `Variant ${rank + 1}`}</span>
        <span className="lkp-vmeta">
          {variant.groups.length} {variant.groups.length === 1 ? 'group' : 'groups'} · {variant.percent}%
          {variant.size !== undefined && <> · {fmtSize(variant.size)}</>}
          {variant.rows !== undefined && <> · {variant.rows} rows</>}
          {variant.pending && <> · checking…</>}
        </span>
      </button>
      {open && (
        <>
          <div className="lkp-vgroups">{variant.groups.join(', ')}</div>
          {content ? <LookupPlainTable content={content} /> : <div className="lkp-vnote">Loading rows…</div>}
        </>
      )}
    </div>
  );
}

function LookupPlainTable({ content }: { content: LookupContent }) {
  const shown = content.rows.slice(0, ROW_CAP);
  return (
    <div className="lkp-scroll">
      <table className="lkp-table">
        <thead>
          <tr>
            {content.fields.map((f) => (
              <th key={f}>{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {content.rows.length > ROW_CAP && <div className="lkp-more-note">Showing the first {ROW_CAP} of {content.rows.length} rows.</div>}
    </div>
  );
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
