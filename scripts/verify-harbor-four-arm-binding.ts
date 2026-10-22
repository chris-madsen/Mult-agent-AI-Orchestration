import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyHarborJobByteBinding } from '../src/application/harbor-byte-binding.js';
import { validateHarborFourArmDesign } from '../src/domain/harbor-four-arm.js';

const [nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath] = process.argv.slice(2);
if ([nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath].some((value) => value === undefined)) {
  throw new Error('Usage: ACE_HARBOR_REPOSITORY_IDS=repo-a,repo-b ACE_HARBOR_MODEL_IDENTITY=... ACE_HARBOR_PROVIDER_IDENTITY=... ACE_HARBOR_RUNTIME_IMAGE_IDENTITY=... tsx scripts/verify-harbor-four-arm-binding.ts <native-job.json> <dense-job.json> <hybrid-job.json> <hybrid-delta-job.json>');
}

const requiredIdentity = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`BLOCKED: ${name} is required to verify Harbor execution identity`);
  return value;
};
const repositoryIds = (process.env.ACE_HARBOR_REPOSITORY_IDS ?? '')
  .split(',')
  .map((repositoryId) => repositoryId.trim())
  .filter((repositoryId) => repositoryId.length > 0);
if (repositoryIds.length === 0) throw new Error('BLOCKED: ACE_HARBOR_REPOSITORY_IDS must identify every frozen repository');
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;
const [nativeJob, denseJob, hybridJob, deltaJob] = await Promise.all([
  readJson(nativeJobPath as string),
  readJson(denseJobPath as string),
  readJson(hybridJobPath as string),
  readJson(deltaJobPath as string),
]);
const design = validateHarborFourArmDesign(nativeJob, denseJob, hybridJob, deltaJob, {
  repositoryIds,
  requireExternalEvidence: true,
});
if (design._tag === 'Err') throw new Error(`BLOCKED: ${design.error.code}: ${design.error.path}: ${design.error.message}`);
const workspaceRoot = resolve(process.env.ACE_HARBOR_WORKSPACE_ROOT?.trim() || process.cwd());
const expectedModelIdentity = requiredIdentity('ACE_HARBOR_MODEL_IDENTITY');
const expectedProviderIdentity = requiredIdentity('ACE_HARBOR_PROVIDER_IDENTITY');
const expectedRuntimeImageIdentity = requiredIdentity('ACE_HARBOR_RUNTIME_IMAGE_IDENTITY');
const checks = await Promise.all([
  verifyHarborJobByteBinding(nativeJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
  verifyHarborJobByteBinding(denseJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
  verifyHarborJobByteBinding(hybridJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
  verifyHarborJobByteBinding(deltaJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
]);
for (const [index, check] of checks.entries()) {
  if (check._tag === 'Err') throw new Error(`BLOCKED: Harbor job ${index}: ${check.error.code}: ${check.error.path}: ${check.error.message}`);
}
process.stdout.write(JSON.stringify({
  status: 'verified-before-run',
  workspaceRoot,
  taskManifestSha256: design.value.native.externalEvidence?.taskManifestSha256,
  taskBytesSha256: design.value.native.externalEvidence?.taskBytesSha256,
  modelIdentity: expectedModelIdentity,
  providerIdentity: expectedProviderIdentity,
  runtimeImageIdentity: expectedRuntimeImageIdentity,
  jobs: [nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath],
}) + '\n');
