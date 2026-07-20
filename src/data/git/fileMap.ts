// Map a git config file path to the record key(s) it affects. Some objects live in
// per-object files (one record); others live in shared per-group tables, so every object
// in a touched shared file inherits that commit (file-level granularity — the age walk's
// diff analysis then narrows a shared-file change to the object whose block actually moved).
//
// Verified against a Cribl.Cloud Leader git repo — a Worker Group's objects are:
//   pipeline       groups/<g>/local/cribl/pipelines/<id>/conf.yml      (per-object)
//   route          groups/<g>/local/cribl/pipelines/route.yml          (shared table)
//   source         groups/<g>/local/cribl/inputs.yml                   (shared)
//   destination    groups/<g>/local/cribl/outputs.yml                  (shared)
//   lookup         groups/<g>/data/lookups/<file>                      (per-object)
// Library / Knowledge objects — verified from live commits (e.g. a schema edit touches
// `schemas/<id>.json`):
//   schema         groups/<g>/local/cribl/schemas/<id>.json            (per-object)
//   parquet-schema groups/<g>/local/cribl/parquet-schemas/<id>.<ext>   (per-object)
//   grok           groups/<g>/local/cribl/grok-patterns/<id>           (per-object, no ext)
//   protobuf       groups/<g>/data/protobuf-libraries/<id>/…           (per-object dir)
//   event-breaker  groups/<g>/local/cribl/breakers.yml                 (shared)
//   regex          groups/<g>/local/cribl/regexes.yml                  (shared)
//   parser         groups/<g>/local/cribl/parsers.yml                  (shared)
//   appscope       groups/<g>/local/cribl/appscope.yml                 (shared)
//   variable       groups/<g>/local/cribl/vars.yml                     (shared)
//   sds-rule       groups/<g>/local/cribl/sds-rules.yml                (shared)
//   sds-ruleset    groups/<g>/local/cribl/sds-rulesets.yml             (shared)
//   db-connection  groups/<g>/local/cribl/database-connections.yml     (shared)
// (schemas.yml / parquet-schemas.yml registries are intentionally NOT mapped — the per-object
// files above already attribute those precisely, and mapping the registry too would re-report
// every schema on any single edit.)
// A pack's own objects live under `groups/<g>/<default|local>/<packId>/…` (the
// group's own config sits alongside at `<default|local>/cribl/…`), with pack data
// under `groups/<g>/data/packs/<packId>/…`. Leader-level files (e.g.
// `local/cribl/groups.yml`) have no `groups/<g>/` prefix and map to nothing.

import type { KORecord, KOType } from '../types';

export interface ParsedConfigPath {
  group: string;
  pack?: string;
  type: KOType;
  /** Present for per-object files (pipeline dir, lookup file, per-object library files);
   *  absent for shared tables, which map to every object of the type in scope. */
  id?: string;
}

// Capture the group and the path *within* its subtree so pack detection can't be
// fooled by a group literally named "default"/"local".
const GROUP_RE = /(?:^|\/)groups\/([^/]+)\/(.+)$/;
const PIPELINE_RE = /\/pipelines\/([^/]+)\//;
const LOOKUP_RE = /\/lookups\/([^/]+?)(?:\/|$)/;
// The routing table is `pipelines/route.yml` (singular); `routes.yml` kept as a fallback.
const ROUTES_RE = /\/(?:pipelines\/route|routes)\.yml$/;
const INPUTS_RE = /\/inputs\.yml$/;
const OUTPUTS_RE = /\/outputs\.yml$/;

// Per-object library files: the specific object's own file (finest granularity, one record).
const SCHEMA_RE = /\/schemas\/([^/]+?)\.json$/;
const PARQUET_RE = /\/parquet-schemas\/([^/]+?)\.[^/.]+$/;
const GROK_RE = /\/grok-patterns\/([^/]+)$/;
const PROTOBUF_RE = /\/protobuf-libraries\/([^/]+)\//;

// Shared library tables: one file lists every object of the type in this scope, so a commit
// maps to them all and the age walk's diff analysis narrows it to the one that changed.
const SHARED_LIB: { re: RegExp; type: KOType }[] = [
  { re: /\/regexes\.yml$/, type: 'regex' },
  { re: /\/parsers\.yml$/, type: 'parser' },
  { re: /\/breakers\.yml$/, type: 'event-breaker' },
  { re: /\/appscope\.yml$/, type: 'appscope' },
  { re: /\/vars\.yml$/, type: 'variable' },
  { re: /\/sds-rulesets\.yml$/, type: 'sds-ruleset' },
  { re: /\/sds-rules\.yml$/, type: 'sds-rule' },
  { re: /\/database-connections\.yml$/, type: 'db-connection' },
];

