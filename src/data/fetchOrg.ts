// Enumerate Worker Groups, then fan out per-group (and per-pack) fetches with
// Promise.allSettled so one denied group degrades to partial results instead of a blank
// screen. Fetching runs in two phases through a bounded pool so a large org (many groups,
// each with packs) can't nest into a thousand-request burst against a latency-bound Leader:
// phase 1 fetches every group; phase 2 fetches every (group, pack) across all groups in ONE
// pool. Peak in-flight stays ≈ FETCH_CONCURRENCY scopes, each itself an allSettled fan-out.

import { apiGet, type ApiOptions } from './apiClient';
import { ApiError } from './types';
import type { FetchReport, PartialFailure, SkippedGroup } from './types';
import { asRecord, itemsOf, str } from './raw';
import { mapPool } from './async';

// Stream only. Edge is a one-line future change: add 'edge' here.
const PRODUCTS = ['stream'] as const;

// Library objects (/lib/<type>): id-keyed collections present at group and pack scope.
// A pack that doesn't have a given type simply 404s (empty, not denied — see interpret).
const LIB_ENDPOINTS = [
  'lib/breakers',
  'lib/regex',
  'lib/grok',
  'lib/parsers',
  'lib/schemas',
  'lib/parquet-schemas',
  'lib/sds-rules',
  'lib/sds-rulesets',
  'lib/protobuf-libraries',
  'lib/appscope-configs',
  'lib/vars',
  'lib/database-connections',
] as const;

// Core objects. Whether a group is skipped is decided on these alone: a group the caller
// can't read (403 on all core) must be counted as skipped even if the 12 library endpoints
// merely 404 (e.g. a Leader predating them) — otherwise it would masquerade as indexed-empty.
const CORE_GROUP_ENDPOINTS = ['pipelines', 'routes', 'system/inputs', 'system/outputs', 'system/lookups', 'packs'] as const;
const CORE_PACK_ENDPOINTS = ['pipelines', 'routes', 'system/inputs', 'system/outputs'] as const;

const GROUP_ENDPOINTS = [...CORE_GROUP_ENDPOINTS, ...LIB_ENDPOINTS] as const;
const PACK_ENDPOINTS = [...CORE_PACK_ENDPOINTS, ...LIB_ENDPOINTS] as const;

// Max scopes fetched at once. Each scope is already an allSettled fan-out over ~16–18
// endpoints, so this is the outer cap that keeps a big org from flooding the Leader.
const FETCH_CONCURRENCY = 8;

/** Raw payloads for one (group) or (group, pack) scope. */
export interface RawScope {
  group: string;
  pack?: string;
  pipelines?: unknown;
  routes?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  lookups?: unknown; // group scope only
  packs?: unknown; // group scope only
  // Library objects (group and pack scope).
  eventBreakers?: unknown;
  regexes?: unknown;
  grok?: unknown;
  parsers?: unknown;
  schemas?: unknown;
  parquetSchemas?: unknown;
  sdsRules?: unknown;
  sdsRulesets?: unknown;
  protobufLibraries?: unknown;
  appscopeConfigs?: unknown;
  variables?: unknown;
  dbConnections?: unknown;
}

export interface RawOrg {
  scopes: RawScope[];
  report: FetchReport;
}

/** Fetch the whole org. Throws only if Worker Group enumeration itself fails. */
export async function fetchOrg(opts: ApiOptions = {}): Promise<RawOrg> {
  const builtAt = new Date().toISOString();
  const groups = await enumerateGroups(opts);

  const scopes: RawScope[] = [];
  const indexedGroups: string[] = [];
  const skippedGroups: SkippedGroup[] = [];
  const partialFailures: PartialFailure[] = [];

  // Phase 1 — every group's own config, bounded. Each result carries the pack ids to fetch
  // next; packs are NOT fetched here, so the two nested loops can't multiply into a burst.
  const groupResults = await mapPool(groups, FETCH_CONCURRENCY, (group) => fetchGroup(group, opts));
  const packJobs: { group: string; pack: string }[] = [];
  for (const result of groupResults) {
    if (result.skipped) {
      skippedGroups.push(result.skipped);
      continue;
    }
    indexedGroups.push(result.group);
    scopes.push(...result.scopes);
    partialFailures.push(...result.partialFailures);
    for (const pack of result.packs) packJobs.push({ group: result.group, pack });
  }

  // Phase 2 — every (group, pack) across ALL groups in ONE pool (not a pool per group), so
  // peak in-flight stays ≈ FETCH_CONCURRENCY no matter how many groups there are.
  const packResults = await mapPool(packJobs, FETCH_CONCURRENCY, (job) => fetchPack(job.group, job.pack, opts));
  for (const pack_ of packResults) {
    if (!pack_) continue;
    scopes.push(pack_.scope);
    if (pack_.partialFailure) partialFailures.push(pack_.partialFailure);
  }

  return { scopes, report: { indexedGroups, skippedGroups, partialFailures, builtAt } };
}

/** List Worker Group ids for the configured products. */
export async function enumerateGroups(opts: ApiOptions = {}): Promise<string[]> {
  const ids: string[] = [];
  for (const product of PRODUCTS) {
    const payload = await apiGet<unknown>(`/products/${product}/groups`, opts);
    for (const item of itemsOf(payload)) {
      const obj = asRecord(item);
      const id = obj && str(obj, 'id');
      if (obj && id) ids.push(id);
    }
  }
  return ids;
}

