import { describe, it, expect } from 'vitest';
import { parseUrl, encodeUrl, emptyUrlState, DEFAULT_SORT } from './useUrlState';
import { emptyFilters } from '../data/types';

// The view signature the hook uses to decide push vs replace: search, filters, and sort are
// held at their defaults so a change to any of them replaces rather than stacking history.
const navSig = (search: string) => encodeUrl({ ...parseUrl(search), q: '', filters: emptyFilters(), sort: DEFAULT_SORT });

describe('parseUrl / encodeUrl — Overview is the default, Browse is explicit', () => {
  it('treats an empty URL as Overview (not Browse), consistently', () => {
    const s = parseUrl('');
    expect(s.overview).toBe(true);
    expect(s.browse).toBe(false);
    // …and Overview encodes back to an empty query (it carries no marker of its own).
    expect(encodeUrl({ ...emptyUrlState(), overview: true })).toBe('');
  });

  it('round-trips Browse through an explicit marker', () => {
    expect(encodeUrl({ ...emptyUrlState(), browse: true })).toBe('browse=1');
    const s = parseUrl('browse=1');
    expect(s.browse).toBe(true);
    expect(s.overview).toBe(false); // Browse is not Overview — reload/Back stay on Browse
  });

  it('a selected page (or the Compare overlay) turns Overview off', () => {
    expect(parseUrl('settings=1').overview).toBe(false);
    expect(parseUrl('commits=1').overview).toBe(false);
    expect(parseUrl('compare=a,b').overview).toBe(false);
  });
});

describe('table sort round-trips through the URL', () => {
  it('serializes a non-default sort as col.dir and omits the default', () => {
    expect(encodeUrl({ ...emptyUrlState(), sort: { col: 'modified', dir: 'desc' } })).toBe('sort=modified.desc');
    expect(encodeUrl({ ...emptyUrlState(), sort: DEFAULT_SORT })).toBe(''); // default → no param
    expect(parseUrl('sort=modified.desc').sort).toEqual({ col: 'modified', dir: 'desc' });
  });

  it('falls back to the default sort for an unknown column', () => {
    expect(parseUrl('sort=bogus.desc').sort).toEqual(DEFAULT_SORT);
  });

  it('parses an explicit ascending direction and a bare column (no direction)', () => {
    expect(parseUrl('sort=name.asc').sort).toEqual({ col: 'name', dir: 'asc' });
    expect(parseUrl('sort=name').sort).toEqual({ col: 'name', dir: 'asc' });
  });
});

describe('view signature (push vs replace)', () => {
  it('ignores search, filters, and sort — they refine the view, not navigate', () => {
    expect(navSig('browse=1&q=abc')).toBe(navSig('browse=1'));
    expect(navSig('browse=1&types=regex')).toBe(navSig('browse=1'));
    expect(navSig('browse=1&sort=name.desc')).toBe(navSig('browse=1'));
  });

  it('distinguishes actual destinations (so Back walks view history)', () => {
    expect(navSig('')).not.toBe(navSig('browse=1')); // Overview vs Browse
    expect(navSig('browse=1')).not.toBe(navSig('commits=1'));
    expect(navSig('browse=1')).not.toBe(navSig('browse=1&asset=default/-/regex/r1')); // opening an object
  });
});
