import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  verifyHarborJobByteBinding,
} from '../src/application/harbor-byte-binding.js';
import {
  effectiveHarborConfigurationPayload,
  harborTaskBindingDigestInput,
} from '../src/domain/harbor-byte-binding.js';
import { validateHarborFourArmDesign } from '../src/domain/harbor-four-arm.js';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const writeFrozenManifest = async (root: string, taskPath: string, taskSha256: string): Promise<string> => {
  const bytes = JSON.stringify({
    schemaVersion: 1,
    status: 'frozen_harbor_task_manifest',
    repositories: [{ id: 'ace', revision: '1'.repeat(40) }, { id: 'external', revision: '2'.repeat(40) }],
    tasks: [{ id: 'task-1', repositoryId: 'ace', path: taskPath, sha256: taskSha256 }],
  }) + '\n';
  await writeFile(join(root, 'manifest.json'), bytes, 'utf8');
  return sha256(bytes);
};

const baseJob = (root: string, taskPath: string, configPath: string, taskSha256: string, configSha256: string, manifestSha256: string) => {
  const jobValue = {
    tasks: [{ path: taskPath }],
    agents: [{
      name: 'codex',
      model_name: 'gpt-5.6-luna',
      env: { CODEX_FORCE_AUTH_JSON: '1' },
      kwargs: { reasoning_effort: 'high', config: configPath },
    }],
    environment: { type: 'docker', delete: true },
  };
  return {
    ...jobValue,
    external_evidence: {
      schema_version: 1,
      task_manifest_path: join(root, 'manifest.json'),
      task_manifest_sha256: manifestSha256,
      task_bytes_sha256: sha256(harborTaskBindingDigestInput([{ id: 'task-1', repositoryId: 'ace', path: taskPath, sha256: taskSha256 }])),
      task_bindings: [{ id: 'task-1', repository_id: 'ace', path: taskPath, sha256: taskSha256 }],
      repository_revisions: { ace: '1'.repeat(40), external: '2'.repeat(40) },
      model_identity: 'openai/gpt-5.6-luna',
      provider_identity: 'codex-oauth|harbor=0.24.0',
      runtime_image_identity: 'ghcr.io/example/codex@sha256:' + '3'.repeat(64),
      codex_config: {
        path: configPath,
        bytes_sha256: configSha256,
        effective_sha256: sha256(effectiveHarborConfigurationPayload(jobValue, configSha256)),
      },
    },
  };
};

test('Harbor byte binding accepts the exact frozen task, manifest and config bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-binding-'));
  const taskPath = join(root, 'task.md');
  const configPath = join(root, 'dense.toml');
  await writeFile(taskPath, 'task bytes v1\n', 'utf8');
  await writeFile(configPath, 'mcp = "ace"\n', 'utf8');
  const manifestSha256 = await writeFrozenManifest(root, taskPath, sha256('task bytes v1\n'));
  const job = baseJob(root, taskPath, configPath, sha256('task bytes v1\n'), sha256('mcp = "ace"\n'), manifestSha256);

  const result = await verifyHarborJobByteBinding(job, { workspaceRoot: root });
  assert.equal(result._tag, 'Ok');
  const identityDrift = await verifyHarborJobByteBinding(job, {
    workspaceRoot: root,
    expectedModelIdentity: 'different/model',
    expectedProviderIdentity: 'codex-oauth|harbor=0.24.0',
    expectedRuntimeImageIdentity: 'ghcr.io/example/codex@sha256:' + '3'.repeat(64),
  });
  assert.equal(identityDrift._tag, 'Err');
  const configSettingDrift = await verifyHarborJobByteBinding({
    ...job,
    agents: [{
      name: 'codex',
      model_name: 'gpt-5.6-luna',
      env: { CODEX_FORCE_AUTH_JSON: '1', EXTRA_SETTING: 'changed' },
      kwargs: { reasoning_effort: 'high', config: configPath },
    }],
  }, { workspaceRoot: root });
  assert.equal(configSettingDrift._tag, 'Err');
});

test('Harbor binding rejects a wrong declared task SHA instead of trusting the manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-binding-'));
  const taskPath = join(root, 'task.md');
  const configPath = join(root, 'dense.toml');
  await writeFile(taskPath, 'actual task bytes\n', 'utf8');
  await writeFile(configPath, 'mcp = "ace"\n', 'utf8');
  const manifestSha256 = await writeFrozenManifest(root, taskPath, 'a'.repeat(64));
  const job = baseJob(root, taskPath, configPath, 'a'.repeat(64), sha256('mcp = "ace"\n'), manifestSha256);

  const result = await verifyHarborJobByteBinding(job, { workspaceRoot: root });
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'DIGEST_MISMATCH');
});

