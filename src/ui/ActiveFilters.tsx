// The set of active filters (and the search query) as individually-removable chips,
// so a user can drop one constraint at a time instead of clearing everything at once.

import { FINDING_LABELS, TYPE_LABEL as TYPE_LABELS, type Filters } from '../data/types';
import { cap } from './format';

interface Chip {
  id: string;
  label: string;
  remove: () => void;
}

interface ActiveFiltersProps {
  query: string;
  filters: Filters;
  onQuery: (q: string) => void;
  onFilters: (filters: Filters) => void;
  onClearAll: () => void;
}

export function ActiveFilters({ query, filters, onQuery, onFilters, onClearAll }: ActiveFiltersProps) {
  const chips: Chip[] = [];

  if (query.trim()) {
    chips.push({ id: 'q', label: `“${query.trim()}”`, remove: () => onQuery('') });
  }
  for (const t of filters.types) {
    chips.push({ id: `type:${t}`, label: `Type: ${TYPE_LABELS[t]}`, remove: () => onFilters({ ...filters, types: filters.types.filter((v) => v !== t) }) });
  }
  for (const g of filters.groups) {
    chips.push({ id: `group:${g}`, label: `Worker Group: ${g}`, remove: () => onFilters({ ...filters, groups: filters.groups.filter((v) => v !== g) }) });
  }
  for (const p of filters.packs) {
    chips.push({ id: `pack:${p}`, label: `Pack: ${p}`, remove: () => onFilters({ ...filters, packs: filters.packs.filter((v) => v !== p) }) });
  }
  for (const d of filters.disabled) {
    chips.push({ id: `state:${d}`, label: `State: ${cap(d)}`, remove: () => onFilters({ ...filters, disabled: filters.disabled.filter((v) => v !== d) }) });
  }
  for (const h of filters.health) {
    chips.push({ id: `health:${h}`, label: `Health: ${cap(h)}`, remove: () => onFilters({ ...filters, health: filters.health.filter((v) => v !== h) }) });
  }
  for (const i of filters.issues) {
    chips.push({ id: `flag:${i}`, label: `Flag: ${FINDING_LABELS[i]}`, remove: () => onFilters({ ...filters, issues: filters.issues.filter((v) => v !== i) }) });
  }
  for (const o of filters.owners) {
    chips.push({ id: `owner:${o}`, label: `Last modified by: ${o}`, remove: () => onFilters({ ...filters, owners: filters.owners.filter((v) => v !== o) }) });
  }
  if (filters.minAgeDays !== null) {
    chips.push({ id: 'age', label: `Older than ${filters.minAgeDays}d`, remove: () => onFilters({ ...filters, minAgeDays: null }) });
  }

  if (chips.length === 0) return null;

  return (
    <div className="active-filters">
      {chips.map((c) => (
        <span className="chip" key={c.id}>
          {c.label}
          <button onClick={c.remove} aria-label={`Remove filter: ${c.label}`} title="Remove">
            ×
          </button>
        </span>
      ))}
      <button className="chip-clear" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
