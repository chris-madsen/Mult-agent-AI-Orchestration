import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { isSensitiveSourcePath } from '../src/domain/sensitive-path.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok } from '../src/domain/result.js';
import type { StructuralAnalysisPort, WorkspaceFilePort } from '../src/application/ports.js';

test('sensitive source path policy covers high-confidence credential artifacts without hiding ordinary secret-related code', () => {
  for (const path of [
    '.env',
    '.env.production',
    'config/.env.local',
    'secrets/app.ts',
    '.ssh/id_ed25519',
    'id_rsa',
    'certs/client.pem',
    'certs/client.key',
    'certs/client.p12',
    'certs/client.pfx',
    '.npmrc',
    'config/credentials.json',
    'config/service-account-prod.yaml',
    '.aws/credentials',
    '.kube/config',
    '.azure/accessTokens.json',
    '.config/gcloud/application_default_credentials.json',
    '.docker/config.json',
    '.gnupg/private-keys-v1.d/key.key',
    '.envrc',
    '.vault-token',
    'terraform.tfstate',
    'infra/terraform.tfstate.backup',
    'application_default_credentials.json',
  ]) assert.equal(isSensitiveSourcePath(path), true, path);

  for (const path of [
    'src/secret-service.ts',
    'src/credentials-provider.ts',
    'src/key-store.ts',
    'docs/secrets-design.md',
  ]) assert.equal(isSensitiveSourcePath(path), false, path);
});

test('sensitive paths are excluded before exact source reads or structural processing', async () => {
  const workspaceId = makeWorkspaceId('sensitive-path-workspace');
  assert.equal(workspaceId._tag, 'Ok');
  if (workspaceId._tag === 'Err') throw new Error(workspaceId.error.message);

  const ordinary = Buffer.from('export function secretService() { return true; }\n');
  const ordinaryDigest = createHash('sha256').update(ordinary).digest('hex') as never;
  const observations = [
    '.env.production',
    'secrets/runtime.ts',
    'private.pem',
    'credentials.json',
    'src/secret-service.ts',
  ].map((repoPath) => ({
    repoPath: repoPath as never,
    digest: (repoPath === 'src/secret-service.ts' ? ordinaryDigest : 'a'.repeat(64)) as never,
    sizeBytes: 10,
    state: 'tracked' as const,
    observedAtMs: 1,
  }));
  const readPaths: string[] = [];
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => Effect.succeed(ok({
      headRevision: 'b'.repeat(40),
      files: observations,
      removedPaths: [],
    })),
    readExact: (_root, repoPath) => {
      readPaths.push(repoPath);
      return Effect.succeed(ok({ bytes: ordinary, digest: ordinaryDigest }));
    },
  };
  let structuralCalls = 0;
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      structuralCalls += 1;
      return Effect.succeed(ok({
        repoPath: input.repoPath as never,
        sourceDigest: ordinaryDigest,
        symbols: [],
        hasSyntaxErrors: false,
      }));
    },
  };

  const result = await Effect.runPromise(buildLocalCodeIndex(files, workspaceId.value, '/repo', {
    generation: 1,
    structural,
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.deepEqual(readPaths, ['src/secret-service.ts']);
  assert.equal(structuralCalls, 1);
  assert.equal(result.value.coverage.policyExcludedPaths, 4);
  assert.equal(result.value.coverage.attemptedPaths, 1);
  assert.deepEqual(result.value.fileManifest.map((item) => item.repoPath), ['src/secret-service.ts']);
});
