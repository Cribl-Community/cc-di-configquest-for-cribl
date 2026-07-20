// Hand-written fixtures for a synthetic org (6 Worker Groups + 1 pack) with
// deliberately planted defects, drift, and hostile config values. These plug into
// the apiClient Transport seam — the only test abstraction — and also drive
// backend-free UI development.
//
// The nasty strings below (script tags, spreadsheet formulas, CJK and spaced ids,
// URL-significant characters) simulate a hostile Cribl config: they belong to the
// data an operator could really have, never to the app's own source.

import type { Transport } from '../apiClient';
import groups from './groups.json';
import prod from './prod.json';
import staging from './staging.json';
import eu_west from './eu_west.json';
import apac from './apac.json';
import dmz from './dmz.json';
import lab from './lab.json';
import pack from './pack.json';
import { libraryPayloads } from './library';
import { gitPayloads } from './git';

export const PACK_ID = 'security_pack';

/** A system/status/* response body: `{ items: [{ id, status: { health } }] }`. */
function status(pairs: [string, string][]): unknown {
  return { items: pairs.map(([id, health]) => ({ id, status: { health } })) };
}

// A lookup-content payload as the Leader returns it: a leading internal __id column
// plus the given columns, and rows with a 1-based row number in that __id slot.
function lookupContent(cols: string[], rows: string[][]): unknown {
  return { fields: ['__id', ...cols], items: rows.map((r, i) => [i + 1, ...r]) };
}

/** The content path for a lookup, encoded exactly as fetchLookupContent builds it —
 *  so ids carrying spaces or URL-significant characters still resolve. */
function lookupPath(group: string, id: string): string {
  return `/m/${encodeURIComponent(group)}/system/lookups/${encodeURIComponent(id)}/content`;
}

/** The collections a group fixture file declares (shapes vary per group — only the
 *  endpoint mapping is common). */
interface GroupFixture {
  pipelines: unknown;
  routes: unknown;
  inputs: unknown;
  outputs: unknown;
  lookups: unknown;
  packs: unknown;
}

/** Every `/m/<group>/…` collection endpoint for one group. */
function groupPayloads(group: string, data: GroupFixture): Record<string, unknown> {
  return {
    [`/m/${group}/pipelines`]: data.pipelines,
    [`/m/${group}/routes`]: data.routes,
    [`/m/${group}/system/inputs`]: data.inputs,
    [`/m/${group}/system/outputs`]: data.outputs,
    [`/m/${group}/system/lookups`]: data.lookups,
    [`/m/${group}/packs`]: data.packs,
  };
}

// geo_city.csv exists in three groups at the same declared size, so the lookup
// clustering has to fetch content to tell them apart: prod and apac are
// byte-identical (one variant), eu_west has an extra row (a second variant).
const geoCityRows = [
  ['10.0.0.1', 'Portland', 'US'],
  ['10.0.0.2', 'Berlin', 'DE'],
  ['10.0.0.5', 'Osaka', 'JP'],
];

/** Bare API paths (no CRIBL_API_URL base) → the JSON body they return. Git paths
 *  keep their query string (see gitPayloads); everything else is query-free. */
