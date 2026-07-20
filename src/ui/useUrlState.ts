// Deep-linkable app state: the view, group scope, query, filters, and open asset
// round-trip through the URL query string so any screen is shareable/bookmarkable.
// The platform mirrors history.replaceState to the parent URL bar and forwards
// parent navigation back as popstate (see AGENTS.md).

import { useEffect, useRef, useState } from 'react';
import {
  KO_TYPES,
  emptyFilters,
  type DisabledState,
  type Filters,
  type FindingCategory,
  type HealthFilter,
  type KOType,
} from '../data/types';
import { SORT_COLS, type SortCol, type SortState } from './sort';

/** The table's default order — relevance, ascending. Kept out of the URL (so a default sort
 *  is an empty query) and out of the push/replace nav signature (so re-sorting replaces). */
export const DEFAULT_SORT: SortState = { col: 'relevance', dir: 'asc' };

export interface UrlState {
  q: string;
  filters: Filters;
  /** Table sort — column and direction. */
  sort: SortState;
  /** Record key of the open detail panel, or null. */
  asset: string | null;
  /** Compare overlay: null = closed; [] = open empty; [aKey] or [aKey, bKey]. */
  compare: string[] | null;
  /** Overview page is showing. It is the DEFAULT view — an empty URL means Overview — so it
   *  carries no marker of its own; every other page (and Browse) is explicit. */
  overview: boolean;
  /** Browse (the inventory table) is showing. Explicit (`browse=1`) so it round-trips on
   *  reload and Back, and an empty URL is unambiguously Overview rather than Browse. */
  browse: boolean;
  /** Settings page is showing. */
  settings: boolean;
  /** Help page is showing. */
  help: boolean;
  /** Commits page is showing. */
  commits: boolean;
  /** Focused commit hash on the Commits page, or null (log only). */
  commit: string | null;
  /** Across-Worker-Groups page is showing. */
  differences: boolean;
  /** Record key of the object being compared across groups, or null (picker only). */
  xgroup: string | null;
}

const VALID_TYPES = new Set<string>(KO_TYPES);
const VALID_DISABLED = new Set<string>(['disabled', 'enabled']);
const VALID_HEALTH = new Set<string>(['healthy', 'unhealthy']);
const VALID_ISSUES = new Set<string>([
  'orphaned-pipeline',
  'dangling-route',
  'unused-lookup',
  'disabled',
  'stale-object',
  'dead-end-source',
  'dead-end-destination',
  'unreachable-route',
]);
const VALID_SORT_COLS = new Set<string>(SORT_COLS);

export function emptyUrlState(): UrlState {
  return { q: '', filters: emptyFilters(), sort: DEFAULT_SORT, asset: null, compare: null, overview: false, browse: false, settings: false, help: false, commits: false, commit: null, differences: false, xgroup: null };
}

export function parseUrl(search: string): UrlState {
  const p = new URLSearchParams(search);
  const filters: Filters = {
    types: csv(p.get('types')).filter((t): t is KOType => VALID_TYPES.has(t)),
    groups: csv(p.get('groups')),
    packs: csv(p.get('packs')),
    disabled: csv(p.get('disabled')).filter((d): d is DisabledState => VALID_DISABLED.has(d)),
    owners: csv(p.get('owners')),
    minAgeDays: parseAge(p.get('age')),
    health: csv(p.get('health')).filter((h): h is HealthFilter => VALID_HEALTH.has(h)),
    issues: csv(p.get('issues')).filter((i): i is FindingCategory => VALID_ISSUES.has(i)),
  };
  const compareRaw = p.get('compare');
  const browse = p.get('browse') === '1';
  const settings = p.get('settings') === '1';
  const help = p.get('help') === '1';
  const commits = p.get('commits') === '1';
  const differences = p.get('differences') === '1';
  return {
    q: p.get('q') ?? '',
    filters,
    sort: parseSort(p.get('sort')),
    asset: p.get('asset') || null,
    // The overlay compares exactly two slots; ignore any extra keys in the URL.
    compare: compareRaw === null ? null : csv(compareRaw).slice(0, 2),
    // Overview is the default: it shows whenever no other page (or the Compare overlay) is
    // selected, so an empty URL means Overview — the same on first load, reload, and Back.
    overview: !browse && !settings && !help && !commits && !differences && compareRaw === null,
    browse,
    settings,
    help,
    commits,
    commit: p.get('commit') || null,
    differences,
    xgroup: p.get('xgroup') || null,
  };
}

