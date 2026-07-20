// Core domain types shared across the pure data layer and the UI.

export type KOType =
  | 'pipeline'
  | 'route'
  | 'source'
  | 'destination'
  | 'lookup'
  | 'pack'
  // Library objects (/lib/<type>): flat id-keyed collections, group + pack scope.
  | 'event-breaker'
  | 'regex'
  | 'grok'
  | 'parser'
  | 'schema'
  | 'parquet-schema'
  | 'sds-rule'
  | 'sds-ruleset'
  | 'protobuf'
  | 'appscope'
  | 'variable'
  | 'db-connection';

/** Types collected from a flat id-keyed list by `collectSystem` (source/destination/
 *  lookup + every library object). Pipelines, routes, and packs have bespoke collectors. */
export type SystemKOType = Exclude<KOType, 'pipeline' | 'route' | 'pack'>;

/** Fixed display order for grouped results and type chips. */
export const KO_TYPES: readonly KOType[] = [
  'pipeline',
  'route',
  'source',
  'destination',
  'lookup',
  'pack',
  'event-breaker',
  'regex',
  'grok',
  'parser',
  'schema',
  'parquet-schema',
  'sds-rule',
  'sds-ruleset',
  'protobuf',
  'appscope',
  'variable',
  'db-connection',
];

/** A single indexed knowledge object. */
export interface KORecord {
  /** Stable key: `${group}/${pack ?? '-'}/${type}/${id}`. */
  key: string;
  type: KOType;
  group: string;
  pack?: string;
  id: string;
  /** Display name (falls back to id). */
  name: string;
  description?: string;
  disabled?: boolean;
  /** Full original object, for the detail panel. */
  raw: unknown;
  /** Flattened leaves: "conf.functions[3].conf.expression: host.startsWith('web-')". */
  searchText: string[];
  // Phase 3 — populated from the git age map when versioning is available.
  lastTouched?: string; // ISO date
  // True when lastTouched is a fallback "created / first seen" date (its group's creation or
  // pack's install) rather than an actual edit — the object had no attributable change. The
  // UI shows it as "Created", and it is excluded from the recent-changes feed and stale checks.
  lastTouchedApprox?: boolean;
  // Who last CHANGED this object (the newest commit's author) — not who owns it. Cribl has
  // no ownership concept for config objects, so editing a Cribl-shipped object makes you the
  // last author, not its owner; every label reads "Last modified by" for that reason. The
  // field keeps the `owner` name because it's baked into persisted snapshots and the
  // shareable `?owners=` URL state — renaming it would invalidate both.
  owner?: string;
  ownerEmail?: string;
  // Operational health from system/status/*, when reachable.
  health?: HealthState;
  // Finding categories affecting this record (for row badges + issue filtering).
  issues?: FindingCategory[];
}

/** The single source of truth for type display labels (singular, Title Case). Used for
 *  tags, the inventory, and active-filter chips so one type always reads the same way.
 *  Kept short: these render as compact chips in the Browse table's Type column, which must
 *  fit without the table scrolling sideways. The plural labels below carry the fuller
 *  wording for lists and prose, where there's room. */
export const TYPE_LABEL: Record<KOType, string> = {
  pipeline: 'Pipeline',
  route: 'Route',
  source: 'Source',
  destination: 'Destination',
  lookup: 'Lookup',
  pack: 'Pack',
  'event-breaker': 'Event Breaker',
  regex: 'Regex',
  grok: 'Grok Pattern',
  parser: 'Parser',
  schema: 'Schema',
  'parquet-schema': 'Parquet Schema',
  'sds-rule': 'Data-scan Rule',
  'sds-ruleset': 'Data-scan Ruleset',
  protobuf: 'Protobuf',
  appscope: 'AppScope',
  variable: 'Variable',
  'db-connection': 'DB Connection',
};

