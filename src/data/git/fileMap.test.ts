import { describe, it, expect } from 'vitest';
import { parseConfigPath, buildFileMapper } from './fileMap';
import { fetchOrg } from '../fetchOrg';
import { normalizeOrg } from '../normalize';
import { makeFixtureTransport } from '../__fixtures__';
import type { KORecord, KOType } from '../types';

async function records(): Promise<KORecord[]> {
  return normalizeOrg(await fetchOrg({ transport: makeFixtureTransport() }));
}

function lib(group: string, type: KOType, id: string, pack?: string): KORecord {
  return { key: `${group}/${pack ?? '-'}/${type}/${id}`, type, group, pack, id, name: id, raw: {}, searchText: [] };
}

describe('parseConfigPath', () => {
  it('maps a per-pipeline directory to a pipeline id', () => {
    expect(parseConfigPath('groups/prod/local/cribl/pipelines/web_logs/conf.yml')).toEqual({
      group: 'prod',
      type: 'pipeline',
      id: 'web_logs',
    });
  });

  it('maps a pack pipeline with the pack scope', () => {
    expect(
      parseConfigPath('groups/prod/local/cribl/packs/security_pack/default/cribl/pipelines/pack_detect/conf.yml'),
    ).toEqual({ group: 'prod', pack: 'security_pack', type: 'pipeline', id: 'pack_detect' });
  });

  it('maps a pack pipeline in the real Cloud layout (<default|local>/<pack>/…)', () => {
    expect(
      parseConfigPath('groups/default/default/cribl-crowdstrike-ngsiem-rest-io/pipelines/cisco_asa/conf.yml'),
    ).toEqual({ group: 'default', pack: 'cribl-crowdstrike-ngsiem-rest-io', type: 'pipeline', id: 'cisco_asa' });
    expect(parseConfigPath('groups/default/local/my_pack/inputs.yml')).toEqual({
      group: 'default',
      pack: 'my_pack',
      type: 'source',
    });
  });

  it("does not mistake a group named 'default' for a pack", () => {
    expect(parseConfigPath('groups/default/local/cribl/inputs.yml')).toEqual({ group: 'default', type: 'source' });
    expect(parseConfigPath('groups/default/default/cribl/pipelines/main/conf.yml')).toEqual({
      group: 'default',
      type: 'pipeline',
      id: 'main',
    });
  });

  it('maps shared per-group files to a type without an id', () => {
    // The routing table lives at `pipelines/route.yml` (verified against a live Leader).
    expect(parseConfigPath('groups/staging/local/cribl/pipelines/route.yml')).toEqual({ group: 'staging', type: 'route' });
    expect(parseConfigPath('groups/prod/local/cribl/inputs.yml')).toEqual({ group: 'prod', type: 'source' });
    expect(parseConfigPath('groups/prod/local/cribl/outputs.yml')).toEqual({ group: 'prod', type: 'destination' });
  });

  it('maps a shared file inside a pack to the pack scope', () => {
    expect(
      parseConfigPath('groups/prod/local/cribl/packs/security_pack/default/cribl/pipelines/route.yml'),
    ).toEqual({ group: 'prod', pack: 'security_pack', type: 'route' });
  });

  it('maps a lookup file (under data/lookups) to its filename id', () => {
    expect(parseConfigPath('groups/prod/data/lookups/geo_city.csv')).toEqual({
      group: 'prod',
      type: 'lookup',
      id: 'geo_city.csv',
    });
  });

  it('returns null for a Leader-level file with no group prefix, and unrelated paths', () => {
    expect(parseConfigPath('local/cribl/groups.yml')).toBeNull();
    expect(parseConfigPath('README.md')).toBeNull();
  });
});