export function parseConfigPath(path: string): ParsedConfigPath | null {
  const groupMatch = GROUP_RE.exec(path);
  if (!groupMatch) return null;
  const group = groupMatch[1];
  const pack = packOf(groupMatch[2]);

  const pipeline = PIPELINE_RE.exec(path)?.[1];
  if (pipeline) return { group, pack, type: 'pipeline', id: pipeline };

  const lookup = LOOKUP_RE.exec(path)?.[1];
  if (lookup) return { group, pack, type: 'lookup', id: lookup };

  // Per-object library files.
  const schema = SCHEMA_RE.exec(path)?.[1];
  if (schema) return { group, pack, type: 'schema', id: schema };
  const parquet = PARQUET_RE.exec(path)?.[1];
  if (parquet) return { group, pack, type: 'parquet-schema', id: parquet };
  const grok = GROK_RE.exec(path)?.[1];
  if (grok) return { group, pack, type: 'grok', id: grok };
  const protobuf = PROTOBUF_RE.exec(path)?.[1];
  if (protobuf) return { group, pack, type: 'protobuf', id: protobuf };

  if (ROUTES_RE.test(path)) return { group, pack, type: 'route' };
  if (INPUTS_RE.test(path)) return { group, pack, type: 'source' };
  if (OUTPUTS_RE.test(path)) return { group, pack, type: 'destination' };

  // Shared library tables (type-level; the diff walk narrows to the changed object).
  const shared = SHARED_LIB.find((s) => s.re.test(path));
  if (shared) return { group, pack, type: shared.type };
  return null;
}

/**
 * The pack id for a path *within* a Worker Group subtree (`rest` is the part after
 * `groups/<g>/`), or undefined for the group's own `cribl` config. Pack config sits
 * under `<default|local>/<packId>/…`, pack data under `data/packs/<packId>/…`; an
 * explicit nested `packs/<packId>/` segment is handled as a fallback for other layouts.
 */
function packOf(rest: string): string | undefined {
  const data = /^data\/packs\/([^/]+)\//.exec(rest);
  if (data) return data[1];
  const conf = /^(?:default|local)\/([^/]+)\//.exec(rest);
  if (conf && conf[1] !== 'cribl') return conf[1];
  return /(?:^|\/)packs\/([^/]+)\//.exec(rest)?.[1];
}

/** A lookup filename without its extension, e.g. `geo.csv` and its sidecar `geo.yml`
 *  both reduce to `geo`. Used so a lookup's data file (`<name>.csv`) and its metadata file
 *  (`<name>.yml`, which holds the description) resolve to the same record — the record id is
 *  the data-file name, so an edit to the `.yml` sidecar would otherwise never be attributed. */
function lookupBase(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/** Build a resolver from config paths to record keys, using the current index. */
export function buildFileMapper(records: KORecord[]): (path: string) => string[] {
  const keySet = new Set(records.map((r) => r.key));
  const byScopeType = new Map<string, string[]>();
  // Lookups are keyed by base name so the `.csv` data file and the `.yml` metadata sidecar
  // (description, mode, …) both map to the one lookup record.
  const lookupByBase = new Map<string, string[]>();
  for (const r of records) {
    const k = `${r.group}/${r.pack ?? '-'}/${r.type}`;
    const list = byScopeType.get(k);
    if (list) list.push(r.key);
    else byScopeType.set(k, [r.key]);
    if (r.type === 'lookup') {
      const bk = `${r.group}/${r.pack ?? '-'}/${lookupBase(r.id)}`;
      const bl = lookupByBase.get(bk);
      if (bl) bl.push(r.key);
      else lookupByBase.set(bk, [r.key]);
    }
  }

  return (path: string): string[] => {
    const parsed = parseConfigPath(path);
    if (!parsed) return [];
    const scope = `${parsed.group}/${parsed.pack ?? '-'}`;
    // A lookup path (data or its `.yml` metadata sidecar) resolves by base name.
    if (parsed.type === 'lookup' && parsed.id) {
      return lookupByBase.get(`${scope}/${lookupBase(parsed.id)}`) ?? [];
    }
    if (parsed.id) {
      const key = `${scope}/${parsed.type}/${parsed.id}`;
      return keySet.has(key) ? [key] : [];
    }
    return byScopeType.get(`${scope}/${parsed.type}`) ?? [];
  };
}