export function encodeUrl(state: UrlState): string {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  const f = state.filters;
  if (f.types.length) p.set('types', enc(f.types));
  if (f.groups.length) p.set('groups', enc(f.groups));
  if (f.packs.length) p.set('packs', enc(f.packs));
  if (f.disabled.length) p.set('disabled', enc(f.disabled));
  if (f.owners.length) p.set('owners', enc(f.owners));
  if (f.minAgeDays !== null) p.set('age', String(f.minAgeDays));
  if (f.health.length) p.set('health', enc(f.health));
  if (f.issues.length) p.set('issues', enc(f.issues));
  if (state.sort.col !== DEFAULT_SORT.col || state.sort.dir !== DEFAULT_SORT.dir) p.set('sort', `${state.sort.col}.${state.sort.dir}`);
  if (state.asset) p.set('asset', state.asset);
  if (state.compare !== null) p.set('compare', enc(state.compare));
  // Overview carries no marker (it's the default — an empty URL). Browse is explicit.
  if (state.browse) p.set('browse', '1');
  if (state.settings) p.set('settings', '1');
  if (state.help) p.set('help', '1');
  if (state.commits) p.set('commits', '1');
  if (state.commit) p.set('commit', state.commit);
  if (state.differences) p.set('differences', '1');
  if (state.xgroup) p.set('xgroup', state.xgroup);
  return p.toString();
}

/** Parse a `col.dir` sort token, falling back to the default for an unknown column. */
function parseSort(raw: string | null): SortState {
  if (raw) {
    const [col, dir] = raw.split('.');
    if (VALID_SORT_COLS.has(col)) return { col: col as SortCol, dir: dir === 'desc' ? 'desc' : 'asc' };
  }
  return DEFAULT_SORT;
}

export function useUrlState(): [UrlState, (next: UrlState) => void] {
  const [state, setState] = useState<UrlState>(() => {
    if (typeof window === 'undefined') return emptyUrlState();
    // parseUrl defaults an empty search to Overview, so first load, reload, and popstate all
    // agree — no separate cold-start special-case (which desynced from parseUrl).
    return parseUrl(window.location.search);
  });

  // Write to the URL (debounced) after the initial mount. A change to the *view* (page or
  // open asset) is a distinct destination, so it pushes a history entry — that makes the
  // browser/mouse/keyboard Back button return to the previous view (e.g. Overview -> a
  // Browse -> Back -> Overview). Search text, filters, and sort only refine the current view,
  // so they replace instead of stacking an entry per change.
  const first = useRef(true);
  const lastNav = useRef('');
  useEffect(() => {
    // View signature — a change here PUSHES a history entry; anything else REPLACES. Search
    // text, filters, and sort refine the current view (not a new destination), so they're
    // held at their defaults here to keep them out of the signature (replace, like search).
    const nav = encodeUrl({ ...state, q: '', filters: emptyFilters(), sort: DEFAULT_SORT });
    if (first.current) {
      first.current = false;
      lastNav.current = nav;
      return;
    }
    const id = setTimeout(() => {
      const qs = encodeUrl(state);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
      if (nav !== lastNav.current) {
        window.history.pushState(window.history.state, '', url);
        lastNav.current = nav;
      } else {
        window.history.replaceState(window.history.state, '', url);
      }
    }, 150);
    return () => clearTimeout(id);
  }, [state]);

  // React to parent navigation.
  useEffect(() => {
    const onPop = () => setState(parseUrl(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return [state, setState];
}

// Comma joins multi-value params (per the `?types=a,b` format); each value is
// percent-encoded so a value containing a comma round-trips intact.
function enc(values: string[]): string {
  return values.map(encodeURIComponent).join(',');
}

function csv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(safeDecode);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseAge(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
