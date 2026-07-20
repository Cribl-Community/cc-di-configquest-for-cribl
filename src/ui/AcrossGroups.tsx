// The "Across Worker Groups" view: pick one object (that exists in 2+ Worker Groups) and
// see its configuration as a settings × groups matrix — every group a column, every setting
// a row, and the values that depart from the majority lit. Reached from the nav or an
// object's detail drawer ("Compare across groups"); the picked object lives in the URL.
//
// Type and Worker Group filters scope which objects you can pick (Worker Group also scopes
// which groups the comparison covers), and are available before anything is picked. Settings
// narrows the matrix rows and only appears once there's an object to narrow. All three use
// the same FacetDropdown as Browse and Compare, so the mechanics match everywhere.

import { useEffect, useMemo, useRef, useState } from 'react';
import { crossGroupObjects, crossGroupDiff, crossGroupMatrix, groupInstances, type XGroupObject, type XGroupMatrix } from '../data/crossGroup';
import { KO_TYPES, TYPE_LABEL, TYPE_LABEL_PLURAL, type KORecord } from '../data/types';
import { csvRow } from '../data/csv';
import { matchesQuery } from '../data/search';
import { ChevronDown } from './icons';
import { plural } from './format';
import { FacetDropdown, type FacetSpec } from './FacetDropdown';
import { LookupGroups } from './LookupContent';

interface AcrossGroupsProps {
  /** A record key of one instance of the picked object, or null (no object yet). */
  xgroup: string | null;
  records: KORecord[];
  byKey: Map<string, KORecord>;
  onPick: (key: string | null) => void;
}

