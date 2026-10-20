import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  evaluateCodeReleasePreflight,
  type CodeReleaseDeployment,
  type CodeReleaseExternalEvidence,
} from '../src/domain/code-release-preflight.js';
import type { ReleaseOwnerApproval } from '../src/domain/release-preflight.js';
import { validateReleaseExternalEvidenceDocument } from '../src/domain/release-external-evidence.js';

interface CodeReleasePolicy {
  readonly schemaVersion: 1;
  readonly scope: 'code-only';
  readonly deployment: CodeReleaseDeployment;
  readonly ownerApproval: ReleaseOwnerApproval;
  readonly artifacts: {
    readonly dbc: string;
    readonly embeddingSelection: string;
    readonly semanticSelection: string;
    readonly retrievalQuality: string;
    readonly harborThreeArm: string;
  };
  readonly externalEvidence: readonly {
    readonly name: CodeReleaseExternalEvidence['name'];
    readonly path: string;
  }[];
}

const containedPath = (input: string): string => {
  const absolute = resolve(input);
  const rel = relative(process.cwd(), absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.length === 0) {
    throw new Error(`code release evidence path must be repository-contained: ${input}`);
  }
  return rel.split('\\').join('/');
};

const readEvidence = async (path: string): Promise<{
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly value: unknown;
  readonly sha256: string;
}> => {
  const safe = containedPath(path);
  const bytes = await readFile(safe);
  return {
    path: safe,
    bytes,
    value: JSON.parse(bytes.toString('utf8')) as unknown,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

const [policyArg, outputArg] = process.argv.slice(2);
if (policyArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/code-release-preflight.ts <code-release-policy.json> <output.json>');
}

const policyEvidence = await readEvidence(policyArg);
const policy = policyEvidence.value as Partial<CodeReleasePolicy>;
if (policy.schemaVersion !== 1
  || policy.scope !== 'code-only'
  || (policy.deployment !== 'host' && policy.deployment !== 'k3s')
  || typeof policy.ownerApproval !== 'object' || policy.ownerApproval === null
  || typeof policy.artifacts !== 'object' || policy.artifacts === null
  || !Array.isArray(policy.externalEvidence)) {
  throw new Error('code-only release policy schema is invalid');
}
const artifacts = policy.artifacts as CodeReleasePolicy['artifacts'];
for (const key of ['dbc', 'embeddingSelection', 'semanticSelection', 'retrievalQuality', 'harborThreeArm'] as const) {
  if (typeof artifacts[key] !== 'string' || artifacts[key].trim().length === 0) {
    throw new Error(`code-only release policy artifacts.${key} is required`);
  }
}

const [dbc, embedding, semantic, retrieval, harbor] = await Promise.all([
  readEvidence(artifacts.dbc),
  readEvidence(artifacts.embeddingSelection),
  readEvidence(artifacts.semanticSelection),
  readEvidence(artifacts.retrievalQuality),
  readEvidence(artifacts.harborThreeArm),
]);

const dbcRoot = typeof dbc.value === 'object' && dbc.value !== null && !Array.isArray(dbc.value)
  ? dbc.value as Record<string, unknown>
  : undefined;
if (!Array.isArray(dbcRoot?.records)) throw new Error('DBC evidence manifest records are missing');
for (const [recordIndex, rawRecord] of dbcRoot.records.entries()) {
  if (typeof rawRecord !== 'object' || rawRecord === null || Array.isArray(rawRecord)) {
    throw new Error(`DBC record ${recordIndex} is invalid`);
  }
  const dbcRecord = rawRecord as Record<string, unknown>;
  if (!Array.isArray(dbcRecord.artifacts)) throw new Error(`DBC record ${recordIndex} artifacts are missing`);
  for (const [artifactIndex, rawArtifact] of dbcRecord.artifacts.entries()) {
    if (typeof rawArtifact !== 'object' || rawArtifact === null || Array.isArray(rawArtifact)) {
      throw new Error(`DBC artifact ${recordIndex}:${artifactIndex} is invalid`);
    }
    const artifact = rawArtifact as Record<string, unknown>;
    if (typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string') {
      throw new Error(`DBC artifact ${recordIndex}:${artifactIndex} identity is incomplete`);
    }
    const retained = await readEvidence(artifact.path);
    if (retained.sha256 !== artifact.sha256) {
      throw new Error(`DBC artifact digest mismatch: ${retained.path}`);
    }
  }
}

const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
const allowedExternal = new Set<CodeReleaseExternalEvidence['name']>(['supply-chain', 'k3s-worktree']);
const externalEvidence: CodeReleaseExternalEvidence[] = [];
const externalArtifacts: Array<{ readonly name: string; readonly path: string; readonly sha256: string }> = [];
for (const raw of policy.externalEvidence) {
  if (typeof raw !== 'object' || raw === null
    || typeof raw.name !== 'string' || !allowedExternal.has(raw.name as CodeReleaseExternalEvidence['name'])
    || typeof raw.path !== 'string') {
    throw new Error('code-only externalEvidence entries require an allowed name/path');
  }
  const name = raw.name as CodeReleaseExternalEvidence['name'];
  const evidence = await readEvidence(raw.path);
  const validated = validateReleaseExternalEvidenceDocument(name, evidence.value, currentCommit);
  if (validated._tag === 'Err') {
    throw new Error(`${validated.error.code}: ${validated.error.path}: ${validated.error.message}`);
  }
  externalEvidence.push({
    name,
    evidence: validated.value.evidence,
    sha256: evidence.sha256,
    document: evidence.value,
  });
  externalArtifacts.push({ name, path: evidence.path, sha256: evidence.sha256 });
}
const verdict = evaluateCodeReleasePreflight({
  currentCommit,
  deployment: policy.deployment,
  dbc: dbc.value,
  embeddingSelection: embedding.value,
  semanticSelection: semantic.value,
  retrievalQuality: retrieval.value,
  harborThreeArm: harbor.value,
  externalEvidence,
  ownerApproval: policy.ownerApproval as ReleaseOwnerApproval,
});
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: 'code-only',
  deployment: policy.deployment,
  currentCommit,
  policy: { path: policyEvidence.path, sha256: policyEvidence.sha256 },
  evidence: {
    dbc: { path: dbc.path, sha256: dbc.sha256 },
    embeddingSelection: { path: embedding.path, sha256: embedding.sha256 },
    semanticSelection: { path: semantic.path, sha256: semantic.sha256 },
    retrievalQuality: { path: retrieval.path, sha256: retrieval.sha256 },
    harborThreeArm: { path: harbor.path, sha256: harbor.sha256 },
    external: externalArtifacts,
  },
  verdict: verdict.value,
  note: 'READY_CODE_ONLY authorizes only the code capability for this exact commit/deployment. It says nothing about documentation or memory readiness and is not a 5x token-savings claim.',
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputArg,
  currentCommit,
  scope: 'code-only',
  deployment: policy.deployment,
  status: verdict.value.status,
  failures: verdict.value.failures,
}) + '\n');
if (process.env.ACE_REQUIRE_CODE_RELEASE_READY === 'true' && verdict.value.status !== 'READY_CODE_ONLY') {
  process.exitCode = 2;
}