describe('parseConfigPath — library objects', () => {
  it('maps per-object library files to the specific object id', () => {
    // A schema edit touches schemas/<id>.json (verified against a live commit).
    expect(parseConfigPath('groups/default/local/cribl/schemas/cribl_internal.json')).toEqual({ group: 'default', type: 'schema', id: 'cribl_internal' });
    expect(parseConfigPath('groups/default/local/cribl/parquet-schemas/sample_nested.json')).toEqual({ group: 'default', type: 'parquet-schema', id: 'sample_nested' });
    expect(parseConfigPath('groups/default/local/cribl/grok-patterns/aws')).toEqual({ group: 'default', type: 'grok', id: 'aws' });
    expect(parseConfigPath('groups/default_search/data/protobuf-libraries/opentelemetry/lib/x.proto')).toEqual({ group: 'default_search', type: 'protobuf', id: 'opentelemetry' });
  });

  it('maps shared library tables to their type (no id — the diff walk narrows it)', () => {
    const cases: [string, KOType][] = [
      ['regexes', 'regex'],
      ['parsers', 'parser'],
      ['breakers', 'event-breaker'],
      ['appscope', 'appscope'],
      ['vars', 'variable'],
      ['sds-rules', 'sds-rule'],
      ['sds-rulesets', 'sds-ruleset'],
      ['database-connections', 'db-connection'],
    ];
    for (const [file, type] of cases) {
      expect(parseConfigPath(`groups/prod/local/cribl/${file}.yml`)).toEqual({ group: 'prod', type });
    }
  });

  it('maps per-object and shared library files inside a pack to the pack scope', () => {
    expect(parseConfigPath('groups/default/default/cribl-crowdstrike-ngsiem-rest-io/schemas/my_schema.json')).toEqual({
      group: 'default',
      pack: 'cribl-crowdstrike-ngsiem-rest-io',
      type: 'schema',
      id: 'my_schema',
    });
    expect(parseConfigPath('groups/default/default/cribl-crowdstrike-ngsiem-rest-io/vars.yml')).toEqual({
      group: 'default',
      pack: 'cribl-crowdstrike-ngsiem-rest-io',
      type: 'variable',
    });
  });

  it('leaves the schemas.yml / parquet-schemas.yml registries unmapped (per-object files attribute those)', () => {
    expect(parseConfigPath('groups/default/local/cribl/schemas.yml')).toBeNull();
    expect(parseConfigPath('groups/default/local/cribl/parquet-schemas.yml')).toBeNull();
  });

  it('does not confuse sds-rules with sds-rulesets', () => {
    expect(parseConfigPath('groups/prod/local/cribl/sds-rulesets.yml')).toEqual({ group: 'prod', type: 'sds-ruleset' });
    expect(parseConfigPath('groups/prod/local/cribl/sds-rules.yml')).toEqual({ group: 'prod', type: 'sds-rule' });
  });
});

describe('buildFileMapper', () => {
  it('maps a pipeline directory to its single record key', async () => {
    const mapper = buildFileMapper(await records());
    expect(mapper('groups/prod/local/cribl/pipelines/web_logs/conf.yml')).toEqual(['prod/-/pipeline/web_logs']);
  });

  it('maps a pack pipeline to its pack-scoped key', async () => {
    const mapper = buildFileMapper(await records());
    expect(
      mapper('groups/prod/local/cribl/packs/security_pack/default/cribl/pipelines/pack_detect/conf.yml'),
    ).toEqual(['prod/security_pack/pipeline/pack_detect']);
  });

  it('maps a shared file to every record of that type in the group', async () => {
    const mapper = buildFileMapper(await records());
    expect(mapper('groups/prod/local/cribl/inputs.yml')).toEqual([
      'prod/-/source/splunk_in',
      'prod/-/source/dead_input',
      'prod/-/source/pp_input',
    ]);
    expect(mapper('groups/staging/local/cribl/pipelines/route.yml')).toEqual(['staging/-/route/sr1']);
  });

  it('maps a pack shared file to the pack-scoped records of that type', async () => {
    const mapper = buildFileMapper(await records());
    expect(
      mapper('groups/prod/local/cribl/packs/security_pack/default/cribl/pipelines/route.yml'),
    ).toEqual(['prod/security_pack/route/pr1']);
  });

  it('returns no keys for an unknown object or path', async () => {
    const mapper = buildFileMapper(await records());
    expect(mapper('groups/prod/local/cribl/pipelines/does_not_exist/conf.yml')).toEqual([]);
    expect(mapper('unrelated/file.txt')).toEqual([]);
  });

  it('maps a per-object library file to its single record key', () => {
    const mapper = buildFileMapper([lib('default', 'schema', 'cribl_internal'), lib('default', 'schema', 'sample_schema')]);
    expect(mapper('groups/default/local/cribl/schemas/cribl_internal.json')).toEqual(['default/-/schema/cribl_internal']);
    expect(mapper('groups/default/local/cribl/grok-patterns/aws')).toEqual([]); // no such grok record
  });

  it('maps a shared library table to every record of that type in scope', () => {
    const mapper = buildFileMapper([lib('default', 'regex', 'r1'), lib('default', 'regex', 'r2'), lib('default', 'parser', 'p1')]);
    expect(mapper('groups/default/local/cribl/regexes.yml').sort()).toEqual(['default/-/regex/r1', 'default/-/regex/r2']);
    expect(mapper('groups/default/local/cribl/parsers.yml')).toEqual(['default/-/parser/p1']);
  });

  it('maps both a lookup data file and its .yml metadata sidecar to the same lookup record', () => {
    // A lookup is two files on disk: `<name>.csv` (data) and `<name>.yml` (metadata, incl. the
    // description); the record id is the `.csv` name. An edit to EITHER — verified against the
    // real Leader, where editing a description touches only the `.yml` — must attribute to the
    // lookup, so "Recently changed" and its History include description edits.
    const mapper = buildFileMapper([lib('default', 'lookup', 'model_relative_entropy_top_domains.csv')]);
    const key = ['default/-/lookup/model_relative_entropy_top_domains.csv'];
    expect(mapper('groups/default/data/lookups/model_relative_entropy_top_domains.csv')).toEqual(key);
    expect(mapper('groups/default/data/lookups/model_relative_entropy_top_domains.yml')).toEqual(key);
  });
});