export function AcrossGroups({ xgroup, records, byKey, onPick }: AcrossGroupsProps) {
  const picked = xgroup ? byKey.get(xgroup) : undefined;

  // Selected values, with [] meaning "no constraint" — the same model the Browse and Compare
  // filters use. Type and Worker Group scope the picker (and Worker Group the comparison), so
  // they persist across picks; Settings belongs to the picked object, so it resets with it.
  const [types, setTypes] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [settings, setSettings] = useState<string[]>([]);
  useEffect(() => setSettings([]), [xgroup]);

  // One dropdown open at a time; close on outside click or Escape (mirrors the Browse bar).
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const allGroups = useMemo(() => [...new Set(records.map((r) => r.group))].sort(), [records]);
  const scoped = useMemo(() => (groups.length === 0 ? records : records.filter((r) => groups.includes(r.group))), [records, groups]);
  const universe = useMemo(() => (groups.length === 0 ? allGroups : allGroups.filter((g) => groups.includes(g))), [allGroups, groups]);
  // Comparable = spans 2+ of the in-scope groups; the Type filter then narrows the picker.
  const comparable = useMemo(() => crossGroupObjects(scoped), [scoped]);
  const objects = useMemo(() => (types.length === 0 ? comparable : comparable.filter((o) => types.includes(o.type))), [comparable, types]);

  const instances = useMemo(() => (picked ? groupInstances(picked, scoped) : []), [picked, scoped]);
  const result = useMemo(() => crossGroupDiff(instances, universe), [instances, universe]);
  const shown = result.settings.filter((s) => settings.length === 0 || settings.includes(s.path));
  const differingCount = result.settings.filter((s) => s.differs).length;
  // Lookups compare by their .csv rows (crossGroupDiff works on flattened settings, which
  // for a lookup is just file metadata), so they get a content-clustered view instead.
  const isLookup = picked?.type === 'lookup';

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of comparable) m.set(o.type, (m.get(o.type) ?? 0) + 1);
    return m;
  }, [comparable]);
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.group, (m.get(r.group) ?? 0) + 1);
    return m;
  }, [records]);

  const specs: FacetSpec[] = [
    {
      id: 'type',
      title: 'Type',
      options: KO_TYPES.filter((t) => typeCounts.get(t)).map((t) => ({ value: t, label: TYPE_LABEL_PLURAL[t], count: typeCounts.get(t) ?? 0 })),
      selected: types,
      apply: setTypes,
    },
    {
      id: 'group',
      title: 'Worker Group',
      options: allGroups.map((g) => ({ value: g, label: g, count: groupCounts.get(g) ?? 0 })),
      selected: groups,
      apply: setGroups,
    },
  ];
  // Settings only makes sense once there's an object whose settings we can list.
  if (picked && !isLookup && result.settings.length > 0) {
    specs.push({
      id: 'settings',
      title: 'Settings',
      options: result.settings.map((s) => ({ value: s.path, label: s.path, count: s.values.length })),
      selected: settings,
      apply: setSettings,
    });
  }

  const exportCsv = () => {
    if (!picked) return;
    const rows = [csvRow(['object', 'type', 'setting', 'value', 'groups', 'percent', 'worker_groups'])];
    for (const s of shown) {
      for (const v of s.values) {
        rows.push(csvRow([picked.name, picked.type, s.path, v.value ?? '(absent)', v.groups.length, v.percent, v.groups.join('|')]));
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${picked.name}-across-groups.csv`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="xg">
      <header className="xg-head" ref={barRef}>
        <h2 className="xg-title">Across Worker Groups</h2>
        <ItemPicker objects={objects} picked={picked} onPick={onPick} />
        {specs
          .filter((s) => s.options.length > 0)
          .map((s) => (
            <FacetDropdown key={s.id} spec={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}
        {picked && !isLookup && shown.length > 0 && (
          <button className="btn xg-export" onClick={exportCsv} title="Export these differences as CSV">
            Export CSV
          </button>
        )}
      </header>

      {!picked ? (
        <div className="xg-empty">
          <p className="xg-empty-t">Compare one object across your Worker Groups.</p>
          <p className="xg-empty-d">
            Pick an object above{objects.length === 0 ? '' : ` — ${objects.length} ${objects.length === 1 ? 'object spans' : 'objects span'} multiple groups`}. You'll
            see, setting by setting, exactly where its config differs and which groups hold each value.
          </p>
        </div>
      ) : (
        <>
          <div className="xg-sum">
            In <b>{result.present.length}</b> of <b>{result.present.length + result.absent.length}</b> Worker Groups
            {!isLookup && (
              <>
                <span className="xg-dot" aria-hidden="true">·</span>
                {differingCount === 0 ? (
                  <>identical across all <b>{result.present.length}</b></>
                ) : (
                  <>
                    <b>{differingCount}</b> of <b>{result.settings.length}</b> {result.settings.length === 1 ? 'setting differs' : 'settings differ'}
                  </>
                )}
              </>
            )}
            {result.absent.length > 0 && (
              <>
                <span className="xg-dot" aria-hidden="true">·</span> <b>{result.absent.length}</b> {plural(result.absent.length, "doesn't", "don't")} have it
              </>
            )}
          </div>

          {result.present.length < 2 ? (
            <div className="xg-note">This object exists in only one Worker Group{result.present[0] ? ` (${result.present[0]})` : ''} — nothing to compare.</div>
          ) : isLookup ? (
            <LookupGroups instances={instances} />
          ) : shown.length === 0 ? (
            <div className="xg-note">Every setting is excluded by the Settings filter.</div>
          ) : (
            <MatrixTable matrix={crossGroupMatrix({ present: result.present, absent: result.absent, settings: shown })} />
          )}
        </>
      )}
    </div>
  );
}

// The differences as a settings × groups grid: settings down, groups across, each cell a
// group's value. Cells that match the majority read muted; those that differ are lit, so a
// group's drift scans down its column. Each group header carries its delta count; the
// setting column and the header row stay pinned while the grid scrolls.
function MatrixTable({ matrix }: { matrix: XGroupMatrix }) {
  // Column widths live here rather than in CSS so the same numbers set the <colgroup> and
  // the table's floor — every group column identical, and the wrapper scrolls once the
  // groups outgrow the viewport instead of squeezing them.
  const SETTING_W = 300;
  const GROUP_W = 190;
  return (
    <div className="xg-mx-wrap">
      <div className="xg-mx-scroll">
        <table className="xg-mx" style={{ minWidth: SETTING_W + matrix.groups.length * GROUP_W }}>
          <colgroup>
            <col style={{ width: SETTING_W }} />
            {matrix.groups.map((g) => (
              <col key={g} style={{ width: GROUP_W }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="xg-mx-corner">Setting</th>
              {matrix.groups.map((g) => {
                const d = matrix.deltaByGroup.get(g) ?? 0;
                return (
                  <th key={g} className="xg-mx-gh" title={d ? `${g} differs from the majority on ${d} ${d === 1 ? 'setting' : 'settings'}` : `${g} matches the majority on every setting`}>
                    <span className="xg-mx-gname">{g}</span>
                    <span className={`xg-mx-gdelta${d ? ' has' : ''}`}>{d ? `${d} differ${d === 1 ? 's' : ''}` : 'baseline'}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.path}>
                <td className="xg-mx-setting" title={row.path}>
                  <span className="xg-mx-path">{row.path}</span>
                </td>
                {matrix.groups.map((g) => {
                  const cell = row.cells.get(g);
                  const absent = !cell || cell.value === null;
                  const cls = absent ? 'absent' : cell.majority ? 'maj' : 'diff';
                  return (
                    <td key={g} className={`xg-mx-cell ${cls}`} title={absent ? `${g}: not set` : `${g}: ${cell.value}`}>
                      <span className="xg-mx-val">{absent ? 'not set' : cell.value}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="xg-mx-legend">
        <span><span className="xg-sw maj" aria-hidden="true" /> matches the majority</span>
        <span><span className="xg-sw diff" aria-hidden="true" /> differs</span>
        <span><span className="xg-sw absent" aria-hidden="true" /> not set</span>
      </div>
    </div>
  );
}

// The object to compare — a searchable single-select combobox.
function ItemPicker({ objects, picked, onPick }: { objects: XGroupObject[]; picked?: KORecord; onPick: (key: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const opts = objects.filter((o) => matchesQuery(o.name, q) || matchesQuery(o.type, q));

  return (
    <div className="xg-facet xg-item" ref={ref}>
      <button className={`xg-fbtn${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)}>
        {picked ? (
          <>
            <span className="xg-tag">{TYPE_LABEL[picked.type]}</span>
            <span className="xg-oname">{picked.name}</span>
          </>
        ) : (
          <span className="xg-oname xg-placeholder">Choose an object…</span>
        )}
        <span className="xg-caret" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open && (
        <div className="xg-fpanel">
          <div className="xg-fsearch">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search objects…" aria-label="Search objects" />
          </div>
          <div className="xg-flist">
            {opts.map((o) => (
              <button
                type="button"
                key={o.key}
                className={`xg-opt2${picked?.key === o.key ? ' sel' : ''}`}
                onClick={() => {
                  onPick(o.key);
                  setOpen(false);
                }}
              >
                <span className="xg-tag">{TYPE_LABEL[o.type]}</span>
                <span className="xg-nm">{o.name}</span>
                <span className="xg-og">{o.groups} groups</span>
              </button>
            ))}
            {opts.length === 0 && <div className="xg-fnone">No objects span multiple groups.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Close an open dropdown on an outside mousedown or Escape.
function useClickOutside(ref: React.RefObject<HTMLElement | null>, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
