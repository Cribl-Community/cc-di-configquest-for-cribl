import { describe, it, expect } from 'vitest';
import { buildLink } from './linkBuilder';
import type { KOType } from '../data/types';

// Paths only (href needs document.referrer, absent under Node — returns null).
describe('buildLink', () => {
  it('builds the verified pipeline, source, and route paths', () => {
    expect(buildLink({ type: 'pipeline', group: 'default', id: 'zscalernss_web_parse' }).path).toBe(
      '/stream/m/default/pipelines/zscalernss_web_parse',
    );
    expect(buildLink({ type: 'source', group: 'default', id: 'in_splunk_tcp', subtype: 'splunk' }).path).toBe(
      '/stream/m/default/inputs/splunk/in_splunk_tcp',
    );
    // Routes are group-level — the id is ignored.
    expect(buildLink({ type: 'route', group: 'default', id: 's7WIVc' }).path).toBe('/stream/m/default/routes');
  });

  it('builds the verified destination and pack paths', () => {
    expect(buildLink({ type: 'destination', group: 'default', id: 'zscaler_lake', subtype: 'cribl_lake' }).path).toBe(
      '/stream/m/default/outputs/cribl_lake/zscaler_lake',
    );
    expect(buildLink({ type: 'pack', group: 'default', id: 'cribl-crowdstrike-ngsiem-rest-io' }).path).toBe(
      '/stream/m/default/p/cribl-crowdstrike-ngsiem-rest-io/routes',
    );
    // lookups drill to the specific file under the Knowledge menu
    expect(buildLink({ type: 'lookup', group: 'default', id: 'x.csv' }).path).toBe('/stream/m/default/knowledge/lookups/x.csv');
  });

  it('falls back gracefully when a source has no connector subtype', () => {
    expect(buildLink({ type: 'source', group: 'default', id: 'x' }).path).toBe('/stream/m/default/inputs/x');
  });

  it('marks core object types linkable', () => {
    for (const type of ['pipeline', 'route', 'source', 'destination', 'lookup', 'pack'] as const) {
      expect(buildLink({ type, group: 'default', id: 'x' }).linkable).toBe(true);
    }
  });

  // Every Knowledge object drills to its own item at knowledge/<slug>/<id> (catch-all route).
  it('links every Knowledge library type to its specific object', () => {
    const cases: [KOType, string][] = [
      ['event-breaker', 'breakerrules'],
      ['regex', 'regex'],
      ['grok', 'grok'],
      ['parser', 'parsers'],
      ['schema', 'schemas'],
      ['parquet-schema', 'parquetschemas'],
      ['appscope', 'appscope'],
      ['variable', 'vars'],
      ['db-connection', 'database-connections'],
    ];
    for (const [type, slug] of cases) {
      const link = buildLink({ type, group: 'default', id: 'my_obj' });
      expect(link.linkable).toBe(true);
      expect(link.itemLevel).toBe(true);
      expect(link.path).toBe(`/stream/m/default/knowledge/${slug}/my_obj`);
    }
    // ids with URL-significant characters are percent-encoded in the path segment — e.g. a
    // parser named "Apache Combined Log Format" (matches the real Leader URL).
    expect(buildLink({ type: 'parser', group: 'default', id: 'Apache Combined Log Format' }).path).toBe(
      '/stream/m/default/knowledge/parsers/Apache%20Combined%20Log%20Format',
    );
    expect(buildLink({ type: 'variable', group: 'default', id: 'a b/c' }).path).toBe('/stream/m/default/knowledge/vars/a%20b%2Fc');
  });

  it('has no Leader page for SDS (Guard) rules or protobuf libraries', () => {
    for (const type of ['sds-rule', 'sds-ruleset', 'protobuf'] as const) {
      const link = buildLink({ type, group: 'default', id: 'american_express_card_(4+4+4+3_digits)' });
      expect(link.linkable).toBe(false);
      expect(link.itemLevel).toBe(false);
      expect(link.href).toBeNull();
      expect(link.path).toBe('');
    }
  });

  it('links objects inside a pack per-object under the pack subtree', () => {
    // core objects keep their section, prefixed by the pack subtree
    expect(buildLink({ type: 'pipeline', group: 'default', pack: 'sec', id: 'cisco_asa' }).path).toBe('/stream/m/default/p/sec/pipelines/cisco_asa');
    expect(buildLink({ type: 'source', group: 'default', pack: 'sec', id: 'in_palo', subtype: 'syslog' }).path).toBe('/stream/m/default/p/sec/inputs/syslog/in_palo');
    expect(buildLink({ type: 'destination', group: 'default', pack: 'sec', id: 'out_cs', subtype: 'crowdstrike_next_gen_siem' }).path).toBe(
      '/stream/m/default/p/sec/outputs/crowdstrike_next_gen_siem/out_cs',
    );
    // library objects and lookups inside a pack reach their object under the pack subtree
    expect(buildLink({ type: 'event-breaker', group: 'default', pack: 'sec', id: 'r' }).path).toBe('/stream/m/default/p/sec/knowledge/breakerrules/r');
    expect(buildLink({ type: 'regex', group: 'default', pack: 'sec', id: 'r' }).path).toBe('/stream/m/default/p/sec/knowledge/regex/r');
    expect(buildLink({ type: 'lookup', group: 'default', pack: 'sec', id: 'x.csv' }).path).toBe('/stream/m/default/p/sec/knowledge/lookups/x.csv');
    // a pack itself (or a pack:<name> pseudo-pipeline) opens its Routes page
    expect(buildLink({ type: 'pack', group: 'default', id: 'sec' }).path).toBe('/stream/m/default/p/sec/routes');
    expect(buildLink({ type: 'pipeline', group: 'default', id: 'pack:sec' }).path).toBe('/stream/m/default/p/sec/routes');
  });
});