/** Plural labels (for facet/filter headings). */
export const TYPE_LABEL_PLURAL: Record<KOType, string> = {
  pipeline: 'Pipelines',
  route: 'Routes',
  source: 'Sources',
  destination: 'Destinations',
  lookup: 'Lookups',
  pack: 'Packs',
  'event-breaker': 'Event Breakers',
  regex: 'Regexes',
  grok: 'Grok Patterns',
  parser: 'Parsers',
  schema: 'Schemas',
  'parquet-schema': 'Parquet Schemas',
  'sds-rule': 'Data-scan Rules',
  'sds-ruleset': 'Data-scan Rulesets',
  protobuf: 'Protobuf Libraries',
  appscope: 'AppScope Configs',
  variable: 'Global Variables',
  'db-connection': 'Database Connections',
};

const BASE_TYPES = ['pipeline', 'route', 'source', 'destination', 'lookup', 'pack'] as const;

/** A library object (`/lib/<type>`): flat id-keyed, inert in the reference graph, and
 *  group-level (not individually addressable) in the Leader UI. */
export function isLibraryType(t: KOType): boolean {
  return !(BASE_TYPES as readonly string[]).includes(t);
}

/** Human-readable location for a record: "group" or "group / pack". */
export function locationLabel(record: { group: string; pack?: string }): string {
  return record.pack ? `${record.group} / ${record.pack}` : record.group;
}

/** Active filter selections. Empty arrays / null mean "no constraint". */
export interface Filters {
  types: KOType[];
  groups: string[];
  packs: string[];
  disabled: DisabledState[];
  // Phase 3
  owners: string[];
  minAgeDays: number | null;
  // Operational oversight
  health: HealthFilter[];
  issues: FindingCategory[];
}

export type DisabledState = 'disabled' | 'enabled';
export type HealthFilter = 'healthy' | 'unhealthy';

export function emptyFilters(): Filters {
  return { types: [], groups: [], packs: [], disabled: [], owners: [], minAgeDays: null, health: [], issues: [] };
}

export function filtersActive(f: Filters): boolean {
  return (
    f.types.length > 0 ||
    f.groups.length > 0 ||
    f.packs.length > 0 ||
    f.disabled.length > 0 ||
    f.owners.length > 0 ||
    f.minAgeDays !== null ||
    f.health.length > 0 ||
    f.issues.length > 0
  );
}

// --- Fetch reporting -------------------------------------------------------

export interface SkippedGroup {
  group: string;
  /** HTTP status of the denial, or undefined for a network error. */
  status?: number;
}

/** A scope (group, or group+pack) that was indexed but where some endpoints failed
 *  (denied or 5xx/network — not a 404, which just means "none"). The scope's data is
 *  therefore incomplete, so structural hygiene findings for it are suppressed rather than
 *  fabricated from the hole. */
export interface PartialFailure {
  group: string;
  pack?: string;
  /** The endpoint names that failed, e.g. 'pipelines', 'system/inputs'. */
  endpoints: string[];
  status?: number;
}

export interface FetchReport {
  indexedGroups: string[];
  skippedGroups: SkippedGroup[];
  /** Scopes indexed with a partial data hole (some endpoints failed). */
  partialFailures: PartialFailure[];
  builtAt: string; // ISO date
  /** True when the git commit walk was capped (Phase 3). */
  ageTruncated?: boolean;
}

/** The full in-memory index; also the shape persisted to KV `index:snapshot`. */
export interface OrgIndex {
  builtAt: string; // ISO date
  records: KORecord[];
  report: FetchReport;
}

// --- Findings (Phase 2) ----------------------------------------------------

export type FindingCategory =
  | 'orphaned-pipeline'
  | 'dangling-route'
  | 'unused-lookup'
  | 'disabled'
  | 'stale-object'
  // Coverage (operational reachability)
  | 'dead-end-source'
  | 'dead-end-destination'
  | 'unreachable-route';

