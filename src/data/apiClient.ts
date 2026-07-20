// Thin fetch wrapper with an injectable transport, so the data layer can be
// driven by fixtures in tests and during backend-free UI development.
//
// IMPORTANT: nothing here touches `window` at module load — the default
// transport reads `window.CRIBL_API_URL` inside the function body so this
// module imports cleanly under Node/Vitest.

import { ApiError } from './types';

export type Transport = (path: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  transport?: Transport;
  signal?: AbortSignal;
}

/** Default transport: real `fetch` against the platform-injected API base. */
export function defaultTransport(path: string, init?: RequestInit): Promise<Response> {
  const base = (typeof window !== 'undefined' && window.CRIBL_API_URL) || '';
  return fetch(base + path, init);
}

/** GET a JSON resource, normalizing every failure mode to an ApiError. */
export async function apiGet<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const transport = opts.transport ?? defaultTransport;
  let res: Response;
  try {
    res = await transport(path, { signal: opts.signal });
  } catch (err) {
    if (isAbort(err)) {
      throw new ApiError('abort', `Request aborted: ${path}`);
    }
    throw new ApiError('network', `Network error for ${path}: ${errText(err)}`);
  }
  if (!res.ok) {
    throw new ApiError('http', `HTTP ${res.status} for ${path}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ApiError('parse', `Malformed JSON for ${path}: ${errText(err)}`);
  }
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'AbortError'
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
