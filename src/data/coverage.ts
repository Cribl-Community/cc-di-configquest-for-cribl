// Operational coverage findings from the environment graph — objects that are
// configured but not wired into a working data path. Deliberately conservative
// (config-only, no runtime): it should never cry wolf.

import { makeFinding, type CoverageReport, type Finding, type Graph, type KORecord } from './types';
import { BUILTIN_OUTPUTS } from './graph';
import { asRecord, bool, str } from './raw';

export interface CoverageOptions {
  /** Scope keys (`group/pack`) with a fetch hole — their reachability findings are
   *  suppressed, since a source can't be judged dead-end when the routes/destinations it
   *  might feed may simply have failed to load. */
  unreliableScopes?: Set<string>;
}

export function coverage(records: KORecord[], graph: Graph, opts: CoverageOptions = {}): CoverageReport {
  const unreliable = opts.unreliableScopes ?? new Set<string>();
  const usable = records.filter((r) => !unreliable.has(`${r.group}/${r.pack ?? '-'}`));
  return {
    deadEndSources: detectDeadEndSources(usable),
    deadEndDestinations: detectDeadEndDestinations(usable, graph),
    unreachableRoutes: detectUnreachableRoutes(usable),
  };
}

/** How many objects depend on a record (fan-in) — used for blast-radius UI. */
export function blastRadius(graph: Graph, key: string): number {
  return graph.in.get(key)?.length ?? 0;
}

// An enabled Source that has explicitly opted out of routing and has no other
// outlet (`sendToRoutes` defaults to true, so only `false` counts as opting out).
function detectDeadEndSources(records: KORecord[]): Finding[] {
  const out: Finding[] = [];
  for (const r of records) {
    if (r.type !== 'source' || r.disabled) continue;
    const raw = asRecord(r.raw) ?? {};
    const optedOutOfRoutes = bool(raw, 'sendToRoutes') === false;
    const hasOutput = str(raw, 'output') !== undefined;
    const hasQuickConnect = connectionsOf(raw).some((c) => str(c, 'output') || str(c, 'pipeline'));
    if (optedOutOfRoutes && !hasOutput && !hasQuickConnect) {
      out.push(makeFinding('dead-end-source', r, 'Enabled but sends to no Route, Destination, or QuickConnect'));
    }
  }
  return out;
}

// An enabled Destination that no enabled Route or Source feeds. Built-in sinks
// (devnull/default) are exempt — they're expected to sit unused.
function detectDeadEndDestinations(records: KORecord[], graph: Graph): Finding[] {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const out: Finding[] = [];
  for (const r of records) {
    if (r.type !== 'destination' || r.disabled || BUILTIN_OUTPUTS.has(r.id)) continue;
    const fed = (graph.in.get(r.key) ?? []).some((e) => {
      if (e.kind !== 'route-output' && e.kind !== 'source-output' && e.kind !== 'quickconnect') return false;
      const origin = byKey.get(e.from);
      return !origin?.disabled;
    });
    if (!fed) out.push(makeFinding('dead-end-destination', r, 'No enabled Route or Source sends to this Destination'));
  }
  return out;
}

// Routes after an enabled `final` catch-all never fire. Filters are JS
// expressions, so we only claim the unambiguous catch-all case (`true`/empty).
// Relies on route records appearing in routing-table order within a scope
// (preserved by normalize).
function detectUnreachableRoutes(records: KORecord[]): Finding[] {
  const out: Finding[] = [];
  for (const routes of routesByScope(records).values()) {
    let shadowed = false;
    for (const route of routes) {
      if (shadowed) {
        if (!route.disabled) out.push(makeFinding('unreachable-route', route, 'Shadowed by an earlier final catch-all Route'));
        continue;
      }
      const raw = asRecord(route.raw) ?? {};
      const filter = str(raw, 'filter');
      const catchAll = filter === undefined || filter.trim() === 'true';
      if (!route.disabled && bool(raw, 'final') === true && catchAll) shadowed = true;
    }
  }
  return out;
}

function routesByScope(records: KORecord[]): Map<string, KORecord[]> {
  const map = new Map<string, KORecord[]>();
  for (const r of records) {
    if (r.type !== 'route') continue;
    const scope = `${r.group}/${r.pack ?? '-'}`;
    const list = map.get(scope);
    if (list) list.push(r);
    else map.set(scope, [r]);
  }
  return map;
}

function connectionsOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  const conns = raw['connections'];
  if (!Array.isArray(conns)) return [];
  return conns.map(asRecord).filter((c): c is Record<string, unknown> => c !== null);
}
