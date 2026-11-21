#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : process.cwd());
const openspecOnly = args.includes('--openspec-only');
const architectureOnly = args.includes('--architecture-only');
const contractsOnly = args.includes('--contracts-only');

const requirements = [
  {
    id: 'QG0_DOC_LINKS',
    file: '.github/workflows/ace-contracts.yml',
    contains: ['lycheeverse/lychee-action@', 'Negative fixture must be rejected', 'Offline Markdown link verification'],
  },
  {
    id: 'QG1_SECURITY',
    file: '.github/workflows/ace-security.yml',
    contains: ['Betterleaks', 'actionlint', 'zizmor', 'Blocking PR-range secret scan'],
  },
  {
    id: 'QG2_ARCHITECTURE',
    file: 'package.json',
    contains: ['"test:arch-rules"', '"check:arch"'],
  },
  {
    id: 'QG4_DEPENDENCY_ADVISORY',
    file: '.github/workflows/ace-dependency-usage.yml',
    contains: ['Knip non-blocking nightly report', 'osv-scanner-action', 'fail-on-vuln: false'],
  },
  {
    id: 'QG5_CONTRACT_COMPAT',
    file: '.github/workflows/ace-contracts.yml',
    contains: ['Verify native Responses v2 is the sole active contract', '[qg5] only TypeSpec-native Responses v2 contract remains active'],
  },
  {
    id: 'QG6_NIGHTLY',
    file: '.github/workflows/ace-contracts.yml',
    contains: ['Full nightly deterministic TypeScript, architecture, build and property suite', 'npm run verify:full'],
  },
  {
    id: 'QG6_SECURITY_DEPTH',
    file: '.github/workflows/ace-code-health.yml',
    contains: ['github/codeql-action/init@33d7b85da1a04171e211befe2c739303b9a4c066', 'config-file: ./.github/codeql/codeql-config.yml', 'check-codeql-sarif.mjs', 'test:mutation:critical', 'Scheduled remote Markdown links (signal only)'],
  },
  {
    id: 'QG6_CODEQL_RESULT_GATE',
    file: 'scripts/check-codeql-sarif.mjs',
    contains: ['diagnostics/extraction-errors', "'security-severity'", 'securitySeverity >= 7', 'malformedSarif', 'unclassifiedFindings', 'INVALID_ANALYSIS', 'UNCLASSIFIED_FINDINGS', 'HIGH_SECURITY_FINDINGS', 'EXTRACTION_FAILED'],
  },
  {
    id: 'QG6_MUTATION_ORACLE',
    file: 'scripts/nightly-targeted-mutation.mjs',
    contains: ['MUT-POLICY-DATA-CLASS', 'MUT-GATEWAY-POLICY-BYPASS', 'MUT-GATEWAY-SECRET-BYPASS', 'baseline failed', 'SURVIVED'],
  },
  {
    id: 'GATEWAY_ONLY',
    file: 'package.json',
    contains: ['"test:gateway-only-audit"', '"check:gateway-only"'],
  },
  {
    id: 'TYPESPEC_NATIVE_RESPONSES',
    file: '.github/workflows/ace-typespec-codegen.yml',
    contains: ['Compile TypeSpec and generate maintained TypeScript SDK', 'Verify native Responses v2 contract and generated artifacts'],
  },
  {
    id: 'BIFROST_PLUGIN_BUILD',
    file: '.github/workflows/ace-contracts.yml',
    contains: [
      'Build pinned Bifröst ACE plugin',
      'Fetch exact pinned Bifröst source outside ACE checkout',
      'https://github.com/chris-madsen/bifrost.git',
      'fetch --no-tags --depth=1 origin "$BIFROST_COMMIT"',
      'BIFROST_SOURCE_ROOT: ${{ runner.temp }}/bifrost-src',
      'go-version: "1.27.4"',
      'BIFROST_COMMIT: 72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0',
    ],
  },
  {
    id: 'BIFROST_PLUGIN_BUILD_SCRIPT',
    file: 'scripts/build-bifrost-ace-plugin.sh',
    contains: [
      'BIFROST_COMMIT:=72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0',
      'status --porcelain --untracked-files=all',
      'Bifrost source checkout must be clean',
      'ACE source checkout must be clean',
      'go 1.27.4',
      '-buildmode=plugin',
    ],
  },
  {
    id: 'BIFROST_RESPONSES_ONLY_PHYSICAL_GUARD',
    file: 'integrations/bifrost/ace-connector/plugin/main.go',
    contains: [
      'func HTTPTransportPreHook',
      'case "/v1/responses":',
      'func prepareNativeResponses',
      'Bifröst native Responses route is unsupported by the ACE context extension',
      'ctx.SetPhysicalSendGuard(guard)',
      'AuthorizeNativeResponsesAttempt',
      'func PreLLMHook',
      'ctx.PhysicalSendGuard()',
      'AllowFallbacks: &allowFallbacks',
      'schemas.HarnessSessionHeaders',
      'schemas.NormalizeSessionID',
      'hostTranscriptAttested',
      'bifrost-visible-request-only',
    ],
    excludes: [
      'ACE provider dispatch disabled until native Responses is certified',
      'ctx.Value(schemas.BifrostContextKeyRequestID)',
    ],
  },
  {
    id: 'GATEWAY_PHYSICAL_SEND_POLICY',
    file: 'src/application/gateway-attempt-authorization-service.ts',
    contains: [
      'verifyProjectionReceipt',
      'request.bodySha256',
      'request.preparedBodySha256',
      'Object.prototype.hasOwnProperty.call(security.allowedModelsByProvider, modelProvider)',
      'security.allowedDestinations.includes(request.destination)',
      "'private_conversation'",
      'MODEL_NOT_ALLOWED',
      'dataClassesFor(request.dataClass)',
      'authorizeOutbound({',
      'physicalSendAttemptBlocked(request, reasonCode)',
      'physicalSendAttemptAllowed(request)',
      'return yield* sendAllow(request, security);',
      'attemptAuditDetails(request)',
      "outcome: 'allowed'",
      'if (isErr(written)) return written',
    ],
    // Architectural behavior: successful subscription-backed requests must
    // be admissible after policy/receipt checks. The prior guard inverted this
    // and required an unconditional denial even on successful authorizations.
    excludes: ["'OAUTH_ROUTE_UNVERIFIED'"],
  },
  {
    id: 'GATEWAY_EGRESS_POLICY',
    file: 'src/application/responses-projection-service.ts',
    contains: [
      'authorizeAndAudit',
      'allowedProviders',
      "destination: 'other_external'",
      'security.audit.append',
      'containsLikelySecret(JSON.stringify(body.value))',
      'decodeNativeResponsesBody',
      'classify(req)',
      'Object.prototype.hasOwnProperty.call(security.allowedModelsByProvider, modelProvider)',
      'MODEL_NOT_ALLOWED',
      "'private_source'",
    ],
  },
  {
    id: 'GATEWAY_EGRESS_CONFIG',
    file: 'src/bin/ace-runtime.ts',
    contains: [
      'ACE_CONTEXT_EXTERNAL_LLM_OPT_IN',
      'ACE_CONTEXT_ALLOWED_LLM_PROVIDERS_JSON',
      'ACE_CONTEXT_ALLOWED_LLM_DESTINATIONS_JSON',
      'ACE_CONTEXT_ALLOWED_LLM_MODELS_BY_PROVIDER_JSON',
      'ACE_CONTEXT_ALLOWED_LLM_DATA_CLASSES_JSON',
      'ACE_CONTEXT_ALLOWED_LLM_STREAMING_ROUTES_JSON',
      'configuredStringArrayMap',
      'allowedCloudDataClassesByProvider',
      'gateway-policy-audit.jsonl',
    ],
  },
  {
    id: 'OPENSPEC_STRICT_VALIDATION',
    file: '.github/workflows/ace-openspec.yml',
    contains: ['@fission-ai/openspec@1.17.0', 'openspec validate --all --strict --no-interactive', 'Prove strict validation rejects an invalid scenario'],
  },
  {
    id: 'OPENSPEC_GATEWAY_AUTHORITY',
    file: 'openspec/config.yaml',
    contains: ['Bifröst LLM Gateway is the sole supported ACE context delivery path', 'active change 010-gateway-only-ownership with production acceptance in 013-gateway-g11-production-acceptance'],
    excludes: ['Hermes ContextEngine request-time transformation', 'retired optional tool-call protocol facade'],
  },
];

