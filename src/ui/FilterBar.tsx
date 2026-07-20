import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FINDING_LABELS,
  KO_TYPES,
  TYPE_LABEL_PLURAL as TYPE_LABELS,
  type Filters,
  type FindingCategory,
  type HealthFilter,
  type KORecord,
  type KOType,
} from '../data/types';
import type { Facets } from '../data/search';
import { FacetDropdown, type FacetSpec } from './FacetDropdown';

interface FilterBarProps {
  records: KORecord[];
  filters: Filters;
  facets: Facets;
  healthAvailable: boolean;
  ageAvailable: boolean;
  onChange: (filters: Filters) => void;
}

export function FilterBar({ records, filters, facets, healthAvailable, ageAvailable, onChange }: FilterBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // One dropdown open at a time; close on outside click or Escape.
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

  const counts = useMemo(() => tally(records), [records]);
  const specs: FacetSpec[] = [
    {
      id: 'type',
      title: 'Type',
      options: KO_TYPES.filter((t) => counts.type.get(t)).map((t) => ({ value: t, label: TYPE_LABELS[t], count: counts.type.get(t) ?? 0 })),
      selected: filters.types,
      apply: (v) => onChange({ ...filters, types: v as KOType[] }),
    },
    {
      id: 'group',
      title: 'Worker Group',
      options: facets.groups.map((g) => ({ value: g, label: g, count: counts.group.get(g) ?? 0 })),
      selected: filters.groups,
      apply: (v) => onChange({ ...filters, groups: v }),
    },
    {
      id: 'pack',
      title: 'Pack',
      options: facets.packs.map((p) => ({ value: p, label: p, count: counts.pack.get(p) ?? 0 })),
      selected: filters.packs,
      apply: (v) => onChange({ ...filters, packs: v }),
    },
    {
      id: 'flags',
      title: 'Flags',
      options: (Object.keys(FINDING_LABELS) as FindingCategory[])
        .filter((c) => counts.issue.get(c))
        .map((c) => ({ value: c, label: FINDING_LABELS[c], count: counts.issue.get(c) ?? 0 })),
      selected: filters.issues,
      apply: (v) => onChange({ ...filters, issues: v as FindingCategory[] }),
    },
    {
      id: 'state',
      title: 'State',
      options: [
        { value: 'enabled', label: 'Enabled', count: counts.enabled },
        { value: 'disabled', label: 'Disabled', count: counts.disabled },
      ],
      selected: filters.disabled,
      apply: (v) => onChange({ ...filters, disabled: v as Filters['disabled'] }),
    },
  ];
  if (healthAvailable) {
    specs.push({
      id: 'health',
      title: 'Health',
      options: [
        { value: 'healthy', label: 'Healthy', count: counts.health.healthy },
        { value: 'unhealthy', label: 'Unhealthy', count: counts.health.unhealthy },
      ],
      selected: filters.health,
      apply: (v) => onChange({ ...filters, health: v as HealthFilter[] }),
    });
  }
  if (ageAvailable) {
    specs.push({
      id: 'owner',
      title: 'Last modified by',
      options: facets.owners.map((o) => ({ value: o, label: o, count: counts.owner.get(o) ?? 0 })),
      selected: filters.owners,
      apply: (v) => onChange({ ...filters, owners: v }),
    });
  }

  return (
    <div className="filterbar" ref={barRef}>
      {specs
        // A single-option facet can't narrow anything (toggle/"only" collapse straight back
        // to "all"), so hiding it avoids an inert control — show a facet only when it offers a
        // real choice.
        .filter((s) => s.options.length > 1)
        .map((s) => (
          <FacetDropdown key={s.id} spec={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
        ))}
    </div>
  );
}

function tally(records: KORecord[]) {
  const type = new Map<string, number>();
  const group = new Map<string, number>();
  const pack = new Map<string, number>();
  const issue = new Map<string, number>();
  const owner = new Map<string, number>();
  const health = { healthy: 0, unhealthy: 0 };
  let enabled = 0;
  let disabled = 0;
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of records) {
    inc(type, r.type);
    inc(group, r.group);
    if (r.pack) inc(pack, r.pack);
    if (r.owner) inc(owner, r.owner);
    for (const i of r.issues ?? []) inc(issue, i);
    if (r.health === 'green') health.healthy += 1;
    else if (r.health === 'red' || r.health === 'yellow') health.unhealthy += 1;
    if (r.disabled) disabled += 1;
    else enabled += 1;
  }
  return { type, group, pack, issue, owner, health, enabled, disabled };
}
