// Maps a knowledge object to a deep link into the Cribl Leader UI. The app runs
// in a sandboxed iframe, so we derive the parent origin from document.referrer;
// when that isn't available we surface the path with a copy button instead of a
// broken link.
//
// Section paths below `/stream/m/<group>/` (and, for pack objects, below
// `/stream/m/<group>/p/<pack>/` — objects in a pack live at the same section under the
// pack's own subtree):
//   pipeline    pipelines/<id>
//   source      inputs/<connectorType>/<id>
//   destination outputs/<connectorType>/<id>
//   route       routes                 (group-level)
//   pack        p/<packId>/routes      (opens the pack at its Routes page)
//   lookup      knowledge/lookups/<id>   (Knowledge menu — the specific lookup)
//   library     knowledge/<slug>/<id>    (Knowledge menu — the specific object)
// The Knowledge-menu slugs are the Leader UI's own route ids, confirmed against a live
// Leader's Knowledge menu: breakers→breakerrules, regex→regex, grok→grok, parsers→parsers,
// schemas→schemas, parquet→parquetschemas, appscope→appscope, vars→vars,
// database-connections→database-connections, lookups→lookups.
// Every Knowledge object is individually addressable at `knowledge/<slug>/<id>` (and, inside
// a pack, `p/<pack>/knowledge/<slug>/<id>`). The Stream group is a catch-all route whose
// internal router recognizes these slugs, so the id is a live path segment for all of them —
// verified with real URLs for regex, parsers, and grok, and against the UI bundle's slug
// registry. The id is percent-encoded (a parser named "Apache Combined Log Format" → …/Apache%20Combined%20Log%20Format).
// No standalone Leader page (so non-linkable):
//   - Protobuf libraries — no Knowledge slug exists for them (they're referenced only inside
//     the destinations that use them).
//   - Sensitive-Data / "Guard" rules & rulesets — a `guard-rules` slug exists in the bundle,
//     but the Guard Rules page isn't exposed in the Knowledge menu on this workspace, so a
//     link would 404. Left non-linkable until that page is confirmed reachable here.

import { type KORecord, type KOType } from '../data/types';
import { asRecord, str } from '../data/raw';

// Knowledge-menu route id per library object type. Absent = no Knowledge page (non-linkable).
const KNOWLEDGE_SLUG: Partial<Record<KOType, string>> = {
  'event-breaker': 'breakerrules',
  regex: 'regex',
  grok: 'grok',
  parser: 'parsers',
  schema: 'schemas',
  'parquet-schema': 'parquetschemas',
  appscope: 'appscope',
  variable: 'vars',
  'db-connection': 'database-connections',
};

export interface LinkTarget {
  type: KOType;
  group: string;
  pack?: string;
  id: string;
  /** Connector type for sources/destinations (e.g. "splunk"), part of their UI path. */
  subtype?: string;
}

export interface CriblLink {
  /** The Leader-UI path (empty for non-linkable types). */
  path: string;
  /** Absolute URL when the parent origin is known and the type is linkable, else null. */
  href: string | null;
  /** False for objects with no reliable Leader page (protobuf/Guard rules). */
  linkable: boolean;
  /** True when the path targets this exact object; false when it can only reach the object's
   *  list/section page (routes, lookups, and the non-addressable library types). */
  itemLevel: boolean;
}

/** The per-type section path below `/stream/m/<group>[/p/<pack>]/`, or '' when the type
 *  has no reliable Leader page. */
function section(t: LinkTarget): string {
  switch (t.type) {
    case 'pipeline':
      return `pipelines/${t.id}`;
    case 'route':
      return 'routes';
    case 'source':
      return `inputs${t.subtype ? `/${t.subtype}` : ''}/${t.id}`;
    case 'destination':
      return `outputs${t.subtype ? `/${t.subtype}` : ''}/${t.id}`;
    case 'lookup':
      return `knowledge/lookups/${encodeURIComponent(t.id)}`;
    case 'pack':
      return `p/${t.id}/routes`; // handled in buildLink; kept for exhaustiveness
    case 'event-breaker':
    case 'regex':
    case 'grok':
    case 'parser':
    case 'schema':
    case 'parquet-schema':
    case 'sds-rule':
    case 'sds-ruleset':
    case 'protobuf':
    case 'appscope':
    case 'variable':
    case 'db-connection': {
      const slug = KNOWLEDGE_SLUG[t.type];
      if (!slug) return ''; // protobuf / Guard rules → '' → non-linkable
      return `knowledge/${slug}/${encodeURIComponent(t.id)}`;
    }
  }
}

/** Whether `section()` for this type resolves to the specific object (vs a list page). Only
 *  routes are group-level — the Leader has no per-route page; every other linkable type
 *  (including Knowledge objects and lookups) reaches its own object. */
function itemLevelFor(type: KOType): boolean {
  return type !== 'route';
}

export function buildLink(target: LinkTarget): CriblLink {
  const origin = parentOrigin();
  const base = `/stream/m/${target.group}`;

  // A pack itself — or a `pack:<name>` pseudo-pipeline in the pipelines list — opens the
  // pack at its Routes page.
  const packSelf =
    target.type === 'pack' ? target.id : target.id.startsWith('pack:') ? target.id.slice('pack:'.length) : null;
  if (packSelf) return mk(`${base}/p/${packSelf}/routes`, origin, true);

  const sec = section(target);
  if (!sec) return { path: '', href: null, linkable: false, itemLevel: false }; // no reliable Leader page

  // Objects inside a pack live under the pack's own subtree at the same section path.
  const path = target.pack ? `${base}/p/${target.pack}/${sec}` : `${base}/${sec}`;
  return mk(path, origin, itemLevelFor(target.type));
}

function mk(path: string, origin: string | null, itemLevel: boolean): CriblLink {
  return { path, href: origin ? origin + path : null, linkable: true, itemLevel };
}

/** Convenience: build a link straight from a record, pulling the connector type. */
export function linkForRecord(record: KORecord): CriblLink {
  return buildLink({
    type: record.type,
    group: record.group,
    pack: record.pack,
    id: record.id,
    subtype: connectorType(record),
  });
}

function connectorType(record: KORecord): string | undefined {
  if (record.type !== 'source' && record.type !== 'destination') return undefined;
  const raw = asRecord(record.raw);
  return raw ? str(raw, 'type') : undefined;
}

function parentOrigin(): string | null {
  if (typeof document === 'undefined' || !document.referrer) return null;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}
