// A multi-select filter dropdown with a count "chiclet" badge, shared by the Browse
// filter bar and the Compare filters so both read and behave identically. Open/close
// is controlled by the parent (so a bar can keep one open at a time).
//
// Selection model (matches the Differences view's filters): every option starts checked —
// an unnarrowed filter constrains nothing — unchecking one drops just it, each row has an
// "only" action to isolate it, and unchecking the last option restores everything rather
// than blanking the view. `spec.selected` stays the *included* values, with `[]` meaning
// "no constraint" (i.e. all), so the URL state and the filter logic are unchanged.

import { ChevronDown } from './icons';

export interface Opt {
  value: string;
  label: string;
  count: number;
}

export interface FacetSpec {
  id: string;
  title: string;
  options: Opt[];
  selected: string[];
  apply: (values: string[]) => void;
}

export function FacetDropdown({ spec, open, onToggle }: { spec: FacetSpec; open: boolean; onToggle: () => void }) {
  const { title, options, selected, apply } = spec;
  const all = options.map((o) => o.value);
  // No constraint (or every option picked) reads as "all selected".
  const allSelected = selected.length === 0 || selected.length === all.length;
  const isChecked = (value: string) => allSelected || selected.includes(value);
  const narrowed = !allSelected;
  // Collapse "everything" back to the no-constraint form, so unchecking the last option
  // restores the full set instead of matching nothing.
  const norm = (next: string[]) => (next.length === 0 || next.length === all.length ? [] : next);
  const toggle = (value: string) => {
    const current = allSelected ? all : selected;
    apply(norm(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  return (
    <div className="fdrop">
      <button
        className={`fdrop-btn${narrowed ? ' fdrop-active' : ''}${open ? ' fdrop-open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        {title}
        {narrowed && (
          <span key={selected.length} className="fdrop-badge">
            {selected.length}
          </span>
        )}
        <span className="fdrop-caret" aria-hidden="true">
          <ChevronDown />
        </span>
      </button>
      {open && (
        <div className="fdrop-panel" role="group" aria-label={title}>
          <div className="fdrop-panel-head">
            <span>{narrowed ? `${selected.length} of ${all.length} selected` : `All ${all.length} selected`}</span>
            {narrowed && (
              <button className="fdrop-clear" onClick={() => apply([])}>
                Reset
              </button>
            )}
          </div>
          <div className="fdrop-list">
            {options.map((o) => {
              const checked = isChecked(o.value);
              // A real checkbox inside a <label> — natively keyboard- and screen-reader-
              // operable. The "only" button is a SIBLING of the label (outside it), so
              // clicking it isolates the option without also toggling the checkbox.
              return (
                <div className="fdrop-opt" key={o.value}>
                  <label className="fdrop-opt-main">
                    <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} />
                    <span className="fdrop-opt-label">{o.label}</span>
                    <span className="fdrop-opt-count">{o.count}</span>
                  </label>
                  <button type="button" className="fdrop-only" onClick={() => apply(norm([o.value]))}>
                    only
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