export const fixturePayloads: Record<string, unknown> = {
  '/products/stream/groups': groups,

  ...groupPayloads('prod', prod),
  ...groupPayloads('staging', staging),
  ...groupPayloads('eu_west', eu_west),
  ...groupPayloads('apac', apac),
  ...groupPayloads('dmz', dmz),
  ...groupPayloads('lab', lab),
  ...libraryPayloads,

  '/m/prod/p/security_pack/pipelines': pack.pipelines,
  '/m/prod/p/security_pack/routes': pack.routes,
  '/m/prod/p/security_pack/system/inputs': pack.inputs,
  '/m/prod/p/security_pack/system/outputs': pack.outputs,

  '/m/prod/system/status/inputs': status([['splunk_in', 'Green'], ['dead_input', 'Red'], ['pp_input', 'Green']]),
  '/m/prod/system/status/outputs': status([['splunk_out', 'Green'], ['hec_primary', 'Yellow']]),
  '/m/staging/system/status/inputs': status([['stg_in', 'Green']]),
  '/m/staging/system/status/outputs': status([['stg_out', 'Green'], ['hec_primary', 'Green']]),
  '/m/eu_west/system/status/inputs': status([['syslog_edge', 'Green']]),
  '/m/eu_west/system/status/outputs': status([['hec_primary', 'Green']]),
  '/m/apac/system/status/inputs': status([['kafka_in', 'Yellow']]),
  '/m/apac/system/status/outputs': status([['hec_primary', 'Red']]),
  '/m/dmz/system/status/inputs': status([['syslog_edge', 'Green'], ['tap_span', 'Green']]),
  '/m/dmz/system/status/outputs': status([['hec_primary', 'Green']]),
  '/m/lab/system/status/inputs': status([['lab_in', 'Green']]),
  '/m/lab/system/status/outputs': status([['hec_primary', 'Green']]),

  // Lookup (.csv) content, so Compare's row-diff and the cross-group variant cards
  // render in dev. Real payloads carry an internal __id column, which the app strips.
  // geo_city and threat_intel have different columns — exercises the column mismatch.
  [lookupPath('prod', 'geo_city.csv')]: lookupContent(['ip', 'city', 'country'], geoCityRows),
  [lookupPath('apac', 'geo_city.csv')]: lookupContent(['ip', 'city', 'country'], geoCityRows),
  [lookupPath('eu_west', 'geo_city.csv')]: lookupContent(['ip', 'city', 'country'], [...geoCityRows, ['10.0.0.9', 'Frankfurt', 'DE']]),
  [lookupPath('prod', 'threat_intel.csv')]: lookupContent(
    ['ip', 'score', 'category'],
    [['10.0.0.2', '88', 'botnet'], ['10.0.0.7', '12', 'scanner']],
  ),
  [lookupPath('prod', 'unused_ref.csv')]: lookupContent(['key', 'value'], [['a', '1']]),
  // A lookup with no rows at all.
  [lookupPath('apac', 'empty_watchlist.csv')]: lookupContent(['ioc', 'severity'], []),
  [lookupPath('apac', '東京_ipリスト.csv')]: lookupContent(
    ['cidr', '都市'],
    [['203.0.113.0/24', '東京'], ['198.51.100.0/24', '大阪']],
  ),
  // A cell that a spreadsheet would execute if the export didn't neutralize it.
  [lookupPath('apac', 'customer segments.csv')]: lookupContent(
    ['account_id', 'segment'],
    [['ACME-1', 'enterprise'], ['ACME-2', '=cmd|\'/c calc\'!A1'], ['ACME-3', '@SUM(1+1)*cmd']],
  ),
  // A single-column lookup, keyed by an id full of URL-significant characters.
  [lookupPath('dmz', 'web+prod&2026#final.csv')]: lookupContent(['host'], [['web-01'], ['web-02'], ['web-03']]),

  ...gitPayloads(),
};

export interface FixtureTransportOptions {
  /** Return true to answer a path with 403 (simulates a per-group denial). */
  deny?: (path: string) => boolean;
  /** Return true to answer a path with 404 (simulates an empty/absent endpoint). */
  notFound?: (path: string) => boolean;
}

export function makeFixtureTransport(options: FixtureTransportOptions = {}): Transport {
  return (rawPath: string) => {
    const path = rawPath.split('?')[0];
    if (options.deny?.(path)) {
      return Promise.resolve(new Response('forbidden', { status: 403 }));
    }
    if (options.notFound?.(path)) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    // Query-scoped payloads (a commit's files, one file's diff) win over the bare
    // path, which stays the fallback for collection endpoints and unknown hashes.
    const body = rawPath in fixturePayloads ? fixturePayloads[rawPath] : fixturePayloads[path];
    if (body !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}
