// The environment graph: resolve every config reference into a typed directed
// edge between existing records (scoped by `${group}/${pack}`), plus the
// references that don't resolve (dangling). Hygiene findings, coverage analysis,
// and the lineage view all read from this one model.

import type { DanglingRef, EdgeKind, Graph, GraphEdge, KORecord, KOType } from './types';
import { asRecord, bool, str } from './raw';

// Cribl ships these implicitly (verified against a live Leader); referencing
// them is never dangling.
export const BUILTIN_PIPELINES = new Set(['main', 'devnull', 'passthru']);
export const BUILTIN_OUTPUTS = new Set(['default', 'devnull']);

export function buildGraph(records: KORecord[]): Graph {
  const keySet = new Set(records.map((r) => r.key));
  const routesByScope = new Map<string, KORecord[]>();
  for (const r of records) {
    if (r.type === 'route') pushAdj(routesByScope, scopeOf(r), r);
  }

  const edges: GraphEdge[] = [];
  const danglingRefs: DanglingRef[] = [];

  /** Add an edge if the target resolves to an existing record; return whether it did. */
  const link = (from: string, scope: string, type: KOType, id: string | undefined, kind: EdgeKind): boolean => {
    if (!id) return false;
    const to = `${scope}/${type}/${id}`;
    if (!keySet.has(to)) return false;
    edges.push({ from, to, kind });
    return true;
  };

  for (const r of records) {
    const scope = scopeOf(r);
    const raw = rawOf(r);
    switch (r.type) {
      case 'source':
        link(r.key, scope, 'pipeline', str(raw, 'pipeline'), 'source-pipeline');
        link(r.key, scope, 'destination', str(raw, 'output'), 'source-output');
        if (bool(raw, 'sendToRoutes') === true) {
          for (const route of routesByScope.get(scope) ?? []) {
            edges.push({ from: r.key, to: route.key, kind: 'source-route' });
          }
        }
        for (const conn of connectionsOf(raw)) {
          link(r.key, scope, 'pipeline', str(conn, 'pipeline'), 'quickconnect');
          link(r.key, scope, 'destination', str(conn, 'output'), 'quickconnect');
        }
        break;
      case 'route': {
        const pipeline = str(raw, 'pipeline');
        // A Route can send traffic into an installed Pack instead of a pipeline; the Leader
        // stores this as `pipeline: pack:<packId>`. Packs live at group scope, so resolve the
        // pack there (not the route's own scope). linkBuilder.ts knows the same `pack:` form.
        const packRef = pipeline?.startsWith('pack:') ? pipeline.slice('pack:'.length) : undefined;
        if (packRef !== undefined) {
          if (!link(r.key, `${r.group}/-`, 'pack', packRef, 'route-pack')) {
            danglingRefs.push({ from: r.key, kind: 'route-pipeline', missing: pipeline!, targetType: 'pipeline' });
          }
        } else if (!link(r.key, scope, 'pipeline', pipeline, 'route-pipeline') && pipeline && !BUILTIN_PIPELINES.has(pipeline)) {
          danglingRefs.push({ from: r.key, kind: 'route-pipeline', missing: pipeline, targetType: 'pipeline' });
        }
        // A dynamically-expressed Destination is not a dangling reference.
        if (bool(raw, 'enableOutputExpression') !== true) {
          const output = str(raw, 'output');
          if (!link(r.key, scope, 'destination', output, 'route-output') && output && !BUILTIN_OUTPUTS.has(output)) {
            danglingRefs.push({ from: r.key, kind: 'route-output', missing: output, targetType: 'destination' });
          }
        }
        break;
      }
      case 'pipeline':
        for (const fn of functionsOf(r)) {
          const conf = asRecord(fn['conf']);
          if (!conf) continue;
          if (fn['id'] === 'chain') {
            link(r.key, scope, 'pipeline', str(conf, 'pipeline') ?? str(conf, 'processor'), 'chain');
          } else if (fn['id'] === 'lookup') {
            link(r.key, scope, 'lookup', str(conf, 'file'), 'lookup');
          }
        }
        break;
      case 'destination':
        link(r.key, scope, 'pipeline', str(raw, 'pipeline'), 'dest-pipeline');
        break;
      // lookups and packs make no outgoing references
    }
  }

  const out = new Map<string, GraphEdge[]>();
  const inbound = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    pushAdj(out, e.from, e);
    pushAdj(inbound, e.to, e);
  }
  return { edges, out, in: inbound, danglingRefs };
}

/** Edges reachable downstream of `key` (following `to`), depth-bounded for lineage. */
export function downstream(graph: Graph, key: string, maxDepth = Infinity): GraphEdge[] {
  return traverse(graph.out, key, maxDepth, (e) => e.to);
}

/** Edges reachable upstream of `key` (following `from`), depth-bounded for lineage. */
export function upstream(graph: Graph, key: string, maxDepth = Infinity): GraphEdge[] {
  return traverse(graph.in, key, maxDepth, (e) => e.from);
}

/** Pipeline functions as plain records (shared with crossref). */
export function functionsOf(pipeline: KORecord): Record<string, unknown>[] {
  const conf = asRecord(rawOf(pipeline)['conf']);
  const fns = conf?.['functions'];
  if (!Array.isArray(fns)) return [];
  return fns.map(asRecord).filter((f): f is Record<string, unknown> => f !== null);
}

// --- helpers ---------------------------------------------------------------

function traverse(
  adj: Map<string, GraphEdge[]>,
  start: string,
  maxDepth: number,
  nextOf: (e: GraphEdge) => string,
): GraphEdge[] {
  const seen = new Set<string>([start]);
  const collected: GraphEdge[] = [];
  let frontier = [start];
  for (let depth = 0; frontier.length > 0 && depth < maxDepth; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const e of adj.get(node) ?? []) {
        collected.push(e);
        const nxt = nextOf(e);
        if (!seen.has(nxt)) {
          seen.add(nxt);
          next.push(nxt);
        }
      }
    }
    frontier = next;
  }
  return collected;
}

function connectionsOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  const conns = raw['connections'];
  if (!Array.isArray(conns)) return [];
  return conns.map(asRecord).filter((c): c is Record<string, unknown> => c !== null);
}

function scopeOf(r: KORecord): string {
  return `${r.group}/${r.pack ?? '-'}`;
}

function rawOf(r: KORecord): Record<string, unknown> {
  return asRecord(r.raw) ?? {};
}

function pushAdj<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
