// Synthetic Leader git history: a commit log plus, for each commit, the files it
// touched and their diffs. `/version/files` and `/version/show` are derived from
// this one list so the three git endpoints can never disagree with each other.
//
// The texture here is deliberate: per-object files (a pipeline dir, a schema, a
// grok pattern), shared library tables (regexes.yml, route.yml, inputs.yml) that
// the diff walk must narrow to a single object, a commit that touches every group
// at once, and a wide initial import.

/** One line of a git diff. `content` keeps the leading ` `/`+`/`-` marker, as the
 *  Leader emits it. */
interface DiffLine {
  content: string;
  type: 'context' | 'insert' | 'delete';
  oldNumber?: number;
  newNumber?: number;
}

interface DiffBlock {
  header: string;
  lines: DiffLine[];
}

/** One file's change within a commit: the `/version/files` leaf and the
 *  `/version/show` diffJson entry, kept together so they stay consistent. */
export interface FixtureFile {
  path: string;
  /** Git status letter: `A`dded / `M`odified / `D`eleted. */
  state: string;
  language: string;
  blocks: DiffBlock[];
}

export interface FixtureCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  files: FixtureFile[];
}

const ctx = (text: string, n: number): DiffLine => ({ content: ` ${text}`, type: 'context', oldNumber: n, newNumber: n });
const ins = (text: string, n: number): DiffLine => ({ content: `+${text}`, type: 'insert', newNumber: n });
const del = (text: string, n: number): DiffLine => ({ content: `-${text}`, type: 'delete', oldNumber: n });

/** A modified file with one hunk. */
function edit(path: string, header: string, lines: DiffLine[], language = 'yaml'): FixtureFile {
  return { path, state: 'M', language, blocks: [{ header, lines }] };
}

/** A newly added file: every line is an insertion. */
function created(path: string, text: string[], language = 'yaml'): FixtureFile {
  return {
    path,
    state: 'A',
    language,
    blocks: [{ header: `@@ -0,0 +1,${text.length} @@`, lines: text.map((t, i) => ins(t, i + 1)) }],
  };
}

// --- The hec_primary rollout (one commit, every Worker Group) ---------------

/** The `outputs.yml` lines for hec_primary in one group — the per-group drift
 *  (compress / payload cap / backpressure) and its deploy-substituted token. */
function hecLines(token: string, compress: boolean, maxKb: number, backpressure: boolean): string[] {
  return [
    '  hec_primary:',
    '    type: splunk_hec',
    '    description: Primary Splunk HEC',
    `    token: '${token}'`,
    `    compress: ${compress}`,
    `    maxPayloadSizeKB: ${maxKb}`,
    ...(backpressure ? ['    onBackpressure: block'] : []),
  ];
}

/** Appending hec_primary to a group that already had an outputs.yml. */
function hecAppended(group: string, existing: string[], hec: string[]): FixtureFile {
  const lines: DiffLine[] = [ctx('outputs:', 1), ...existing.map((t, i) => ctx(t, i + 2))];
  const start = existing.length + 2;
  hec.forEach((t, i) => lines.push(ins(t, start + i)));
  const before = existing.length + 1;
  return edit(`groups/${group}/local/cribl/outputs.yml`, `@@ -1,${before} +1,${before + hec.length} @@`, lines);
}

const hecRollout: FixtureFile[] = [
  hecAppended('prod', ['  splunk_out:', '    type: splunk', '    pipeline: postproc_pipe'], hecLines('#42:aQ8xR2vLp0dNc6Ty', true, 4096, true)),
  hecAppended('staging', ['  stg_out:', '    type: filesystem'], hecLines('#43:Kd3mZ9pQr1sWv7Bn', true, 4096, true)),
  created('groups/eu_west/local/cribl/outputs.yml', ['outputs:', ...hecLines('#44:Yh5tG2wXj8LmQ4Rz', true, 1024, true)]),
  created('groups/apac/local/cribl/outputs.yml', ['outputs:', ...hecLines('#45:Vb7nC1kFd6PsA3Wq', false, 4096, true)]),
  created('groups/dmz/local/cribl/outputs.yml', ['outputs:', ...hecLines('#46:Tz4jH9yUe2NrM8Xc', true, 4096, true)]),
  created('groups/lab/local/cribl/outputs.yml', ['outputs:', ...hecLines('#47:Lq6vB3dSg5KtP1Zm', true, 4096, false)]),
];

// --- The initial import (the wide commit) -----------------------------------