const results = [];

const activeOpenSpecGuard = async () => {
  const changesRoot = resolve(root, 'openspec/changes');
  const forbiddenDirs = new Set(['008-hermes-context-integration', '009-bifrost-hermes-ownership']);
  const forbiddenText = [
    'retired optional tool-call protocol',
    '`ace_context`',
    '`ace_expand`',
    'Hermes ContextEngine',
    'Hermes native ContextEngine',
    'bifrost:auto',
  ];
  const violations = [];
  const forbiddenActiveDirs = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (directory === changesRoot && entry.isDirectory()) {
        if (entry.name === 'archive') continue;
        if (forbiddenDirs.has(entry.name)) forbiddenActiveDirs.push(entry.name);
      }
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (directory === changesRoot && entry.name === 'archive') continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !['proposal.md', 'design.md', 'spec.md'].includes(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      const found = forbiddenText.filter((needle) => text.includes(needle));
      if (found.length) violations.push({ file: full.slice(root.length + 1), forbidden: found });
    }
  };
  try {
    await walk(changesRoot);
  } catch {
    return { id: 'OPENSPEC_ACTIVE_GATEWAY_ONLY', status: 'FAIL', reason: 'missing_changes_tree' };
  }
  return {
    id: 'OPENSPEC_ACTIVE_GATEWAY_ONLY',
    status: forbiddenActiveDirs.length === 0 && violations.length === 0 ? 'PASS' : 'FAIL',
    ...(forbiddenActiveDirs.length ? { forbiddenActiveDirs } : {}),
    ...(violations.length ? { violations } : {}),
  };
};

