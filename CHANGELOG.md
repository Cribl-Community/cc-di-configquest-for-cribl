# Changelog

All notable changes to **Config Quest for Cribl** are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Config Quest for
Cribl is a read-only Cribl App Platform app: it reads configuration through the
platform-injected API and writes only to its own app storage.

## [1.0.0] - 2026-07-15

First release.

### Added

- **A unified index of your Cribl Stream configuration** across every Worker Group — core
  objects (pipelines, routes, sources, destinations, lookups, packs) and library (Knowledge)
  objects (event breakers, regexes, grok patterns, parsers, schemas, parquet schemas, data-scan
  rules and rulesets, protobuf libraries, AppScope configs, global variables, and database
  connections) — searchable, inventoried, and auditable in one place. The index is cached in the
  app's shared storage for near-instant reopens, and is built with bounded parallelism so even a
  deployment with many Worker Groups indexes quickly without overwhelming the Leader.
- **Full-text search** over object names, IDs, and the actual configuration values inside them,
  with `*` wildcards, across every Worker Group at once.
- **Browse and filter** the whole inventory as a table — by type, Worker Group, pack, flags,
  state, health, and who last modified it — with CSV export. Every filter starts with all values
  selected and offers an "only" shortcut to isolate one; clearing the last value restores them
  all. The filter checklists are fully keyboard- and screen-reader-operable, and a filter that
  offers only one value (which can never narrow) is hidden.
- **Configuration hygiene** findings: unreferenced pipelines, unresolved and unreachable routes,
  unused lookups, dead-end sources and destinations, and disabled or stale objects — each with a
  configurable severity tier (critical, warning, or advisory). Findings for a Worker Group whose
  data could not fully load are suppressed rather than fabricated from the gap, a Route into an
  installed Pack is recognized rather than flagged as broken, and an unused-lookup finding
  respects Worker Group and pack scope boundaries.
- **Operational health** per object, where the Leader exposes it.
- **Change history**, git-backed, for every object type including library objects: the
  last-changed date, who actually made that change (the acting user, not the "Cribl System"
  service account), and per-object diffs, plus a recent-activity feed. Changes made in shared
  configuration files — and edits to a lookup's separate `.yml` metadata, such as its
  description — are attributed to the specific object that changed.
- **A "Created" date for every object**, even one git has no edit for (a shipped data-scan rule,
  a pack's bundled objects): the earliest commit that added its file, or the pack-install /
  group-creation commit. It is labelled "Created" (marked with ~ in the table), attributed to
  whoever set it up (a pack you installed shows you; Cribl-shipped defaults show "Cribl System"),
  and — not being an edit — is kept out of the recent-changes feed and the stale-object check.
- **Overview** — an at-a-glance operator readout of hygiene, inventory, health, recently
  changed objects, and recent commits, with every card drilling into a filtered view.
- **Compare** any two objects of the same type, setting by setting; lookups compare by a
  content summary (size, row and column counts, and whether they are identical).
- **Commits** — browse the environment's full change log, filter it by message, author, or hash,
  and open any commit to see everything it changed, file by file.
- **Differences across Worker Groups** — pick one object and compare it as a
  settings-by-groups matrix: every group an equal-width column, every setting a row, and each
  value that departs from the majority highlighted. The whole configuration is shown, not
  only the settings that drift, so what matches reads as clearly as what doesn't — and the
  view stays useful even when a group is identical everywhere. Type and Worker Group filters
  narrow which objects you can pick — Worker Group also scopes which groups the comparison
  covers — and a Settings filter narrows the rows once an object is chosen.
- **Open in Cribl** — jump from any object straight to it in the Cribl Leader UI, including
  Knowledge objects and objects inside packs.
- **Shareable, bookmarkable views.** The current view — search, filters, table sort, open
  object, and page — lives in the URL, so any state can be shared or bookmarked, reloading or
  pressing Back lands on the view you were actually on, and refining a filter or sort doesn't
  clutter your Back history.
- **Settings** — severity tiers, the stale-object threshold, theme, and optional automatic
  re-indexing, saved to the app's shared storage so they persist for everyone.
- **Help** — in-app guidance on the views and filters, plus a reference of exactly which
  Cribl API calls the app makes and why.

### Security

- Read-only and sandboxed: reads configuration only through the platform-injected API, with
  no hardcoded endpoints or credentials, and writes only to the app's own key-value store.
  Every Cribl API path the app uses is declared in `config/policies.yml`, so administrators
  can see exactly what it will access before installing.
- Deploy-substituted secrets (tokens, passwords, secret references) are masked to `‹secret›`
  everywhere configuration is shown — Compare, the detail Config tab, and the cross-group
  matrix — so a per-group credential is never displayed and never reads as a false difference.
