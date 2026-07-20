// Small typed accessors for walking `unknown` API payloads. Shared by the
// modules that parse raw Cribl responses (normalize, fetchOrg, crossref, git).

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extract the `items` array from a `{ count?, items }` list envelope. */
export function itemsOf(payload: unknown): unknown[] {
  const items = asRecord(payload)?.['items'];
  return Array.isArray(items) ? items : [];
}

export function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}
