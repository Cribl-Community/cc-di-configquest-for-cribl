// Helpers over the App Platform KV store. Values are opaque strings, so we
// JSON.stringify on write and JSON.parse on read (see AGENTS.md). Reading a
// key that does not exist yet returns null rather than throwing.
//
// The same injectable Transport used by the API client is accepted here so KV
// behavior is testable without a live backend.
//
// The store is app-scoped: `/a/<appId>/kvstore/<key>` on the Leader (see the note
// in config/policies.yml). It is server-side and SHARED across every user of the
// app — a setting one admin changes persists for everyone. Keys may not contain a
// ':' (it breaks the platform's path routing), so a caller's `scope:name` key maps
// to `scope.name` in the URL.
//
// A same-browser localStorage mirror is a resilience fallback only: a live read
// from the shared store always wins, so localStorage never masks another user's
// change — it just bridges a transient KV outage. Large values (the index snapshot)
// mirror best-effort and are skipped on a quota error.

import { defaultTransport, type Transport } from './data/apiClient';

const LS_PREFIX = 'configquest:';

// The App Platform KV store rejects a value larger than ~100 KB on the Leader (measured: a
// ~100 KB PUT 413s while ~97 KB succeeds). Any value that can outgrow this — the index
// snapshot, the age map — MUST be split into pieces each under this budget, or the write
// 413s, the caller's version marker never advances, and the app cold-rebuilds on every open
// instead of loading the cache. Kept well under the observed cap to leave room for the
// enclosing array and UTF-8 expansion.
export const KV_VALUE_MAX_BYTES = 80_000;

/** Exact UTF-8 byte length of a string. The HTTP body is UTF-8, but String.length counts
 *  UTF-16 code units — multibyte config (a regex, a masked secret) would undercount, and a
 *  chunk sized by length could still 413. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** The app-scoped KV URL for a key. ':' in the key is mapped to '.' (colons break
 *  the platform's route matching). */
function kvPath(key: string): string {
  return `/a/${resolveAppId().id}/kvstore/${key.replace(/:/g, '.')}`;
}

/** The app's id, needed for the app-scoped KV path. Prefer the injected
 *  `window.CRIBL_APP_ID`; if the platform didn't set it, derive it from the app's
 *  own mount path (the app is served under `/a/<id>/…` or `/app-ui/<id>/…`), which
 *  is always visible to the iframe.
 *
 *  Cribl reports the dev-flavored id `__dev__<name>` via CRIBL_APP_ID even for an
 *  installed app, but the KV store is enforced under the plain installed id — a
 *  `__dev__configquest` URL is refused as cross-app access. Strip the prefix so the
 *  path targets the real store. Returns the source too, for the diagnostics UI. */
function resolveAppId(): { id: string; source: string } {
  const raw = rawAppId();
  const id = raw.id.replace(/^__dev__/, '');
  return { id, source: id !== raw.id ? `${raw.source} (stripped __dev__)` : raw.source };
}

function rawAppId(): { id: string; source: string } {
  if (typeof window === 'undefined') return { id: '', source: 'none' };
  if (window.CRIBL_APP_ID) return { id: window.CRIBL_APP_ID, source: 'CRIBL_APP_ID' };
  const fromBase = matchAppId(window.CRIBL_BASE_PATH || '');
  if (fromBase) return { id: fromBase, source: 'CRIBL_BASE_PATH' };
  const fromLoc = matchAppId((window.location && window.location.pathname) || '');
  if (fromLoc) return { id: fromLoc, source: 'location' };
  return { id: '', source: 'unresolved' };
}

function matchAppId(path: string): string | undefined {
  return (/\/a\/([^/]+)/.exec(path) ?? /\/app-ui\/([^/]+)/.exec(path))?.[1];
}

/** Read and parse a JSON value; returns null on any "no data yet" condition. */
export async function getJSON<T>(
  key: string,
  transport: Transport = defaultTransport,
): Promise<T | null> {
  const remote = await getRemote<T>(key, transport);
  if (remote !== null) return remote;
  return getLocal<T>(key); // KV absent/empty — fall back to browser storage
}

/** Serialize and write a value to both stores, reporting each independently. Callers that
 *  persist SHARED state (the index snapshot, the age map) must gate validity on `remoteOk`
 *  alone: the localStorage mirror is per-browser, so a refused remote write that localStorage
 *  happens to accept must NOT be mistaken for a successful shared write. */
export async function setJSONDetailed(
  key: string,
  value: unknown,
  transport: Transport = defaultTransport,
): Promise<{ remoteOk: boolean; localOk: boolean }> {
  const remoteOk = await setRemote(key, value, transport);
  const localOk = setLocal(key, value);
  return { remoteOk, localOk };
}

/** Serialize and write a value. Returns whether either store accepted it — appropriate for
 *  per-user state (theme, settings) where the localStorage mirror is a fine fallback. */
export async function setJSON(
  key: string,
  value: unknown,
  transport: Transport = defaultTransport,
): Promise<boolean> {
  const { remoteOk, localOk } = await setJSONDetailed(key, value, transport);
  return remoteOk || localOk;
}

