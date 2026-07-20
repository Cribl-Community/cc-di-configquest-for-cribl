// The Help page: on the left, guidance on using the app (what it is, the views,
// filtering); on the right, an API reference of exactly which Cribl calls the app
// makes, what each is used for, and an illustrative example (no environment data).
// Shares the Settings page layout (sub-nav + body).

import { useState } from 'react';

type Section = 'start' | 'views' | 'filters' | 'api';

const SECTIONS: { id: Section; label: string; group: string }[] = [
  { id: 'start', label: 'Getting started', group: 'Using Config Quest for Cribl' },
  { id: 'views', label: 'The views', group: 'Using Config Quest for Cribl' },
  { id: 'filters', label: 'Filtering & search', group: 'Using Config Quest for Cribl' },
  { id: 'api', label: 'API reference', group: 'Reference' },
];

interface ApiEntry {
  method: string;
  path: string;
  provides: string;
  example: string;
}

const API: { group: string; entries: ApiEntry[] }[] = [
  {
    group: 'Inventory & config',
    entries: [
      { method: 'GET', path: '/products/stream/groups', provides: 'Lists the Worker Groups — the scope every other call is made against.', example: 'GET /products/stream/groups' },
      { method: 'GET', path: '/m/<group>/pipelines', provides: 'Pipelines in a Worker Group. (Same shape for /routes, /system/inputs, /system/outputs, /system/lookups, /packs.)', example: 'GET /m/default/pipelines' },
      { method: 'GET', path: '/m/<group>/lib/<type>', provides: 'Library (Knowledge) objects — event breakers, regexes, grok, parsers, schemas, data-scan rules & rulesets, parquet/protobuf/appscope, global variables, database connections — at group and pack scope.', example: 'GET /m/default/lib/regex' },
      { method: 'GET', path: '/m/<group>/system/lookups/<id>/content', provides: 'A lookup file’s rows — powers the Compare metadata summary and the Across-Worker-Groups size/hash clustering.', example: 'GET /m/default/system/lookups/geo.csv/content' },
      { method: 'GET', path: '/m/<group>/p/<pack>/pipelines', provides: 'Pack-scoped objects (pipelines, routes, inputs, outputs, library objects) that live inside a pack.', example: 'GET /m/default/p/my_pack/routes' },
    ],
  },
  {
    group: 'Operational health',
    entries: [
      { method: 'GET', path: '/m/<group>/system/status/inputs', provides: 'Per-object health for Sources (and /outputs for Destinations). Drives the health filter; hidden if not granted.', example: 'GET /m/default/system/status/outputs' },
    ],
  },
  {
    group: 'Change history (git)',
    entries: [
      { method: 'GET', path: '/version?count=<n>', provides: 'The commit log — author, message, and time — for the Overview activity feed and the Commits page.', example: 'GET /version?count=100' },
      { method: 'GET', path: '/version/files?commit=<hash>', provides: 'The files a commit touched (lightweight) — attributes last-changed/owner per object, and lists a commit’s changed files on the Commits page.', example: 'GET /version/files?commit=a1b2c3d' },
      { method: 'GET', path: '/version/show?commit=<hash>&filename=<path>', provides: "One file's diff within a commit — powers the History tab and the Commits page per-file diffs, and narrows shared-file changes.", example: 'GET /version/show?commit=a1b2c3d&filename=…/route.yml' },
    ],
  },
  {
    group: 'App storage (the only writes)',
    entries: [
      { method: 'GET / PUT', path: '/a/<appId>/kvstore/<key>', provides: "The app's own app-scoped KV store on the Leader — caches the index for fast startup and saves your Settings, shared across every user of the app. The only place Config Quest for Cribl ever writes.", example: 'PUT /a/configquest/kvstore/ui.settings' },
    ],
  },
];