const initialImport: FixtureFile[] = [
  created('groups/prod/local/cribl/inputs.yml', [
    'inputs:',
    '  splunk_in:',
    '    type: splunk',
    '    sendToRoutes: true',
    '  dead_input:',
    '    type: http',
    '    disabled: true',
    '    sendToRoutes: true',
    '  pp_input:',
    '    type: tcp',
    '    pipeline: preproc_pipe',
    '    sendToRoutes: false',
  ]),
  created('groups/prod/local/cribl/outputs.yml', ['outputs:', '  splunk_out:', '    type: splunk', '    pipeline: postproc_pipe']),
  created('groups/prod/local/cribl/pipelines/route.yml', [
    'routes:',
    '  - id: r_web',
    '    name: web to splunk',
    "    filter: sourcetype=='access'",
    '    pipeline: web_logs',
    '    output: splunk_out',
    '  - id: r_noisy',
    '    name: noisy to devnull',
    '    filter: true',
    '    pipeline: noisy_pipe',
    '    output: devnull',
  ]),
  created('groups/prod/local/cribl/pipelines/shared_enrich/conf.yml', [
    'conf:',
    '  description: Shared enrichment, invoked via Chain',
    '  functions:',
    '    - id: eval',
    '      conf:',
    '        add:',
    '          - name: env',
    "            value: 'prod'",
  ]),
  created('groups/prod/local/cribl/pipelines/preproc_pipe/conf.yml', ['conf:', '  description: Source pre-processing', '  functions:', '    - id: eval']),
  created('groups/prod/local/cribl/pipelines/postproc_pipe/conf.yml', ['conf:', '  description: Destination post-processing', '  functions:', '    - id: eval']),
  created('groups/prod/data/lookups/geo_city.csv', ['ip,city,country', '10.0.0.1,Portland,US', '10.0.0.2,Berlin,DE'], 'text'),
  created('groups/prod/data/lookups/threat_intel.csv', ['ip,score,category', '10.0.0.2,88,botnet'], 'text'),
  created('groups/prod/data/lookups/unused_ref.csv', ['key,value', 'a,1'], 'text'),
  created('groups/staging/local/cribl/inputs.yml', ['inputs:', '  stg_in:', '    type: tcp', '    sendToRoutes: true']),
  created('groups/staging/local/cribl/pipelines/route.yml', [
    'routes:',
    '  - id: sr1',
    '    name: main flow',
    '    filter: true',
    '    pipeline: used_pipe',
    '    output: stg_out',
    '    final: true',
  ]),
  created('groups/staging/local/cribl/pipelines/orphan_pipe/conf.yml', ['conf:', '  description: Orphaned — referenced by nothing', '  functions:', '    - id: eval']),
  created('groups/staging/local/cribl/pipelines/used_pipe/conf.yml', ['conf:', '  description: Referenced by a route', '  functions:', '    - id: eval']),
  created('groups/dmz/local/cribl/inputs.yml', [
    'inputs:',
    '  syslog_edge:',
    '    type: syslog',
    '    port: 514',
    '    sendToRoutes: true',
    '  tap_span:',
    '    type: tcp',
    '    port: 10060',
    '    sendToRoutes: false',
  ]),
  created('groups/apac/local/cribl/inputs.yml', ['inputs:', '  kafka_in:', '    type: kafka', '    topics:', '      - edge-events', '    sendToRoutes: true']),
  created('groups/lab/local/cribl/inputs.yml', ['inputs:', '  lab_in:', '    type: http', '    port: 10080', '    sendToRoutes: true']),
];

// --- The commit log (newest first) -----------------------------------------

const WEB_LOGS = 'groups/prod/local/cribl/pipelines/web_logs/conf.yml';

