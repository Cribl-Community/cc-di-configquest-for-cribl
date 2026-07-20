import { useEffect, useMemo, useRef, useState } from 'react';
import { diffSettings, diffStats } from '../data/diff';
import { KO_TYPES, TYPE_LABEL, TYPE_LABEL_PLURAL as TYPE_LABELS, locationLabel, type KORecord, type KOType } from '../data/types';
import { DiffView } from './DiffView';
import { FacetDropdown, type FacetSpec } from './FacetDropdown';
import { LookupCompare } from './LookupContent';
import { matchesQuery } from '../data/search';

interface CompareProps {
  compare: string[]; // [aKey?] or [aKey, bKey]
  byKey: Map<string, KORecord>;
  records: KORecord[];
  onChange: (keys: string[]) => void;
}

export function Compare({ compare, byKey, records, onChange }: CompareProps) {
  const a = compare[0] ? byKey.get(compare[0]) : undefined;
  const b = compare[1] ? byKey.get(compare[1]) : undefined;
  const [editingA, setEditingA] = useState(false);

  // Multi-select filters (same behaviour as Browse) narrow what the pickers offer.
  // Type is load-bearing: both slots must share a type, so changing the type selection
  // invalidates the current pair and clears both.
  const [filterTypes, setFilterTypes] = useState<KOType[]>([]);
  const [filterGroups, setFilterGroups] = useState<string[]>([]);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openFilter === null) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setOpenFilter(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFilter(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openFilter]);

  const counts = useMemo(() => {
    const type = new Map<string, number>();
    const group = new Map<string, number>();
    for (const r of records) {
      type.set(r.type, (type.get(r.type) ?? 0) + 1);
      group.set(r.group, (group.get(r.group) ?? 0) + 1);
    }
    return { type, group };
  }, [records]);
  const groups = useMemo(() => [...new Set(records.map((r) => r.group))].sort(), [records]);
  const changeTypes = (v: string[]) => {
    setFilterTypes(v as KOType[]);
    onChange([]); // a new type constraint invalidates the current pair
  };
  const filterSpecs: FacetSpec[] = [
    {
      id: 'type',
      title: 'Type',
      options: KO_TYPES.filter((t) => counts.type.get(t)).map((t) => ({ value: t, label: TYPE_LABELS[t], count: counts.type.get(t) ?? 0 })),
      selected: filterTypes,
      apply: changeTypes,
    },
    {
      id: 'group',
      title: 'Worker Group',
      options: groups.map((g) => ({ value: g, label: g, count: counts.group.get(g) ?? 0 })),
      selected: filterGroups,
      apply: (v) => setFilterGroups(v),
    },
  ];

  const rows = useMemo(() => (a && b ? diffSettings(a, b) : []), [a, b]);
  const [changesOnly, setChangesOnly] = useState(false);
  const shown = changesOnly ? rows.filter((r) => r.kind !== 'context') : rows;
  const stats = diffStats(rows);

  const pickA = (key: string) => {
    const rec = byKey.get(key);
    // A is the anchor and can be any type; picking a type that no longer matches B drops B.
    onChange(b && rec && rec.type === b.type ? [key, b.key] : [key]);
    setEditingA(false);
  };
  const pickB = (key: string) => onChange([compare[0], key]);

  return (
    <div className="compare" aria-label="Compare configurations">
      <header className="compare-head">
        <h2 className="compare-title">Compare</h2>
        {(a || b) && (
          <div className="compare-head-actions">
            <button className="cmp-reset" onClick={() => onChange([])}>
              Reset
            </button>
          </div>
        )}
      </header>

        <div className="compare-filters" ref={filterRef}>
          {filterSpecs
            .filter((s) => s.options.length > 0)
            .map((s) => (
              <FacetDropdown key={s.id} spec={s} open={openFilter === s.id} onToggle={() => setOpenFilter(openFilter === s.id ? null : s.id)} />
            ))}
        </div>

        {(filterTypes.length > 0 || filterGroups.length > 0) && (
          <div className="compare-chips">
            {filterTypes.map((t) => (
              <span className="chip" key={`t:${t}`}>
                Type: {TYPE_LABELS[t]}
                <button onClick={() => changeTypes(filterTypes.filter((v) => v !== t))} aria-label={`Remove type ${TYPE_LABELS[t]}`} title="Remove">
                  ×
                </button>
              </span>
            ))}
            {filterGroups.map((g) => (
              <span className="chip" key={`g:${g}`}>
                Worker Group: {g}
                <button onClick={() => setFilterGroups(filterGroups.filter((v) => v !== g))} aria-label={`Remove Worker Group ${g}`} title="Remove">
                  ×
                </button>
              </span>
            ))}
            <button
              className="chip-clear"
              onClick={() => {
                changeTypes([]);
                setFilterGroups([]);
              }}
            >
              Clear all
            </button>
          </div>
        )}

        <div className="compare-slots">
          <div className="compare-slot">
            {a && !editingA ? (
              <SlotChip record={a} onChange={() => setEditingA(true)} />
            ) : (
              <Picker
                placeholder={a ? 'Choose any object…' : 'Choose the first object…'}
                types={filterTypes}
                groups={filterGroups}
                exclude={b?.key}
                records={records}
                onPick={pickA}
                autoFocus={editingA}
              />
            )}
          </div>

          <button className="compare-swap" disabled={!a || !b} onClick={() => a && b && onChange([b.key, a.key])} title="Swap sides" aria-label="Swap the two objects">
            <span aria-hidden="true">⇄</span>
          </button>

          <div className="compare-slot">
            {b ? (
              <SlotChip record={b} onChange={() => onChange(a ? [a.key] : [])} />
            ) : (
              <Picker
                placeholder={a ? `Choose a ${TYPE_LABEL[a.type].toLowerCase()} to compare…` : 'Choose the first object first'}
                types={a ? [a.type] : filterTypes}
                groups={filterGroups}
                exclude={a?.key}
                records={records}
                onPick={pickB}
                disabled={!a}
                autoFocus={!!a}
              />
            )}
          </div>
        </div>

        <div className="compare-body">
          {a && b ? (
            a.type === 'lookup' ? (
              // Lookups compare by their .csv rows, not their file metadata.
              <LookupCompare a={a} b={b} />
            ) : (
              <>
                <div className="compare-stats">
                  <span>
                    <strong>{stats.changed}</strong> changed
                  </span>
                  <span>
                    <strong>{stats.onlyA}</strong> only in {a.name}
                  </span>
                  <span>
                    <strong>{stats.onlyB}</strong> only in {b.name}
                  </span>
                  <label className="compare-toggle">
                    <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />
                    changes only
                  </label>
                </div>
                <DiffView rows={shown} mode="split" leftLabel={`${a.name} · ${locationLabel(a)}`} rightLabel={`${b.name} · ${locationLabel(b)}`} />
              </>
            )
          ) : (
            <div className="cmp-note">Pick two objects of the same type to see a per-setting diff.</div>
          )}
        </div>
    </div>
  );
}