/** Split items into chunks whose serialized array each stays under `maxBytes` (a single
 *  oversized item still gets its own chunk). Sizing counts UTF-8 bytes, including the commas
 *  and brackets of the array the chunk is stored as. */
export function chunkItemsBySize<T>(items: T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let bytes = 2; // the enclosing `[]`
  for (const it of items) {
    const size = byteLength(JSON.stringify(it)) + 1; // + the joining comma
    if (cur.length > 0 && bytes + size > maxBytes) {
      chunks.push(cur);
      cur = [];
      bytes = 2;
    }
    cur.push(it);
    bytes += size;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Persist an array that may exceed the per-value cap as byte-bounded chunks (`<key>:0…n-1`)
 *  under a `<key>` manifest recording the count. Like the snapshot, validity is gated on the
 *  REMOTE store: returns false if any chunk or the manifest fails to persist there, so a
 *  caller's version marker stays invalid rather than trusting a write the mirror alone took. */
export async function setChunkedArray<T>(
  key: string,
  items: T[],
  transport: Transport = defaultTransport,
): Promise<boolean> {
  const chunks = chunkItemsBySize(items, KV_VALUE_MAX_BYTES);
  let remoteOk = true;
  for (let i = 0; i < chunks.length; i += 1) {
    if (!(await setJSONDetailed(`${key}:${i}`, chunks[i], transport)).remoteOk) remoteOk = false;
  }
  if (!(await setJSONDetailed(key, { chunks: chunks.length }, transport)).remoteOk) remoteOk = false;
  return remoteOk;
}

/** Read an array written by `setChunkedArray`, or null if the manifest or any chunk is
 *  absent (an incomplete write must read as "no value", never a spliced partial). */
export async function getChunkedArray<T>(
  key: string,
  transport: Transport = defaultTransport,
): Promise<T[] | null> {
  const manifest = await getJSON<{ chunks?: number }>(key, transport);
  if (!manifest || typeof manifest.chunks !== 'number') return null;
  const out: T[] = [];
  for (let i = 0; i < manifest.chunks; i += 1) {
    const chunk = await getJSON<T[]>(`${key}:${i}`, transport);
    if (!Array.isArray(chunk)) return null;
    out.push(...chunk);
  }
  return out;
}

async function getRemote<T>(key: string, transport: Transport): Promise<T | null> {
  let res: Response;
  try {
    res = await transport(kvPath(key));
  } catch {
    return null;
  }
  if (!res.ok) return null; // includes 404 for a key never written / a store not exposed
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function setRemote(key: string, value: unknown, transport: Transport): Promise<boolean> {
  try {
    const res = await transport(kvPath(key), {
      method: 'PUT',
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getLocal<T>(key: string): T | null {
  const ls = browserStore();
  if (!ls) return null;
  try {
    const text = ls.getItem(LS_PREFIX + key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null; // unparseable
  }
}

function setLocal(key: string, value: unknown): boolean {
  const ls = browserStore();
  if (!ls) return false;
  try {
    ls.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // over quota (e.g. a large index snapshot) or write-blocked
  }
}

/** localStorage when reachable (a browser/iframe), else null (Node tests, or a
 *  sandboxed iframe with storage access denied). */
function browserStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface KvDiagnostics {
  appId: string;
  appIdSource: string;
  apiBase: string;
  localStorage: boolean;
  /** Result of a live write→read→delete against the shared store. */
  shared: { ok: boolean; detail: string };
}

/** Probe the persistence layer for the Settings "Storage" panel: the resolved app
 *  id (and where it came from), the API base, whether localStorage is usable, and a
 *  live round-trip against the shared KV store. Writes and deletes a throwaway key. */
export async function kvDiagnostics(transport: Transport = defaultTransport): Promise<KvDiagnostics> {
  const { id, source } = resolveAppId();
  const apiBase = (typeof window !== 'undefined' && window.CRIBL_API_URL) || '(none)';
  return {
    appId: id || '(empty)',
    appIdSource: source,
    apiBase,
    localStorage: browserStore() !== null,
    shared: await selfTest(transport),
  };
}

async function selfTest(transport: Transport): Promise<{ ok: boolean; detail: string }> {
  const key = 'diag:selftest';
  const nonce = Math.random().toString(36).slice(2);
  try {
    const put = await transport(kvPath(key), { method: 'PUT', body: JSON.stringify({ nonce }) });
    if (!put.ok) return { ok: false, detail: `write refused (HTTP ${put.status})` };
    const get = await transport(kvPath(key));
    if (!get.ok) return { ok: false, detail: `read-back refused (HTTP ${get.status})` };
    let back: string | undefined;
    try {
      back = (JSON.parse(await get.text()) as { nonce?: string }).nonce;
    } catch {
      return { ok: false, detail: 'read-back returned malformed data' };
    }
    void transport(kvPath(key), { method: 'DELETE' }).catch(() => {});
    return back === nonce ? { ok: true, detail: 'connected' } : { ok: false, detail: 'value did not round-trip' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