export const fixtureCommits: FixtureCommit[] = [
  {
    hash: 'a1b2c3d4e5',
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    date: '2026-06-20T14:30:00Z',
    message: 'Bump web_logs tag token to 42',
    files: [
      edit(WEB_LOGS, '@@ -4,7 +4,7 @@ conf:', [
        ctx('  functions:', 4),
        ctx('    - id: eval', 5),
        del("      value: 'ZEBRA_TOKEN_41'", 6),
        ins("      value: 'ZEBRA_TOKEN_42'", 6),
        ctx('    - id: lookup', 7),
      ]),
    ],
  },
  {
    hash: '9f8e7d6c5b',
    author: 'Grace Hopper',
    email: 'grace@example.com',
    date: '2026-06-18T11:05:00Z',
    message: 'Add an ipv4_private regex to the prod library',
    files: [
      // A shared library table: two regexes live in one file, so the diff walk has
      // to narrow the change to ipv4_private and leave strip_ansi alone.
      edit('groups/prod/local/cribl/regexes.yml', '@@ -1,4 +1,8 @@', [
        ctx('regexes:', 1),
        ctx('  strip_ansi:', 2),
        ctx('    lib: custom', 3),
        ctx('    description: Strip ANSI colour codes from console output', 4),
        ins('  ipv4_private:', 5),
        ins('    lib: custom', 6),
        ins('    description: RFC1918 address', 7),
        ins("    regex: /^(?:10\\.|192\\.168\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.)/", 8),
      ]),
    ],
  },
  {
    hash: '7c6d5e4f3a',
    author: 'Katherine Johnson',
    email: 'katherine@example.com',
    date: '2026-06-15T08:40:00Z',
    message: 'Add gdpr_mask to eu_west and route EU web traffic through it',
    files: [
      created('groups/eu_west/local/cribl/pipelines/gdpr_mask/conf.yml', [
        'conf:',
        '  description: Mask EU personal data before egress',
        '  functions:',
        '    - id: mask',
        '      conf:',
        '        rules:',
        '          - matchRegex: /(?<=email=)[^&\\s]+/g',
        '            replaceExpr: C.Mask.md5(g0)',
        '    - id: lookup',
        '      conf:',
        '        file: geo_city.csv',
      ]),
      edit('groups/eu_west/local/cribl/pipelines/route.yml', '@@ -1,7 +1,13 @@', [
        ctx('routes:', 1),
        ins('  - id: r_gdpr', 2),
        ins('    name: eu personal data', 3),
        ins("    filter: sourcetype=='eu_web'", 4),
        ins('    pipeline: gdpr_mask', 5),
        ins('    output: hec_primary', 6),
        ctx('  - id: r_windows', 7),
        ctx('    name: windows security events', 8),
      ]),
    ],
  },
  {
    hash: '3e2d1c0b9a',
    author: 'Cribl System',
    email: 'cribl@example.com',
    // Cloud commits are authored by the system account; the acting user is in the
    // message ("First Last: <change>"), which the age index parses out.
    date: '2026-06-10T19:22:00Z',
    message: 'Jordan Vega: Updated the cribl_internal schema',
    files: [
      edit('groups/prod/local/cribl/schemas/cribl_internal.json', '@@ -6,6 +6,7 @@', [
        ctx('  "required": [', 6),
        ctx('    "host",', 7),
        del('    "source"', 8),
        ins('    "source",', 8),
        ins('    "eventCount"', 9),
        ctx('  ],', 10),
      ], 'json'),
    ],
  },
  {
    hash: '8a7b6c5d4e',
    author: 'Alan Turing',
    email: 'alan@example.com',
    date: '2026-06-05T13:14:00Z',
    message: 'Add the aws_alb grok pattern',
    files: [
      created(
        'groups/prod/local/cribl/grok-patterns/aws_alb',
        ['ALB_PREFIX %{WORD:alb_type} %{TIMESTAMP_ISO8601:alb_time} %{NOTSPACE:alb_name}', 'ALB_CLIENT %{IP:client_ip}:%{INT:client_port:int}'],
        'text',
      ),
    ],
  },
  {
    hash: '5d4c3b2a19',
    author: 'Grace Hopper',
    email: 'grace@example.com',
    date: '2026-05-28T10:00:00Z',
    message: 'Roll hec_primary out to every Worker Group',
    files: hecRollout,
  },
  {
    hash: 'f6a7b8c9d0',
    author: 'Grace Hopper',
    email: 'grace@example.com',
    date: '2026-05-11T09:15:00Z',
    message: 'Add threat enrichment to web_logs',
    files: [
      edit(WEB_LOGS, '@@ -12,6 +12,10 @@ conf:', [
        ctx('    - id: chain', 12),
        ctx('      conf:', 13),
        ctx('        pipeline: shared_enrich', 14),
        ins('    - id: eval', 15),
        ins('      description: threat enrichment', 16),
        ins('      conf:', 17),
        ins('        add:', 18),
        ins('          - name: threat', 19),
        ins("            value: C.Lookup('threat_intel.csv').match(host)", 20),
      ]),
    ],
  },
  {
    hash: '2b3c4d5e6f',
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    date: '2026-04-20T15:45:00Z',
    message: 'Disable the legacy apac payroll route',
    files: [
      edit('groups/apac/local/cribl/pipelines/route.yml', '@@ -7,6 +7,7 @@', [
        ctx('  - id: r_legacy_drop', 7),
        ctx('    name: =HYPERLINK("http://evil.example.test","payroll export")', 8),
        ctx("    filter: sourcetype=='legacy'", 9),
        ins('    disabled: true', 10),
        ctx('    output: devnull', 11),
      ]),
    ],
  },
  {
    hash: 'b1c2d3e4f5',
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    date: '2026-04-02T16:45:00Z',
    message: 'Create web_logs pipeline',
    files: [
      created(WEB_LOGS, [
        'conf:',
        '  description: Parse and enrich web logs',
        '  functions:',
        '    - id: eval',
        '      filter: true',
        '      conf:',
        '        add:',
        '          - name: tag',
        "            value: 'ZEBRA_TOKEN_41'",
      ]),
    ],
  },
  {
    hash: '6f5e4d3c2b',
    author: 'Katherine Johnson',
    email: 'katherine@example.com',
    date: '2026-03-15T12:30:00Z',
    message: 'Install security_pack in prod',
    files: [
      created('groups/prod/local/cribl/packs/security_pack/default/cribl/pipelines/pack_detect/conf.yml', [
        'conf:',
        '  description: Threat detection',
        '  functions:',
        '    - id: eval',
        '      conf:',
        '        add:',
        '          - name: sev',
        "            value: 'high'",
      ]),
      created('groups/prod/local/cribl/packs/security_pack/default/cribl/pipelines/route.yml', [
        'routes:',
        '  - id: pr1',
        '    name: detect route',
        '    filter: true',
        '    pipeline: pack_detect',
        '    output: pack_out',
        '    final: true',
      ]),
      created('groups/prod/local/cribl/packs/security_pack/default/cribl/inputs.yml', ['inputs:', '  pack_in:', '    type: http', '    sendToRoutes: true']),
      created('groups/prod/local/cribl/packs/security_pack/default/cribl/outputs.yml', ['outputs:', '  pack_out:', '    type: s3']),
    ],
  },
  {
    hash: '0a9b8c7d6e',
    author: 'Alan Turing',
    email: 'alan@example.com',
    date: '2026-02-01T09:00:00Z',
    message: 'Initial config import',
    files: initialImport,
  },
];

