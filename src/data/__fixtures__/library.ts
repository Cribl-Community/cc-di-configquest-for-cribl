// Library objects (`/lib/<type>`) for the synthetic org. These are id-keyed
// collections that exist at group and pack scope, so they're built here rather
// than in the per-group JSON: the objects that must read as *identical* across
// Worker Groups (strip_ansi) are one shared const reused by every group, which
// no amount of copy-pasted JSON can guarantee.
//
// Shapes mirror what a Leader returns for each `/lib/<type>` endpoint. Secret
// fields hold Cribl secret *references* (`#<n>:…`), never a real credential.

/** The `{ count, items }` envelope every collection endpoint returns. */
function list(items: unknown[]): unknown {
  return { count: items.length, items };
}

// --- Shared objects (byte-identical in every group that has them) -----------

// The "identical everywhere" object: same fields, same values, all six groups.
// The Differences matrix must show it as a full-width match with zero drift.
const stripAnsi = {
  id: 'strip_ansi',
  lib: 'custom',
  description: 'Strip ANSI colour codes from console output',
  regex: '/\\x1b\\[[0-9;]*m/g',
  sampleData: '\\x1b[31mERROR\\x1b[0m disk full on /var',
  tags: 'cleanup,console',
};

/** A global variable whose value legitimately differs per group. */
function envName(value: string): unknown {
  return {
    id: 'env_name',
    type: 'string',
    value: `'${value}'`,
    description: 'Environment name stamped onto every event',
    tags: 'enrichment',
  };
}

// --- prod: the one group carrying all twelve library types -----------------

const prodBreakers = [
  {
    id: 'ndjson_bk',
    lib: 'custom',
    description: 'Newline-delimited JSON with an ISO timestamp',
    tags: 'json',
    rules: [
      {
        name: 'ndjson',
        condition: "/^\\s*{/.test(_raw)",
        type: 'json',
        timestampAnchorRegex: '/"ts"\\s*:\\s*"/',
        timestamp: { type: 'auto' },
        maxEventBytes: 51200,
      },
    ],
  },
  {
    id: 'apache_bk',
    lib: 'custom',
    description: 'Apache combined access log',
    tags: 'web',
    rules: [
      {
        name: 'apache_combined',
        condition: 'true',
        type: 'regex',
        eventBreakerRegex: '/[\\r\\n]+(?=\\d{1,3}\\.\\d{1,3}\\.)/',
        timestampAnchorRegex: '/\\[/',
        timestamp: { type: 'format', format: '%d/%b/%Y:%H:%M:%S %z' },
        maxEventBytes: 51200,
      },
    ],
  },
];

const prodRegexes = [
  stripAnsi,
  {
    id: 'ipv4_private',
    lib: 'custom',
    description: 'RFC1918 address',
    regex: '/^(?:10\\.|192\\.168\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.)/',
    sampleData: '10.0.0.5',
    tags: 'network',
  },
];

const prodGrok = [
  {
    id: 'aws_alb',
    lib: 'custom',
    description: 'AWS ALB access log prefix',
    pattern: '%{WORD:alb_type} %{TIMESTAMP_ISO8601:alb_time} %{NOTSPACE:alb_name} %{IP:client_ip}:%{INT:client_port:int}',
  },
  {
    id: 'cisco_asa',
    lib: 'custom',
    description: 'Cisco ASA message header',
    pattern: '%%ASA-%{INT:asa_severity:int}-%{INT:asa_message_id:int}: %{GREEDYDATA:asa_message}',
  },
];

const prodParsers = [
  {
    id: 'csv_access',
    type: 'csv',
    lib: 'custom',
    description: 'Comma-separated access log',
    delimChar: ',',
    quoteChar: '"',
    escapeChar: '\\',
    nullValue: '-',
    fields: ['ts', 'clientip', 'method', 'uri', 'status', 'bytes'],
  },
  {
    id: 'kv_syslog',
    type: 'kvp',
    lib: 'custom',
    description: 'key=value syslog payload',
    fieldDelimRegex: '/[ ]+/',
    allowedKeyChars: ['_', '.'],
    allowedValueChars: ['-', '.', ':', '/'],
  },
];

const prodSchemas = [
  {
    id: 'cribl_internal',
    description: 'Cribl internal metrics envelope',
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'cribl_internal',
      type: 'object',
      required: ['host', 'source'],
      properties: {
        host: { type: 'string' },
        source: { type: 'string' },
        eventCount: { type: 'integer', minimum: 0 },
      },
    },
  },
];

const prodParquetSchemas = [
  {
    id: 'sample_nested',
    description: 'Nested access-log record',
    schema: {
      type: 'record',
      name: 'access',
      fields: [
        { name: 'ts', type: 'long' },
        { name: 'clientip', type: 'string' },
        { name: 'geo', type: { type: 'record', name: 'geo', fields: [{ name: 'city', type: 'string' }] } },
      ],
    },
  },
];

