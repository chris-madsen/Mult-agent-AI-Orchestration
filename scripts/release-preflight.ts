import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  evaluateReleasePreflight,
  type ReleaseExternalEvidence,
  type ReleaseOwnerApproval,
} from '../src/domain/release-preflight.js';
import { validateReleaseExternalEvidenceDocument } from '../src/domain/release-external-evidence.js';

interface ReleasePolicy {
  readonly schemaVersion: 1;
  readonly ownerApproval: ReleaseOwnerApproval;
  readonly artifacts: {
    readonly dbc: string;
    readonly embeddingSelection: string;
    readonly semanticSelection: string;
    readonly retrievalQuality: string;
    readonly harborThreeArm: string;
    readonly resourceBudget: string;
    readonly runtimeConfig: string;
  };
  readonly externalEvidence: readonly {
    readonly name: ReleaseExternalEvidence['name'];
    readonly path: string;
  }[];
}

const containedPath = (input: string): string => {
  const absolute = resolve(input);
  const rel = relative(process.cwd(), absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.length === 0) {
    throw new Error(`release evidence path must be repository-contained: ${input}`);
  }
  return rel.split('\\').join('/');
};

const readEvidenceBytes = async (path: string): Promise<{
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}> => {
  const safe = containedPath(path);
  const bytes = await readFile(safe);
  return {
    path: safe,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
const readEvidenceJson = async (path: string): Promise<{
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly value: unknown;
  readonly sha256: string;
}> => {
  const evidence = await readEvidenceBytes(path);
  return { ...evidence, value: JSON.parse(evidence.bytes.toString('utf8')) as unknown };
};

const [policyArg, outputArg] = process.argv.slice(2);
if (policyArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/release-preflight.ts <release-policy.json> <output.json>');
}

const policyEvidence = await readEvidenceJson(policyArg);
const policy = policyEvidence.value as Partial<ReleasePolicy>;
if (policy.schemaVersion !== 1
  || typeof policy.ownerApproval !== 'object' || policy.ownerApproval === null
  || typeof policy.artifacts !== 'object' || policy.artifacts === null
  || !Array.isArray(policy.externalEvidence)) {
  throw new Error('release policy schema is invalid');
}
const artifacts = policy.artifacts as ReleasePolicy['artifacts'];
for (const key of ['dbc', 'embeddingSelection', 'semanticSelection', 'retrievalQuality', 'harborThreeArm', 'resourceBudget', 'runtimeConfig'] as const) {
  if (typeof artifacts[key] !== 'string' || artifacts[key].trim().length === 0) {
    throw new Error(`release policy artifacts.${key} is required`);
  }
}

const [dbc, embedding, semantic, retrieval, harbor, resourceBudget, runtimeConfig] = await Promise.all([
  readEvidenceJson(artifacts.dbc),
  readEvidenceJson(artifacts.embeddingSelection),
  readEvidenceJson(artifacts.semanticSelection),
  readEvidenceJson(artifacts.retrievalQuality),
  readEvidenceJson(artifacts.harborThreeArm),
  readEvidenceJson(artifacts.resourceBudget),
  readEvidenceJson(artifacts.runtimeConfig),
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
    const retained = await readEvidenceBytes(artifact.path);
    if (retained.sha256 !== artifact.sha256) {
      throw new Error(`DBC artifact digest mismatch: ${retained.path}`);
    }
  }
}

const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
const allowedExternalNames = new Set<ReleaseExternalEvidence['name']>([
  'graphiti',
  'graphiti-crash-recovery',
  'vertex',
  'k3s-worktree',
  'backup-restore',
  'supply-chain',
]);
const externalEvidence: ReleaseExternalEvidence[] = [];
const externalArtifacts: Array<{ readonly name: string; readonly path: string; readonly sha256: string }> = [];
for (const raw of policy.externalEvidence) {
  if (typeof raw !== 'object' || raw === null
    || typeof raw.name !== 'string'
    || !allowedExternalNames.has(raw.name as ReleaseExternalEvidence['name'])
    || typeof raw.path !== 'string') {
    throw new Error('release policy externalEvidence entries require an allowed name/path');
  }
  const name = raw.name as ReleaseExternalEvidence['name'];
  const evidence = await readEvidenceJson(raw.path);
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
const verdict = evaluateReleasePreflight({
  currentCommit,
  dbc: dbc.value,
  embeddingSelection: embedding.value,
  semanticSelection: semantic.value,
  retrievalQuality: retrieval.value,
  harborThreeArm: harbor.value,
  resourceBudget: resourceBudget.value,
  runtimeConfig: runtimeConfig.value,
  externalEvidence,
  ownerApproval: policy.ownerApproval as ReleaseOwnerApproval,
});
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  currentCommit,
  policy: { path: policyEvidence.path, sha256: policyEvidence.sha256 },
  evidence: {
    dbc: { path: dbc.path, sha256: dbc.sha256 },
    embeddingSelection: { path: embedding.path, sha256: embedding.sha256 },
    semanticSelection: { path: semantic.path, sha256: semantic.sha256 },
    retrievalQuality: { path: retrieval.path, sha256: retrieval.sha256 },
    harborThreeArm: { path: harbor.path, sha256: harbor.sha256 },
    resourceBudget: { path: resourceBudget.path, sha256: resourceBudget.sha256 },
    runtimeConfig: { path: runtimeConfig.path, sha256: runtimeConfig.sha256 },
    external: externalArtifacts,
  },
  verdict: verdict.value,
  note: 'READY means the supplied evidence satisfies the full unified-production preflight. It is not a claim of 5x token savings.',
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputArg,
  currentCommit,
  status: verdict.value.status,
  failures: verdict.value.failures,
}) + '\n');
if (process.env.ACE_REQUIRE_RELEASE_READY === 'true' && verdict.value.status !== 'READY') {
  process.exitCode = 2;
}