if (!openspecOnly && !architectureOnly && !contractsOnly) for (const requirement of requirements) {
  let text;
  try {
    text = await readFile(resolve(root, requirement.file), 'utf8');
  } catch {
    results.push({ id: requirement.id, status: 'FAIL', reason: 'missing_file', file: requirement.file });
    continue;
  }
  const missing = requirement.contains.filter((needle) => !text.includes(needle));
  const forbidden = (requirement.excludes ?? []).filter((needle) => text.includes(needle));
  results.push({
    id: requirement.id,
    status: missing.length === 0 && forbidden.length === 0 ? 'PASS' : 'FAIL',
    file: requirement.file,
    ...(missing.length ? { missing } : {}),
    ...(forbidden.length ? { forbidden } : {}),
  });
}

const publicContractAuthorityGuard = async () => {
  const contractsRoot = resolve(root, 'contracts');
  const files = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full.slice(root.length + 1).replaceAll('\\', '/'));
      }
    }
  };
  if (existsSync(contractsRoot)) await walk(contractsRoot);
  const unexpected = files;
  let typeSpecMissing = [];
  try {
    const source = await readFile(resolve(root, 'typespec/context-v3.tsp'), 'utf8');
    for (const needle of [
      'namespace ACE.ContextV3',
      'model ProjectionRequest',
      'union ProjectionDecision',
      'protocol: "openai.responses"',
      '@route("/internal/ace-context/v3/project")',
      'model PhysicalSendAttemptRequest',
      '@route("/internal/ace-context/v3/authorize-attempt")',
    ]) {
      if (!source.includes(needle)) typeSpecMissing.push(needle);
    }
  } catch {
    typeSpecMissing = ['typespec/context-v3.tsp'];
  }
  return {
    id: 'PUBLIC_CONTRACT_TYPESPEC_AUTHORITY',
    status: unexpected.length === 0 && typeSpecMissing.length === 0 ? 'PASS' : 'FAIL',
    ...(unexpected.length ? { unexpected } : {}),
    ...(typeSpecMissing.length ? { typeSpecMissing } : {}),
  };
};

const architectureAuthorityGuard = async () => {
  const files = [
    'docs/docs/architecture/01-strategic-ddd.md',
    'docs/docs/architecture/02-event-storming.md',
    'docs/docs/architecture/03-tactical-ddd.md',
    'docs/docs/architecture/04-fsm-workflows.md',
    'docs/docs/architecture/05-contracts-and-deployment.md',
    'docs/docs/architecture/06-traceability-and-review.md',
    'docs/docs/architecture/07-architecture-fitness-contracts.md',
  ];
  const forbiddenText = [
    'retired optional tool-call protocol',
    '`ace_context`',
    '`ace_expand`',
    'Hermes ContextEngine',
    'Hermes native ContextEngine',
    'planned Bifrost',
  ];
  const violations = [];
  const missing = [];
  for (const file of files) {
    try {
      const value = await readFile(resolve(root, file), 'utf8');
      const found = forbiddenText.filter((needle) => value.includes(needle));
      if (found.length) violations.push({ file, forbidden: found });
    } catch {
      missing.push(file);
    }
  }
  const required = [
    ['docs/docs/architecture/01-strategic-ddd.md', 'Bifröst Gateway projection adapter'],
    ['docs/docs/architecture/05-contracts-and-deployment.md', 'Gateway Projection Surface — sole agent-facing delivery'],
    ['docs/docs/architecture/07-architecture-fitness-contracts.md', 'DBC-09 Gateway/connector conformance'],
  ];
  const missingAuthority = [];
  for (const [file, needle] of required) {
    try {
      const value = await readFile(resolve(root, file), 'utf8');
      if (!value.includes(needle)) missingAuthority.push({ file, needle });
    } catch {
      // already reported as missing
    }
  }
  return {
    id: 'ARCHITECTURE_GATEWAY_AUTHORITY',
    status: missing.length === 0 && violations.length === 0 && missingAuthority.length === 0 ? 'PASS' : 'FAIL',
    ...(missing.length ? { missing } : {}),
    ...(violations.length ? { violations } : {}),
    ...(missingAuthority.length ? { missingAuthority } : {}),
  };
};

if (!architectureOnly && !contractsOnly) results.push(await activeOpenSpecGuard());
if (!openspecOnly && !contractsOnly) results.push(await architectureAuthorityGuard());
if (!openspecOnly && !architectureOnly) results.push(await publicContractAuthorityGuard());

const summary = {
  schemaVersion: 'ace.sdlc-closure.v1',
  root,
  structuralVerdict: results.every(({ status }) => status === 'PASS') ? 'PASS' : 'FAIL',
  providerAgentE2E: 'NOT_RUN_BY_THIS_GATE',
  note: 'Structural/process closure cannot certify real provider bytes, retry/streaming behavior, or task-quality economics.',
  results,
};
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
if (summary.structuralVerdict !== 'PASS') process.exitCode = 1;