async function fetchGroup(
  group: string,
  opts: ApiOptions,
): Promise<{ group: string; scopes: RawScope[]; skipped?: SkippedGroup; partialFailures: PartialFailure[]; packs: string[] }> {
  const base = `/m/${encodeURIComponent(group)}`;
  const settled = await Promise.allSettled(
    GROUP_ENDPOINTS.map((e) => apiGet<unknown>(`${base}/${e}`, opts)),
  );
  const parsed = settled.map(interpret);
  const denied = deniedEndpoints(GROUP_ENDPOINTS, parsed);

  // The group is skipped only when every CORE endpoint is denied — a caller that can read
  // no core object. Library 404s (a Leader without those endpoints) must not keep an
  // otherwise-inaccessible group off the skip list.
  if (CORE_GROUP_ENDPOINTS.every((e) => denied.has(e))) {
    const denial = parsed.find((p) => p.denied);
    return { group, scopes: [], skipped: { group, status: denial?.status }, partialFailures: [], packs: [] };
  }

  const at = pickData(GROUP_ENDPOINTS, parsed);
  const groupScope: RawScope = {
    group,
    pipelines: at('pipelines'),
    routes: at('routes'),
    inputs: at('system/inputs'),
    outputs: at('system/outputs'),
    lookups: at('system/lookups'),
    packs: at('packs'),
    ...libScope(at),
  };
  const partialFailures: PartialFailure[] = [];
  // Only a failed CORE endpoint makes the scope's structure untrustworthy (a failed lib
  // endpoint just drops inert leaves); record it so findings for this scope are suppressed.
  const failedCore = CORE_GROUP_ENDPOINTS.filter((e) => denied.has(e));
  if (failedCore.length > 0) partialFailures.push({ group, endpoints: [...failedCore], status: statusOf(failedCore, GROUP_ENDPOINTS, parsed) });

  // Packs are fetched in phase 2 (one shared pool across all groups), not here.
  return { group, scopes: [groupScope], partialFailures, packs: packIds(groupScope.packs) };
}

async function fetchPack(
  group: string,
  pack: string,
  opts: ApiOptions,
): Promise<{ scope: RawScope; partialFailure?: PartialFailure } | null> {
  const base = `/m/${encodeURIComponent(group)}/p/${encodeURIComponent(pack)}`;
  const settled = await Promise.allSettled(
    PACK_ENDPOINTS.map((e) => apiGet<unknown>(`${base}/${e}`, opts)),
  );
  const parsed = settled.map(interpret);
  const denied = deniedEndpoints(PACK_ENDPOINTS, parsed);
  if (CORE_PACK_ENDPOINTS.every((e) => denied.has(e))) return null; // pack core fully denied — degrade silently

  const at = pickData(PACK_ENDPOINTS, parsed);
  const scope: RawScope = {
    group,
    pack,
    pipelines: at('pipelines'),
    routes: at('routes'),
    inputs: at('system/inputs'),
    outputs: at('system/outputs'),
    ...libScope(at),
  };
  const failedCore = CORE_PACK_ENDPOINTS.filter((e) => denied.has(e));
  const partialFailure =
    failedCore.length > 0 ? { group, pack, endpoints: [...failedCore], status: statusOf(failedCore, PACK_ENDPOINTS, parsed) } : undefined;
  return { scope, partialFailure };
}

/** The set of endpoint names whose fetch failed (denied/5xx/network — not a 404). */
function deniedEndpoints(endpoints: readonly string[], parsed: Interp[]): Set<string> {
  const out = new Set<string>();
  endpoints.forEach((e, i) => {
    if (parsed[i]?.denied) out.add(e);
  });
  return out;
}

/** A representative HTTP status for a set of failed endpoints (for the report). */
function statusOf(failed: readonly string[], endpoints: readonly string[], parsed: Interp[]): number | undefined {
  for (const e of failed) {
    const i = endpoints.indexOf(e);
    if (i >= 0 && parsed[i]?.status !== undefined) return parsed[i].status;
  }
  return undefined;
}

/** Look up a scope's endpoint payloads by endpoint name (not position), so adding
 *  endpoints can't silently misalign the RawScope fields. */
function pickData(endpoints: readonly string[], parsed: Interp[]): (endpoint: string) => unknown {
  const map = new Map(endpoints.map((e, i) => [e, parsed[i]?.data]));
  return (endpoint) => map.get(endpoint);
}

/** The library-object fields of a RawScope, shared by group and pack construction. */
function libScope(at: (endpoint: string) => unknown): Partial<RawScope> {
  return {
    eventBreakers: at('lib/breakers'),
    regexes: at('lib/regex'),
    grok: at('lib/grok'),
    parsers: at('lib/parsers'),
    schemas: at('lib/schemas'),
    parquetSchemas: at('lib/parquet-schemas'),
    sdsRules: at('lib/sds-rules'),
    sdsRulesets: at('lib/sds-rulesets'),
    protobufLibraries: at('lib/protobuf-libraries'),
    appscopeConfigs: at('lib/appscope-configs'),
    variables: at('lib/vars'),
    dbConnections: at('lib/database-connections'),
  };
}

interface Interp {
  data?: unknown;
  denied: boolean; // 403/401/5xx/network — a real access/availability failure
  status?: number;
}

function interpret(res: PromiseSettledResult<unknown>): Interp {
  if (res.status === 'fulfilled') return { data: res.value, denied: false };
  const err = res.reason;
  if (err instanceof ApiError) {
    if (err.kind === 'http' && err.status === 404) return { denied: false, status: 404 };
    return { denied: true, status: err.status };
  }
  return { denied: true };
}

function packIds(payload: unknown): string[] {
  const ids: string[] = [];
  for (const item of itemsOf(payload)) {
    const obj = asRecord(item);
    const id = obj && str(obj, 'id');
    if (id) ids.push(id);
  }
  return ids;
}
