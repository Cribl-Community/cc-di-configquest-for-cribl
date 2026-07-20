// Hygiene findings, derived from the environment graph (graph.ts) — no new API
// calls. Orphaned pipelines and dangling routes read the graph's edges and
// dangling references; unused lookups use the flattened searchText signal (to
// catch C.Lookup() expressions the graph's typed edges don't); disabled is a
// record-level scan.

import { makeFinding, type DanglingRef, type Finding, type FindingsReport, type Graph, type KORecord } from './types';
import { BUILTIN_PIPELINES, buildGraph, functionsOf } from './graph';

export interface CrossrefOptions {
  /** Scope keys (`group/pack`) whose fetch had a data hole (a core endpoint failed). Their
   *  structural findings are suppressed — a route can't be called dangling when the pipeline
   *  it points at may simply have failed to load. */
  unreliableScopes?: Set<string>;
}

export function crossref(records: KORecord[], graph: Graph = buildGraph(records), opts: CrossrefOptions = {}): FindingsReport {
  const unreliable = opts.unreliableScopes ?? new Set<string>();
  const reliable = (r: KORecord) => !unreliable.has(scopeOf(r));
  // A group is unreliable if any of its scopes (group or a pack) had a hole; lookup usage is
  // aggregated across the whole group, so it must be suppressed at group granularity.
  const unreliableGroups = new Set<string>([...unreliable].map((s) => s.split('/')[0]));
  return {
    orphanedPipelines: detectOrphanedPipelines(records, graph, reliable),
    danglingRoutes: detectDanglingRoutes(records, graph, reliable),
    unusedLookups: detectUnusedLookups(records, unreliableGroups),
    disabled: detectDisabled(records),
    staleObjects: [], // populated by the age index in Phase 3
  };
}

function detectOrphanedPipelines(records: KORecord[], graph: Graph, reliable: (r: KORecord) => boolean): Finding[] {
  const out: Finding[] = [];
  for (const r of records) {
    if (r.type !== 'pipeline' || BUILTIN_PIPELINES.has(r.id) || !reliable(r)) continue;
    // Any in-edge (route/source/destination/chain/quickconnect) is a reference.
    if ((graph.in.get(r.key)?.length ?? 0) > 0) continue;
    out.push(makeFinding('orphaned-pipeline', r, 'No Route, Source, Destination, or Chain references this pipeline'));
  }
  return out;
}

function detectDanglingRoutes(records: KORecord[], graph: Graph, reliable: (r: KORecord) => boolean): Finding[] {
  const refsByRoute = new Map<string, DanglingRef[]>();
  for (const d of graph.danglingRefs) {
    const list = refsByRoute.get(d.from);
    if (list) list.push(d);
    else refsByRoute.set(d.from, [d]);
  }

  const out: Finding[] = [];
  for (const route of records) {
    if (route.type !== 'route' || !reliable(route)) continue;
    const refs = refsByRoute.get(route.key);
    if (!refs || refs.length === 0) continue;
    // A missing pipeline takes priority over a missing Destination (one finding per route).
    const chosen = refs.find((d) => d.kind === 'route-pipeline') ?? refs[0];
    const detail =
      chosen.kind === 'route-pipeline'
        ? `References missing pipeline: ${chosen.missing}`
        : `References missing Destination: ${chosen.missing}`;
    out.push(makeFinding('dangling-route', route, detail));
  }
  return out;
}

function detectUnusedLookups(records: KORecord[], unreliableGroups: Set<string>): Finding[] {
  // A lookup is "used" if its filename appears anywhere in a pipeline's flattened config —
  // catching both the Lookup function's `file` field and `C.Lookup('file')` expressions.
  // Aggregated by GROUP (not group/pack), so a group lookup read only by a pack pipeline —
  // or vice versa — isn't falsely flagged unused across the scope boundary.
  const pipelineTextByGroup = new Map<string, string>();
  for (const r of records) {
    if (r.type !== 'pipeline') continue;
    pipelineTextByGroup.set(r.group, `${pipelineTextByGroup.get(r.group) ?? ''}\n${r.searchText.join('\n')}`);
  }

  const out: Finding[] = [];
  for (const r of records) {
    if (r.type !== 'lookup' || unreliableGroups.has(r.group)) continue;
    const blob = pipelineTextByGroup.get(r.group) ?? '';
    if (!blob.includes(r.id)) out.push(makeFinding('unused-lookup', r, 'Referenced by no pipeline'));
  }
  return out;
}

function detectDisabled(records: KORecord[]): Finding[] {
  const out: Finding[] = [];
  for (const r of records) {
    if ((r.type === 'source' || r.type === 'destination' || r.type === 'route') && r.disabled) {
      out.push(makeFinding('disabled', r, `Disabled ${r.type}`));
    } else if (r.type === 'pipeline') {
      const disabledFns = functionsOf(r).filter((fn) => fn['disabled'] === true).length;
      if (disabledFns > 0) {
        out.push(makeFinding('disabled', r, `${disabledFns} disabled function${disabledFns > 1 ? 's' : ''}`));
      }
    }
  }
  return out;
}

// --- helpers ---------------------------------------------------------------

function scopeOf(r: KORecord): string {
  return `${r.group}/${r.pack ?? '-'}`;
}