const prodSdsRules = [
  {
    id: 'us_ssn',
    name: 'US Social Security Number',
    description: 'Nine digits in 3-2-4 grouping',
    pattern: '/\\b\\d{3}-\\d{2}-\\d{4}\\b/g',
    tags: 'pii',
  },
  {
    id: 'pan_16',
    name: 'Primary Account Number',
    description: 'Sixteen-digit payment card number',
    pattern: '/\\b(?:\\d[ -]*?){13,16}\\b/g',
    entropy: 3,
    tags: 'pci',
  },
];

const prodSdsRulesets = [
  {
    id: 'pii_default',
    name: 'PII default',
    description: 'Baseline personal-data masking',
    rules: [
      { id: 'us_ssn', action: 'mask' },
      { id: 'pan_16', action: 'redact' },
    ],
  },
];

const prodProtobuf = [
  {
    id: 'otel_logs',
    name: 'OpenTelemetry logs',
    description: 'OTLP log record definitions',
    files: [{ name: 'logs.proto' }, { name: 'common.proto' }],
  },
];

const prodAppscope = [
  {
    id: 'default_scope',
    description: 'Baseline AppScope collection',
    config: {
      metric: { enable: true, format: { type: 'ndjson' }, transport: { type: 'tcp', host: '127.0.0.1', port: 10090 } },
      event: { enable: true, watch: [{ type: 'file', name: '/var/log/*.log' }] },
    },
  },
];

const prodDbConnections = [
  {
    id: 'pg_reporting',
    databaseType: 'postgres',
    description: 'Read-only reporting replica',
    connectionString: 'jdbc:postgresql://db.example.internal:5432/reporting',
    username: 'cribl_ro',
    password: '#31:qWm4Zt8LrVd2Yb6H',
    connectionTimeout: 30000,
    maxPoolSize: 5,
  },
];

// --- pack scope ------------------------------------------------------------

const packRegexes = [
  {
    id: 'pack_ioc_url',
    lib: 'security_pack',
    description: 'URL shape used by the pack detection rules',
    regex: '/https?:\\/\\/[^\\s"]+/g',
    sampleData: 'http://c2.example.test/beacon',
    tags: 'ioc',
  },
];

const packBreakers = [
  {
    id: 'pack_alert_bk',
    lib: 'security_pack',
    description: 'One alert per line',
    tags: 'security',
    rules: [{ name: 'alert_line', condition: 'true', type: 'regex', eventBreakerRegex: '/[\\r\\n]+/', maxEventBytes: 8192 }],
  },
];

// --- Per-group / per-pack endpoint map -------------------------------------

/** Every `/lib/<type>` payload, keyed by bare API path. Groups that don't list a
 *  type simply have no entry — the transport 404s it, which fetchOrg reads as
 *  "empty", exactly as a real Leader behaves for an absent collection. */
export const libraryPayloads: Record<string, unknown> = {
  // prod carries all twelve types, so every Knowledge view has real data.
  '/m/prod/lib/breakers': list(prodBreakers),
  '/m/prod/lib/regex': list(prodRegexes),
  '/m/prod/lib/grok': list(prodGrok),
  '/m/prod/lib/parsers': list(prodParsers),
  '/m/prod/lib/schemas': list(prodSchemas),
  '/m/prod/lib/parquet-schemas': list(prodParquetSchemas),
  '/m/prod/lib/sds-rules': list(prodSdsRules),
  '/m/prod/lib/sds-rulesets': list(prodSdsRulesets),
  '/m/prod/lib/protobuf-libraries': list(prodProtobuf),
  '/m/prod/lib/appscope-configs': list(prodAppscope),
  '/m/prod/lib/vars': list([envName('prod')]),
  '/m/prod/lib/database-connections': list(prodDbConnections),

  // A library type inside the pack (pack scope is `/m/<group>/p/<pack>/lib/<type>`).
  '/m/prod/p/security_pack/lib/regex': list(packRegexes),
  '/m/prod/p/security_pack/lib/breakers': list(packBreakers),

  // The other groups carry the shared regex (identical everywhere) plus a variable
  // whose value legitimately differs per group.
  '/m/staging/lib/regex': list([stripAnsi]),
  '/m/staging/lib/vars': list([envName('staging')]),

  '/m/eu_west/lib/regex': list([stripAnsi]),
  '/m/eu_west/lib/vars': list([envName('eu_west')]),

  '/m/apac/lib/regex': list([
    stripAnsi,
    {
      // A CJK id/name: must not break the table, the facets, or the URL state.
      id: '日本語_パターン',
      lib: 'custom',
      description: '日本語のログ行を検出する',
      regex: '/[\\u3040-\\u30ff\\u4e00-\\u9faf]+/g',
      sampleData: 'アクセスログ 東京',
      tags: 'i18n',
    },
  ]),
  '/m/apac/lib/vars': list([
    envName('apac'),
    {
      // URL-significant characters in an id: `%` starts a percent-escape.
      id: 'pct%_rate',
      type: 'number',
      value: '95',
      description: 'Sampling percentage applied at the edge',
      tags: 'sampling',
    },
  ]),

  '/m/dmz/lib/regex': list([stripAnsi]),
  '/m/lab/lib/regex': list([stripAnsi]),
};