export function Help() {
  const [section, setSection] = useState<Section>('start');
  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <div className="settings">
      <nav className="set-nav" aria-label="Help sections">
        {groups.map((g) => (
          <div key={g}>
            <div className="set-navgroup">{g}</div>
            {SECTIONS.filter((s) => s.group === g).map((s) => (
              <button key={s.id} className={`set-navitem${section === s.id ? ' active' : ''}`} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="set-body">
        {section === 'start' && (
          <HelpSection title="Getting started" sub="Configuration and knowledge object visibility, search, and hygiene for Cribl.">
            <p className="help-p">
              It indexes every Pipeline, Route, Source, Destination, Lookup, and Pack — plus library (Knowledge) objects
              like Event Breakers, Regexes, Grok patterns, Parsers, Schemas, Data-scan rules, Global Variables, and more —
              across all Worker Groups, then makes them searchable, inventoried, and auditable in one place. It never
              creates, modifies, or deletes a Cribl resource — the only writes it makes are to its own storage.
            </p>
            <div className="help-def">
              <div className="help-term">Find anything</div>
              <div className="help-desc">Search by name, ID, or a value buried deep in a config, across every Worker Group at once.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Spot problems</div>
              <div className="help-desc">Config-hygiene findings surface unreferenced pipelines, unreachable routes, dead-end sources, and more.</div>
            </div>
            <div className="help-def">
              <div className="help-term">See what changed</div>
              <div className="help-desc">Git-backed history shows who last touched an object and the exact diff, plus a live activity feed.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Compare</div>
              <div className="help-desc">Diff any two objects of the same type, setting by setting — e.g. the same pipeline across two groups.</div>
            </div>
          </HelpSection>
        )}

        {section === 'views' && (
          <HelpSection title="The views" sub="Six surfaces, switched from the left nav rail.">
            <div className="help-def">
              <div className="help-term">Overview</div>
              <div className="help-desc">An at-a-glance readout: config hygiene (severity-tiered), inventory by type, recently changed objects, and recent commits. Rows drill in — hygiene and inventory to a filtered Browse, recent commits to the Commits page.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Browse</div>
              <div className="help-desc">The full inventory as a searchable, filterable table. Open any object for its config, references, health, and change history. Export to CSV.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Compare</div>
              <div className="help-desc">Pick two objects of the same type for a side-by-side, per-setting diff. Filters narrow the pickers.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Commits</div>
              <div className="help-desc">The environment's git change log. Browse every commit and open one to see its full diff, file by file — reached from the nav, an Overview activity item, or an object's History tab.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Differences</div>
              <div className="help-desc">Pick one object that lives in several Worker Groups and see its config drift as a settings × groups grid — every group a column, every differing setting a row, and each cell that departs from the majority value highlighted. Reached from the nav or an object's "Compare across groups" action. Deploy-filled secrets are ignored so a per-group token isn't mistaken for drift.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Settings</div>
              <div className="help-desc">Tune finding severity tiers, the stale-object threshold, theme, and optional automatic re-indexing.</div>
            </div>
          </HelpSection>
        )}

        {section === 'filters' && (
          <HelpSection title="Filtering & search" sub="Narrow the inventory down to exactly what you're after.">
            <p className="help-p">
              The search box matches object names, IDs, and the actual config values inside them. Press <span className="help-kbd">/</span>{' '}
              anywhere on Browse to jump to it. Use <span className="help-kbd">*</span> as a wildcard — <code>web*log</code> matches
              "web_parse_log", <code>*.csv</code> matches any lookup ending in .csv.
            </p>
            <div className="help-def">
              <div className="help-term">Multi-select filters</div>
              <div className="help-desc">Type, Worker Group, Pack, Flags, State, Health, and Last modified by each open a checklist — every value starts selected, "only" isolates one, and clearing the last restores them all.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Active-filter chips</div>
              <div className="help-desc">Every active constraint appears as a removable chip; drop one at a time, or Clear all.</div>
            </div>
            <div className="help-def">
              <div className="help-term">Shareable</div>
              <div className="help-desc">The view (search, filters, open object) lives in the URL, so any state is bookmarkable and the Back button walks your view history.</div>
            </div>
          </HelpSection>
        )}

        {section === 'api' && (
          <HelpSection title="API reference" sub="Exactly which Cribl calls Config Quest for Cribl makes, and why. All reads except its own KV store.">
            <p className="help-p">
              Calls go through the platform-injected API base; <span className="help-kbd">&lt;group&gt;</span> is a Worker Group and{' '}
              <span className="help-kbd">/m/&lt;group&gt;</span> is Cribl's per-group context prefix. Examples below are illustrative — no
              data from your environment.
            </p>
            {API.map((g) => (
              <div className="help-apigroup" key={g.group}>
                <div className="set-grouph">{g.group}</div>
                {g.entries.map((e) => (
                  <div className="help-api" key={e.path}>
                    <div className="help-api-h">
                      <span className="help-method">{e.method}</span>
                      <span className="mono help-api-path">{e.path}</span>
                    </div>
                    <div className="help-desc">{e.provides}</div>
                    <div className="help-code mono">{e.example}</div>
                  </div>
                ))}
              </div>
            ))}
          </HelpSection>
        )}
      </div>
    </div>
  );
}

function HelpSection({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="set-section help-section">
      <h2 className="set-head">{title}</h2>
      {sub && <p className="set-sub">{sub}</p>}
      {children}
    </div>
  );
}
