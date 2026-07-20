// Case-insensitive substring search with ranking and match spans. Substring is
// deliberately sufficient for config search — no fuzzy library (see the prompt).

import { KO_TYPES, type Filters, type KORecord, type KOType } from './types';

export interface MatchSpan {
  start: number;
  end: number;
}

export interface MatchLine {
  text: string; // the full "jsonPath: value" line
  spans: MatchSpan[];
}

export interface SearchResult {
  record: KORecord;
  rank: number; // lower is better
  nameSpans: MatchSpan[]; // spans within record.name for the row title
  matchLines: MatchLine[]; // searchText lines that matched (UI caps to 3)
}

export interface Facets {
  groups: string[];
  packs: string[];
  owners: string[];
}

/** Filter, match, and rank records for a query. Empty query returns all
 *  filtered records (no highlights), sorted by name. */
export function search(records: KORecord[], query: string, filters: Filters): SearchResult[] {
  const filtered = records.filter((r) => matchesFilters(r, filters));
  const q = query.trim().toLowerCase();

  if (!q) {
    return filtered
      .map((record) => ({ record, rank: 0, nameSpans: [], matchLines: [] }))
      .sort((a, b) => a.record.name.localeCompare(b.record.name));
  }

  const results: SearchResult[] = [];
  for (const record of filtered) {
    const scored = scoreRecord(record, q);
    if (scored) results.push(scored);
  }
  results.sort((a, b) => a.rank - b.rank || a.record.name.localeCompare(b.record.name));
  return results;
}

function scoreRecord(record: KORecord, q: string): SearchResult | null {
  const nameLower = record.name.toLowerCase();
  const idLower = record.id.toLowerCase();
  const descLower = (record.description ?? '').toLowerCase();

  const exact = nameLower === q || idLower === q;
  const nameContains = wildContains(nameLower, q) || wildContains(idLower, q);
  const descContains = wildContains(descLower, q);

  const nameSpans = findSpans(record.name, q);
  const matchLines: MatchLine[] = [];
  for (const line of record.searchText) {
    const spans = findSpans(line, q);
    if (spans.length) matchLines.push({ text: line, spans });
  }

  if (!exact && !nameContains && !descContains && matchLines.length === 0) return null;

  let rank = 3; // searchText only
  if (exact) rank = 0;
  else if (nameContains) rank = 1;
  else if (descContains) rank = 2;

  return { record, rank, nameSpans, matchLines };
}

function matchesFilters(r: KORecord, f: Filters): boolean {
  if (f.types.length && !f.types.includes(r.type)) return false;
  if (f.groups.length && !f.groups.includes(r.group)) return false;
  if (f.packs.length && !(r.pack !== undefined && f.packs.includes(r.pack))) return false;
  if (f.disabled.length) {
    const state = r.disabled ? 'disabled' : 'enabled';
    if (!f.disabled.includes(state)) return false;
  }
  if (f.owners.length && !(r.owner !== undefined && f.owners.includes(r.owner))) return false;
  if (f.minAgeDays !== null) {
    const age = r.lastTouched ? daysSince(r.lastTouched) : null;
    if (age === null || age < f.minAgeDays) return false;
  }
  if (f.health.length) {
    const state = healthFilter(r.health);
    if (state === undefined || !f.health.includes(state)) return false;
  }
  if (f.issues.length && !r.issues?.some((i) => f.issues.includes(i))) return false;
  return true;
}

function healthFilter(health: KORecord['health']): 'healthy' | 'unhealthy' | undefined {
  if (health === 'green') return 'healthy';
  if (health === 'red' || health === 'yellow') return 'unhealthy';
  return undefined;
}

/**
 * All occurrences of `needleLower` in `haystack`, as offsets into `haystack`.
 * Both sides are lowercased for case-insensitivity; offsets stay aligned for
 * the ASCII-dominant config data we index (a locale-changing char such as ß
 * could shift lengths, which is acceptable here).
 */
export function findSpans(haystack: string, needleLower: string): MatchSpan[] {
  if (!needleLower) return [];
  const lower = haystack.toLowerCase();
  if (!needleLower.includes('*')) {
    const spans: MatchSpan[] = [];
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(needleLower, from);
      if (idx === -1) break;
      spans.push({ start: idx, end: idx + needleLower.length });
      from = idx + needleLower.length;
    }
    return spans;
  }
  // Wildcard query: highlight each literal segment's first in-order occurrence.
  const spans: MatchSpan[] = [];
  let from = 0;
  for (const part of needleLower.split('*')) {
    if (part === '') continue;
    const idx = lower.indexOf(part, from);
    if (idx === -1) return [];
    spans.push({ start: idx, end: idx + part.length });
    from = idx + part.length;
  }
  return spans;
}

/** Case-insensitive match of a raw query against text. A `*` matches any run of
 *  characters; with no `*` it's a plain substring match — so `web` and `web*` both
 *  match "web_logs", and `web*log` matches "web_parse_log". Shared by every free-text
 *  filter input so wildcard behavior is uniform across the app. */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || wildContains(text.toLowerCase(), q);
}

// Both args already lowercased. A `*` matches any run of chars; the literal segments
// between wildcards must appear in order.
function wildContains(hay: string, needle: string): boolean {
  if (!needle.includes('*')) return hay.includes(needle);
  let from = 0;
  for (const part of needle.split('*')) {
    if (part === '') continue;
    const idx = hay.indexOf(part, from);
    if (idx < 0) return false;
    from = idx + part.length;
  }
  return true;
}

/** Unique, sorted filter option values derived from the index. */
export function facetValues(records: KORecord[]): Facets {
  const groups = new Set<string>();
  const packs = new Set<string>();
  const owners = new Set<string>();
  for (const r of records) {
    groups.add(r.group);
    if (r.pack !== undefined) packs.add(r.pack);
    if (r.owner !== undefined) owners.add(r.owner);
  }
  return {
    groups: [...groups].sort(),
    packs: [...packs].sort(),
    owners: [...owners].sort(),
  };
}

export interface ResultGroup {
  type: KOType;
  items: SearchResult[];
}

/** Group results by KOType in the fixed display order (for sticky headers). */
export function orderedGroups(results: SearchResult[]): ResultGroup[] {
  const map = new Map<KOType, SearchResult[]>();
  for (const result of results) {
    const list = map.get(result.record.type);
    if (list) list.push(result);
    else map.set(result.record.type, [result]);
  }
  const out: ResultGroup[] = [];
  for (const type of KO_TYPES) {
    const items = map.get(type);
    if (items && items.length) out.push({ type, items });
  }
  return out;
}

function daysSince(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}