// --- Endpoint payloads derived from the log ---------------------------------

interface TreeNode {
  name: string;
  state?: string;
  children?: TreeNode[];
}

/** Nest flat paths into the `{ name, children }` / `{ name, state }` tree that
 *  `/version/files` returns. */
function fileTree(files: FixtureFile[]): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let level = roots;
    parts.forEach((name, i) => {
      const leaf = i === parts.length - 1;
      let node = leaf ? undefined : level.find((n) => n.name === name && n.children);
      if (!node) {
        node = leaf ? { name, state: file.state } : { name, children: [] };
        level.push(node);
      }
      if (!leaf) level = node.children!;
    });
  }
  return roots;
}

/** A `/version/show` body for the given files. */
function showPayload(commit: FixtureCommit, files: FixtureFile[]): unknown {
  return {
    items: [
      {
        commitMessage: commit.message,
        diffJson: files.map((f) => ({
          oldName: f.state === 'A' ? '/dev/null' : f.path,
          newName: f.path,
          language: f.language,
          isNew: f.state === 'A',
          blocks: f.blocks,
        })),
      },
    ],
  };
}

/**
 * Every git endpoint payload, keyed by the exact path the app requests. The
 * commit-scoped keys carry the query string, so each commit reports its own files
 * and its own diffs; the bare paths stay as a newest-commit fallback for any
 * request that doesn't match a known hash.
 */
export function gitPayloads(commits: FixtureCommit[] = fixtureCommits): Record<string, unknown> {
  const out: Record<string, unknown> = {
    '/version': {
      items: commits.map((c) => ({
        hash: c.hash,
        author_name: c.author,
        author_email: c.email,
        date: c.date,
        message: c.message,
      })),
    },
  };
  for (const commit of commits) {
    out[`/version/files?commit=${encodeURIComponent(commit.hash)}`] = {
      items: [{ count: commit.files.length, items: fileTree(commit.files) }],
    };
    out[`/version/show?commit=${encodeURIComponent(commit.hash)}`] = showPayload(commit, commit.files);
    for (const file of commit.files) {
      const key = `/version/show?commit=${encodeURIComponent(commit.hash)}&filename=${encodeURIComponent(file.path)}`;
      out[key] = showPayload(commit, [file]);
    }
  }
  const newest = commits[0];
  out['/version/files'] = { items: [{ count: newest.files.length, items: fileTree(newest.files) }] };
  out['/version/show'] = showPayload(newest, newest.files);
  return out;
}