/** Human-readable label per finding category. */
export const FINDING_LABELS: Record<FindingCategory, string> = {
  'orphaned-pipeline': 'unreferenced pipelines',
  'dangling-route': 'unresolved routes',
  'unused-lookup': 'unused lookups',
  disabled: 'disabled',
  'stale-object': 'aging objects',
  'dead-end-source': 'unrouted sources',
  'dead-end-destination': 'unreached destinations',
  'unreachable-route': 'unreachable routes',
};

export interface Finding {
  category: FindingCategory;
  /** Key of the affected KORecord. */
  recordKey: string;
  title: string; // display name
  location: string; // "group" or "group / pack"
  detail?: string; // extra context, e.g. "missing output: foo"
}

/** Build a Finding for a record (shared by crossref.ts and coverage.ts). */
export function makeFinding(category: FindingCategory, r: KORecord, detail: string): Finding {
  return { category, recordKey: r.key, title: r.name, location: locationLabel(r), detail };
}

export interface FindingsReport {
  orphanedPipelines: Finding[];
  danglingRoutes: Finding[];
  unusedLookups: Finding[];
  disabled: Finding[];
  staleObjects: Finding[]; // Phase 3; empty when no age data
}

/** Operational reachability findings (computed by coverage.ts from the graph). */
export interface CoverageReport {
  deadEndSources: Finding[];
  deadEndDestinations: Finding[];
  unreachableRoutes: Finding[];
}

// --- Environment graph -----------------------------------------------------

export type EdgeKind =
  | 'source-pipeline' // source pre-processing pipeline
  | 'source-route' // source feeds the routing table
  | 'source-output' // source direct output (Destination)
  | 'quickconnect' // source QuickConnect to a pipeline/Destination
  | 'route-pipeline' // route uses a pipeline
  | 'route-pack' // route sends traffic into an installed Pack (`pipeline: pack:<id>`)
  | 'route-output' // route sends to a Destination
  | 'chain' // pipeline chains to another pipeline
  | 'lookup' // pipeline Lookup function references a lookup file
  | 'dest-pipeline'; // destination post-processing pipeline

export interface GraphEdge {
  from: string; // KORecord.key
  to: string; // KORecord.key (both endpoints exist)
  kind: EdgeKind;
}

/** A reference that did not resolve to an existing record (drives dangling detection). */
export interface DanglingRef {
  from: string; // key of the record making the reference
  kind: EdgeKind;
  missing: string; // the referenced id that did not resolve
  targetType: KOType;
}

export interface Graph {
  edges: GraphEdge[];
  out: Map<string, GraphEdge[]>; // adjacency by `from`
  in: Map<string, GraphEdge[]>; // adjacency by `to`
  danglingRefs: DanglingRef[];
}

// --- Health ----------------------------------------------------------------

export type HealthState = 'green' | 'yellow' | 'red';

/** Health keyed by KORecord.key. */
export type HealthMap = Record<string, HealthState>;

// --- Posture ---------------------------------------------------------------

export interface PostureLine {
  category: FindingCategory;
  count: number;
  weight: number;
  points: number; // count * weight
}

export interface PostureResult {
  percent: number; // 0-100 (100 = clean)
  grade: string; // A..F
  penalty: number; // total weighted penalty points
  breakdown: PostureLine[];
}

// --- Age map (Phase 3) -----------------------------------------------------

export interface AgeInfo {
  lastTouched: string; // ISO date
  author: string;
  email: string;
  // True when this is a fallback "created / first seen" date — the earliest commit that
  // touched the object's file (its group's creation or its pack's install) — used because
  // the object itself had no attributable edit (e.g. its change sat in a diff the Leader
  // returned empty). A known-since date, not a specific edit, and shown as such.
  approx?: boolean;
}

/** Age info keyed by KORecord.key. */
export type AgeMap = Record<string, AgeInfo>;

// --- Errors ----------------------------------------------------------------

export type ApiErrorKind = 'http' | 'network' | 'parse' | 'abort';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}
