import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  evaluateK3sWorktreeEvidence,
  type K3sWorktreeEvidenceInput,
} from '../src/domain/k3s-worktree-evidence.js';

const containedPath = (input: string): string => {
  const absolute = resolve(input);
  const rel = relative(process.cwd(), absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.length === 0) {
    throw new Error(`k3s evidence path must be repository-contained: ${input}`);
  }
  return rel.split('\\').join('/');
};

const sha256File = async (path: string): Promise<string> =>
  createHash('sha256').update(await readFile(containedPath(path))).digest('hex');

const [inputArg, outputArg] = process.argv.slice(2);
if (inputArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/k3s-worktree-evidence.ts <raw-run.json> <evidence.json>');
}

const inputPath = containedPath(inputArg);
const inputBytes = await readFile(inputPath);
const input = JSON.parse(inputBytes.toString('utf8')) as K3sWorktreeEvidenceInput;

for (const check of input.checks ?? []) {
  for (const artifact of check.artifacts ?? []) {
    const actual = await sha256File(artifact.path);
    if (actual !== artifact.sha256) {
      throw new Error(`k3s retained artifact digest mismatch: ${artifact.path}`);
    }
  }
}

const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
const verdict = evaluateK3sWorktreeEvidence(input, currentCommit);
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidence: verdict.value.evidence,
  sourceCommit: input.sourceCommit,
  currentCommit,
  rawRun: {
    path: inputPath,
    sha256: createHash('sha256').update(inputBytes).digest('hex'),
  },
  environment: input.environment,
  checks: input.checks.map((check) => ({
    id: check.id,
    verdict: check.verdict,
    artifacts: check.artifacts,
  })),
  verdict: verdict.value,
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputArg,
  evidence: verdict.value.evidence,
  allPassed: verdict.value.allPassed,
  failures: verdict.value.failures,
}) + '\n');

if (process.env.ACE_REQUIRE_K3S_WORKTREE_EVIDENCE === 'true' && !verdict.value.allPassed) {
  process.exitCode = 2;
}
