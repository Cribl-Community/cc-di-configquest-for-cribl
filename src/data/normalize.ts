// Turn raw API payloads into flat KORecords. The searchText flattening is the
// heart of the app: every non-empty leaf becomes one "jsonPath: value" line so
// a match can be shown with *where* it matched.

import type { KORecord, KOType, SystemKOType } from './types';
import type { RawOrg, RawScope } from './fetchOrg';
import { asRecord, bool, itemsOf, str } from './raw';

// Real Cribl configs nest a handful of levels; this cap only guards against a
// pathological object deep enough to overflow the call stack and abort indexing.
const MAX_FLATTEN_DEPTH = 200;

/** Walk any value, emitting one `path: value` string per non-empty leaf. */
export function flatten(value: unknown): string[] {
  const out: string[] = [];
  flattenInto(value, '', out, 0);
  return out;
}

function flattenInto(value: unknown, path: string, out: string[], depth: number): void {
  if (value === null || value === undefined) return;
  if (depth >= MAX_FLATTEN_DEPTH) {
    out.push(`${path}: (truncated)`);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      flattenInto(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenInto(v, path ? `${path}.${k}` : k, out, depth + 1);
    }
    return;
  }
  const str = typeof value === 'string' ? value : String(value);
  if (str === '') return;
  out.push(`${path}: ${str}`);
}

export function normalizeOrg(raw: RawOrg): KORecord[] {
  const records: KORecord[] = [];
  for (const scope of raw.scopes) {
    collectPipelines(scope, records);
    collectRoutes(scope, records);
    collectSystem(scope, 'source', scope.inputs, records);
    collectSystem(scope, 'destination', scope.outputs, records);
    collectSystem(scope, 'lookup', scope.lookups, records);
    collectPacks(scope, records);
    // Library objects — flat id-keyed lists, same shape as sources/lookups.
    collectSystem(scope, 'event-breaker', scope.eventBreakers, records);
    collectSystem(scope, 'regex', scope.regexes, records);
    collectSystem(scope, 'grok', scope.grok, records);
    collectSystem(scope, 'parser', scope.parsers, records);
    collectSystem(scope, 'schema', scope.schemas, records);
    collectSystem(scope, 'parquet-schema', scope.parquetSchemas, records);
    collectSystem(scope, 'sds-rule', scope.sdsRules, records);
    collectSystem(scope, 'sds-ruleset', scope.sdsRulesets, records);
    collectSystem(scope, 'protobuf', scope.protobufLibraries, records);
    collectSystem(scope, 'appscope', scope.appscopeConfigs, records);
    collectSystem(scope, 'variable', scope.variables, records);
    collectSystem(scope, 'db-connection', scope.dbConnections, records);
  }
  return records;
}

function collectPipelines(scope: RawScope, out: KORecord[]): void {
  for (const item of itemsOf(scope.pipelines)) {
    const obj = asRecord(item);
    const id = obj && str(obj, 'id');
    if (!obj || !id) continue;
    const conf = asRecord(obj['conf']);
    out.push(makeRecord(scope, 'pipeline', id, id, obj, {
      description: conf ? str(conf, 'description') : undefined,
    }));
  }
}

function collectRoutes(scope: RawScope, out: KORecord[]): void {
  // Each item is a routing table `{ id, routes: RouteConf[] }`.
  for (const table of itemsOf(scope.routes)) {
    const tableObj = asRecord(table);
    if (!tableObj || !Array.isArray(tableObj['routes'])) continue;
    for (const route of tableObj['routes'] as unknown[]) {
      const obj = asRecord(route);
      const id = obj && (str(obj, 'id') ?? str(obj, 'name'));
      if (!obj || !id) continue;
      out.push(makeRecord(scope, 'route', id, str(obj, 'name') ?? id, obj, {
        description: str(obj, 'description'),
        disabled: bool(obj, 'disabled'),
      }));
    }
  }
}

function collectSystem(scope: RawScope, type: SystemKOType, payload: unknown, out: KORecord[]): void {
  for (const item of itemsOf(payload)) {
    const obj = asRecord(item);
    const id = obj && str(obj, 'id');
    if (!obj || !id) continue;
    // Most objects are id-keyed with id-as-name; a few (protobuf) carry a display name.
    out.push(makeRecord(scope, type, id, str(obj, 'name') ?? id, obj, {
      description: str(obj, 'description'),
      disabled: bool(obj, 'disabled'),
    }));
  }
}

function collectPacks(scope: RawScope, out: KORecord[]): void {
  for (const item of itemsOf(scope.packs)) {
    const obj = asRecord(item);
    const id = obj && str(obj, 'id');
    if (!obj || !id) continue;
    out.push(makeRecord(scope, 'pack', id, str(obj, 'displayName') ?? id, obj, {
      description: str(obj, 'description'),
      disabled: bool(obj, 'isDisabled'),
    }));
  }
}

interface RecordExtra {
  description?: string;
  disabled?: boolean;
}

function makeRecord(
  scope: RawScope,
  type: KOType,
  id: string,
  name: string,
  raw: unknown,
  extra: RecordExtra,
): KORecord {
  return {
    key: `${scope.group}/${scope.pack ?? '-'}/${type}/${id}`,
    type,
    group: scope.group,
    pack: scope.pack,
    id,
    name,
    description: extra.description,
    disabled: extra.disabled,
    raw,
    searchText: flatten(raw),
  };
}