test('Harbor binding rejects task and config changes after freeze', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-binding-'));
  const taskPath = join(root, 'task.md');
  const configPath = join(root, 'dense.toml');
  await writeFile(taskPath, 'task bytes v1\n', 'utf8');
  await writeFile(configPath, 'mcp = "ace"\n', 'utf8');
  const manifestSha256 = await writeFrozenManifest(root, taskPath, sha256('task bytes v1\n'));
  const job = baseJob(root, taskPath, configPath, sha256('task bytes v1\n'), sha256('mcp = "ace"\n'), manifestSha256);
  await writeFile(taskPath, 'task bytes v2\n', 'utf8');

  const changedTask = await verifyHarborJobByteBinding(job, { workspaceRoot: root });
  assert.equal(changedTask._tag, 'Err');
  await writeFile(taskPath, 'task bytes v1\n', 'utf8');
  await writeFile(configPath, 'mcp = "other"\n', 'utf8');
  const changedConfig = await verifyHarborJobByteBinding(job, { workspaceRoot: root });
  assert.equal(changedConfig._tag, 'Err');
  await writeFile(configPath, 'mcp = "ace"\n', 'utf8');
  await writeFile(join(root, 'manifest.json'), '{"revision":"changed"}\n', 'utf8');
  const changedManifest = await verifyHarborJobByteBinding(job, { workspaceRoot: root });
  assert.equal(changedManifest._tag, 'Err');
});

test('Harbor binding rejects a missing config path and four-arm identity drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-harbor-binding-'));
  const taskPath = join(root, 'task.md');
  const configPath = join(root, 'dense.toml');
  await writeFile(taskPath, 'task bytes\n', 'utf8');
  const manifestSha256 = await writeFrozenManifest(root, taskPath, sha256('task bytes\n'));
  const job = baseJob(root, taskPath, configPath, sha256('task bytes\n'), sha256('config\n'), manifestSha256);
  const missingConfig = await verifyHarborJobByteBinding(job, { workspaceRoot: root });
  assert.equal(missingConfig._tag, 'Err');
  if (missingConfig._tag === 'Err') assert.equal(missingConfig.error.code, 'FILE_NOT_FOUND');
  const revisionDrift = await verifyHarborJobByteBinding({
    ...job,
    external_evidence: {
      ...job.external_evidence,
      repository_revisions: { ace: '9'.repeat(40), external: '2'.repeat(40) },
    },
  }, { workspaceRoot: root });
  assert.equal(revisionDrift._tag, 'Err');

  const evidence = {
    external_evidence: {
      task_manifest_path: join(root, 'manifest.json'),
      schema_version: 1,
      task_manifest_sha256: 'a'.repeat(64),
      task_bytes_sha256: 'b'.repeat(64),
      task_bindings: [{ id: 'task-1', repository_id: 'ace', path: 'ace/task.md', sha256: 'c'.repeat(64) }],
      repository_revisions: { ace: '1'.repeat(40), external: '2'.repeat(40) },
      model_identity: 'openai/gpt-5.6-luna',
      provider_identity: 'codex-oauth|harbor=0.24.0',
      runtime_image_identity: 'image@sha256:' + '3'.repeat(64),
      codex_config: { path: 'dense.toml', bytes_sha256: 'd'.repeat(64), effective_sha256: 'e'.repeat(64) },
    },
  };
  const arm = (config: string) => ({
    tasks: ['ace/task-a', 'ace/task-a', 'ace/task-a', 'ace/task-a', 'ace/task-a', 'ace/task-b', 'ace/task-b', 'ace/task-b', 'ace/task-b', 'ace/task-b', 'ace/task-c', 'ace/task-c', 'ace/task-c', 'ace/task-c', 'ace/task-c', 'external/task-a', 'external/task-a', 'external/task-a', 'external/task-a', 'external/task-a', 'external/task-b', 'external/task-b', 'external/task-b', 'external/task-b', 'external/task-b', 'external/task-c', 'external/task-c', 'external/task-c', 'external/task-c', 'external/task-c'],
    agents: [{ name: 'codex', model_name: 'gpt-5.6-luna', env: { CODEX_FORCE_AUTH_JSON: '1' }, kwargs: { reasoning_effort: 'high', config } }],
  });
  const design = validateHarborFourArmDesign(
    { ...arm('native.toml'), ...evidence },
    { ...arm('dense.toml'), ...evidence },
    { ...arm('hybrid.toml'), ...evidence },
    { ...arm('delta.toml'), ...evidence, external_evidence: { ...evidence.external_evidence, runtime_image_identity: 'image@sha256:' + '4'.repeat(64) } },
    { repositoryIds: ['ace', 'external'], requireExternalEvidence: true },
  );
  assert.equal(design._tag, 'Err');
});
