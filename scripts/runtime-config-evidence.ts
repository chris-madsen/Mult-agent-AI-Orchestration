import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateRuntimeConfigEvidence,
  type RuntimeCloudPermission,
  type RuntimeDeployment,
  type RuntimeReleaseScope,
} from '../src/domain/runtime-config-evidence.js';

const [scopeArg, deploymentArg, captureReferenceArg, outputArg] = process.argv.slice(2);
if (scopeArg === undefined || deploymentArg === undefined || captureReferenceArg === undefined || outputArg === undefined) {
  throw new Error(
    'Usage: tsx scripts/runtime-config-evidence.ts <code-only|full-unified> <host|k3s> <capture-reference> <output.json>',
  );
}
if (scopeArg !== 'code-only' && scopeArg !== 'full-unified') {
  throw new Error('runtime config scope must be code-only or full-unified');
}
if (deploymentArg !== 'host' && deploymentArg !== 'k3s') {
  throw new Error('runtime config deployment must be host or k3s');
}

const scope = scopeArg as RuntimeReleaseScope;
const deployment = deploymentArg as RuntimeDeployment;
const workspaceId = process.env.ACE_WORKSPACE_ID?.trim();
if (workspaceId === undefined || workspaceId.length === 0) {
  throw new Error('ACE_WORKSPACE_ID is required for runtime configuration evidence');
}

const enabled = (name: string): boolean => process.env[name] === 'true';
const nonEmpty = (name: string): boolean => (process.env[name]?.trim().length ?? 0) > 0;

const vertexEnabled = enabled('ACE_ENABLE_VERTEX');
const cloudDocsOptIn = enabled('ACE_CLOUD_DOCS_OPT_IN');
const cloudPermissions: RuntimeCloudPermission[] = vertexEnabled && cloudDocsOptIn
  ? [{ provider: 'vertex', dataClasses: ['project_document'] }]
  : [];

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
const input = {
  schemaVersion: 1 as const,
  scope,
  deployment,
  sourceCommit,
  generatedAt: new Date().toISOString(),
  captureReference: captureReferenceArg,
  workspaceIdHash: createHash('sha256').update(workspaceId, 'utf8').digest('hex'),
  codeRetrieval: {
    enabled: enabled('ACE_ENABLE_EXPERIMENTAL_QDRANT'),
    qdrantEnabled: enabled('ACE_ENABLE_EXPERIMENTAL_QDRANT'),
    pinnedEmbeddingRequired: enabled('ACE_REQUIRE_PINNED_EMBEDDING'),
    localFallbackAllowed: enabled('ACE_ALLOW_LOCAL_FALLBACK'),
    embeddingProvider: process.env.ACE_EMBEDDING_PROVIDER?.trim() || 'fastembed/onnx',
    // The current production runtime constructs the direct TS Language Service.
    // If owner selection chooses Serena, release preflight must block until the
    // runtime itself is changed rather than relabeling this evidence.
    semanticProvider: 'typescript-language-service',
  },
  documentation: {
    enabled: vertexEnabled,
    cloudDocsOptIn,
  },
  memory: {
    enabled: enabled('ACE_ENABLE_GRAPHITI'),
    // Current Graphiti integration is an explicitly local stdio MCP boundary.
    localOnly: true,
  },
  worktree: {
    hostHelperEnabled: nonEmpty('ACE_WORKTREE_HELPER_URL'),
    mtlsRequired: nonEmpty('ACE_WORKTREE_HELPER_TLS_CA')
      && nonEmpty('ACE_WORKTREE_HELPER_TLS_CERT')
      && nonEmpty('ACE_WORKTREE_HELPER_TLS_KEY'),
  },
  cloudPermissions,
};

const verdict = evaluateRuntimeConfigEvidence(input, sourceCommit);
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}

const output = {
  ...input,
  currentCommit: sourceCommit,
  evidence: verdict.value.evidence,
  verdict: verdict.value,
  note: 'Safe configuration summary only: no token, certificate, raw workspace path, query, source bytes or private dialogue is retained.',
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');

process.stdout.write(JSON.stringify({
  output: outputArg,
  evidence: verdict.value.evidence,
  scope,
  deployment,
  failures: verdict.value.failures,
}) + '\n');

if (process.env.ACE_REQUIRE_RUNTIME_CONFIG_ACCEPTED === 'true'
  && verdict.value.evidence !== 'runtime-config-accepted') {
  process.exitCode = 2;
}
