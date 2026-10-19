import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  evaluateReleasePreflight,
  type ReleaseExternalEvidence,
  type ReleaseOwnerApproval,
} from '../src/domain/release-preflight.js';

interface ReleasePolicy {
  readonly schemaVersion: 1;
  readonly ownerApproval: ReleaseOwnerApproval;
  readonly artifacts: {
    readonly dbc: string;
    readonly embeddingSelection: string;
    readonly semanticSelection: string;
    readonly retrievalQuality: string;
    readonly harborThreeArm: string;
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
  throw new Error('Usage: tsx scripts/release-preflight.ts <release-policy.json> <output.json>');
}

const policyEvidence = await readEvidence(policyArg);
const policy = policyEvidence.value as Partial<ReleasePolicy>;
if (policy.schemaVersion !== 1
  || typeof policy.ownerApproval !== 'object' || policy.ownerApproval === null
  || typeof policy.artifacts !== 'object' || policy.artifacts === null
  || !Array.isArray(policy.externalEvidence)) {
  throw new Error('release policy schema is invalid');
}
const artifacts = policy.artifacts as ReleasePolicy['artifacts'];
for (const key of ['dbc', 'embeddingSelection', 'semanticSelection', 'retrievalQuality', 'harborThreeArm'] as const) {
  if (typeof artifacts[key] !== 'string' || artifacts[key].trim().length === 0) {
    throw new Error(`release policy artifacts.${key} is required`);
  }
}

const [dbc, embedding, semantic, retrieval, harbor] = await Promise.all([
  readEvidence(artifacts.dbc),
  readEvidence(artifacts.embeddingSelection),
  readEvidence(artifacts.semanticSelection),
  readEvidence(artifacts.retrievalQuality),
  readEvidence(artifacts.harborThreeArm),
]);

const externalEvidence: ReleaseExternalEvidence[] = [];
const externalArtifacts: Array<{ readonly name: string; readonly path: string; readonly sha256: string }> = [];
for (const raw of policy.externalEvidence) {
  if (typeof raw !== 'object' || raw === null
    || typeof raw.name !== 'string' || typeof raw.path !== 'string') {
    throw new Error('release policy externalEvidence entries require name/path');
  }
  const evidence = await readEvidence(raw.path);
  const root = typeof evidence.value === 'object' && evidence.value !== null && !Array.isArray(evidence.value)
    ? evidence.value as Record<string, unknown>
    : undefined;
  if (typeof root?.evidence !== 'string' || root.evidence.trim().length === 0) {
    throw new Error(`external evidence ${raw.name} has no evidence label`);
  }
  externalEvidence.push({
    name: raw.name,
    evidence: root.evidence,
    sha256: evidence.sha256,
  });
  externalArtifacts.push({ name: raw.name, path: evidence.path, sha256: evidence.sha256 });
}

const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
const verdict = evaluateReleasePreflight({
  currentCommit,
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
