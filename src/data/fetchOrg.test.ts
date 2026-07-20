import { describe, it, expect } from 'vitest';
import { fetchOrg } from './fetchOrg';
import { normalizeOrg } from './normalize';
import { makeFixtureTransport } from './__fixtures__';

/** Every Worker Group the fixture org declares, sorted. */
const ALL_GROUPS = ['apac', 'dmz', 'eu_west', 'lab', 'prod', 'staging'];

describe('fetchOrg', () => {
  it('indexes every group when nothing is denied', async () => {
    const raw = await fetchOrg({ transport: makeFixtureTransport() });
    expect([...raw.report.indexedGroups].sort()).toEqual(ALL_GROUPS);
    expect(raw.report.skippedGroups).toEqual([]);
    // Packs are fetched in the second phase (across all groups); confirm they still land.
    expect(normalizeOrg(raw).some((r) => r.pack)).toBe(true);
  });

  it('degrades a denied group to partial results with a skippedGroups entry', async () => {
    const transport = makeFixtureTransport({ deny: (p) => p.startsWith('/m/staging') });
    const raw = await fetchOrg({ transport });

    expect([...raw.report.indexedGroups].sort()).toEqual(ALL_GROUPS.filter((g) => g !== 'staging'));
    expect(raw.report.skippedGroups).toEqual([{ group: 'staging', status: 403 }]);

    const records = normalizeOrg(raw);
    expect(records.some((r) => r.group === 'prod')).toBe(true);
    expect(records.some((r) => r.group === 'staging')).toBe(false);
  });

  it('treats 404 endpoints as empty rather than skipped', async () => {
    const transport = makeFixtureTransport({ notFound: (p) => p.startsWith('/m/staging') });
    const raw = await fetchOrg({ transport });

    expect([...raw.report.indexedGroups].sort()).toEqual(ALL_GROUPS);
    expect(raw.report.skippedGroups).toEqual([]);
    expect(normalizeOrg(raw).some((r) => r.group === 'staging')).toBe(false);
  });

  it('throws when Worker Group enumeration itself fails', async () => {
    const transport = makeFixtureTransport({ deny: (p) => p === '/products/stream/groups' });
    await expect(fetchOrg({ transport })).rejects.toMatchObject({ kind: 'http', status: 403 });
  });

  it('indexes a group even when a single endpoint is denied, and records the hole', async () => {
    const transport = makeFixtureTransport({ deny: (p) => p === '/m/prod/system/lookups' });
    const raw = await fetchOrg({ transport });

    expect(raw.report.skippedGroups).toEqual([]);
    expect([...raw.report.indexedGroups].sort()).toEqual(ALL_GROUPS);
    // A failed core endpoint is surfaced as a partial failure (not silently swallowed) so
    // downstream hygiene findings for the scope can be suppressed rather than fabricated.
    expect(raw.report.partialFailures).toEqual([{ group: 'prod', endpoints: ['system/lookups'], status: 403 }]);

    const records = normalizeOrg(raw);
    expect(records.some((r) => r.group === 'prod' && r.type === 'pipeline')).toBe(true);
    expect(records.some((r) => r.group === 'prod' && r.type === 'lookup')).toBe(false);
  });

  it('skips a group denied on all core endpoints even when its library endpoints only 404', async () => {
    // A caller with no access to prod's core objects, on a Leader that predates /lib/* (404).
    // Deciding "skipped" on core alone keeps the inaccessible group off the indexed list
    // instead of masquerading as indexed-but-empty.
    const transport = makeFixtureTransport({
      deny: (p) => p.startsWith('/m/prod/') && !p.includes('/lib/'),
      notFound: (p) => p.startsWith('/m/prod/lib/'),
    });
    const raw = await fetchOrg({ transport });

    expect(raw.report.skippedGroups).toEqual([{ group: 'prod', status: 403 }]);
    expect([...raw.report.indexedGroups].sort()).toEqual(ALL_GROUPS.filter((g) => g !== 'prod'));
    expect(raw.report.partialFailures).toEqual([]); // fully skipped, not partial
    expect(normalizeOrg(raw).some((r) => r.group === 'prod')).toBe(false);
  });

  it('does not record a partial failure when only library endpoints fail', async () => {
    // Library 404s (a Leader without /lib/*) drop inert leaves; they must not mark the scope
    // unreliable, since no structural finding depends on them.
    const transport = makeFixtureTransport({ notFound: (p) => p.startsWith('/m/prod/lib/') });
    const raw = await fetchOrg({ transport });

    expect(raw.report.skippedGroups).toEqual([]);
    expect(raw.report.partialFailures).toEqual([]);
    expect([...raw.report.indexedGroups].sort()).toEqual(ALL_GROUPS);
  });

  it('drops an inaccessible pack while keeping its group indexed', async () => {
    const transport = makeFixtureTransport({ deny: (p) => p.startsWith('/m/prod/p/security_pack') });
    const raw = await fetchOrg({ transport });

    expect(raw.report.skippedGroups).toEqual([]);
    const records = normalizeOrg(raw);
    expect(records.some((r) => r.pack === 'security_pack')).toBe(false);
    expect(records.some((r) => r.group === 'prod' && r.pack === undefined)).toBe(true);
  });

  it('records a pack-scoped partial failure when a single pack core endpoint is denied', async () => {
    // The pack analog of the group-partial case: one denied core endpoint keeps the pack indexed
    // but records the hole so its hygiene findings are suppressed rather than fabricated.
    const transport = makeFixtureTransport({ deny: (p) => p === '/m/prod/p/security_pack/routes' });
    const raw = await fetchOrg({ transport });

    expect(raw.report.skippedGroups).toEqual([]);
    expect(raw.report.partialFailures).toEqual([{ group: 'prod', pack: 'security_pack', endpoints: ['routes'], status: 403 }]);
    expect(normalizeOrg(raw).some((r) => r.pack === 'security_pack')).toBe(true); // still indexed
  });
});