// The selected object; clicking anywhere on it reopens the picker to change it.
function SlotChip({ record, onChange }: { record: KORecord; onChange: () => void }) {
  return (
    <button className="cmp-chip" onClick={onChange} title="Change selection">
      <span className="kind">{TYPE_LABEL[record.type]}</span>
      <span className="cmp-chip-name">{record.name}</span>
      <span className="cmp-chip-loc">{locationLabel(record)}</span>
      <span className="cmp-change">change</span>
    </button>
  );
}

function Picker({
  placeholder,
  types,
  groups,
  exclude,
  records,
  onPick,
  disabled,
  autoFocus,
}: {
  placeholder: string;
  types?: KOType[];
  groups?: string[];
  exclude?: string;
  records: KORecord[];
  onPick: (key: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // When shown to (re)pick a slot, focus it so the list opens without an extra click.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const opts = records
    .filter(
      (r) =>
        r.key !== exclude &&
        (!types?.length || types.includes(r.type)) &&
        (!groups?.length || groups.includes(r.group)) &&
        (matchesQuery(r.name, q) || matchesQuery(r.id, q)),
    )
    .slice(0, 60);

  return (
    <div className="cmp-picker">
      <input
        ref={inputRef}
        className="cmp-picker-input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={q}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {!disabled && focused && (
        <div className="cmp-picker-list">
          {opts.map((r) => (
            <button className="cmp-opt" key={r.key} onClick={() => onPick(r.key)}>
              <span className="kind">{TYPE_LABEL[r.type]}</span>
              <span className="cmp-opt-name">{r.name}</span>
              <span className="cmp-opt-loc">{locationLabel(r)}</span>
            </button>
          ))}
          {opts.length === 0 && <div className="cmp-note">No matching objects.</div>}
        </div>
      )}
    </div>
  );
}
