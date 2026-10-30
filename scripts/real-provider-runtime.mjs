import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const git = (sourceRoot, args) => execFileSync('git', args, {
  cwd: sourceRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export const resolveRealProviderRuntime = async (scriptDirectory) => {
  const runnerRoot = resolve(scriptDirectory, '..');
  const sourceRoot = resolve(process.env.ACE_SOURCE_ROOT?.trim() || runnerRoot);
  const runtimeRoot = resolve(process.env.ACE_RUNTIME_ROOT?.trim() || sourceRoot);
  let sourceCommit;
  let sourceStatus;
  try {
    sourceCommit = git(sourceRoot, ['rev-parse', 'HEAD']).toLowerCase();
    sourceStatus = git(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  } catch {
    throw new Error(`BLOCKED: ACE_SOURCE_ROOT must be a Git worktree: ${sourceRoot}`);
  }
  if (sourceStatus.length > 0) {
    throw new Error(`BLOCKED: ACE_SOURCE_ROOT must be clean: ${sourceRoot}`);
  }

  let provenance;
  try {
    provenance = JSON.parse(await readFile(resolve(runtimeRoot, 'dist/runtime-provenance.json'), 'utf8'));
  } catch (cause) {
    throw new Error(`BLOCKED: ACE_RUNTIME_ROOT provenance is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (provenance?.sourceCommit !== sourceCommit) {
    throw new Error('BLOCKED: runtime source commit does not match ACE_SOURCE_ROOT HEAD');
  }

  let runnerCommit;
  let runnerStatus;
  try {
    runnerCommit = git(runnerRoot, ['rev-parse', 'HEAD']).toLowerCase();
    runnerStatus = git(runnerRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  } catch {
    throw new Error(`BLOCKED: real-provider runner must execute from a Git worktree: ${runnerRoot}`);
  }

  return {
    runnerRoot,
    runnerCommit,
    runnerClean: runnerStatus.length === 0,
    runtimeRoot,
    sourceCommit,
    executable: resolve(runtimeRoot, 'dist/bin/ace-mcp.js'),
    embeddingWorker: resolve(runtimeRoot, 'scripts/fastembed-worker.sh'),
    astGrepCommand: resolve(runtimeRoot, 'node_modules/.bin/ast-grep'),
  };
};
