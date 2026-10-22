import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  dockerImageDigestPattern,
  dockerImageMatchesDigest,
  validateMatchingFeedbackHarborJobs,
  type FeedbackHarborJobIdentity,
  type FeedbackHarborPairIdentity,
} from '../src/domain/feedback-harbor-config.js';
import {
  codexAuthenticationRoute,
  inspectCodexAuthJson,
  validateFeedbackImageOverride,
  validateFeedbackPreflightBinding,
} from '../src/domain/feedback-preflight.js';
import {
  validateFeedbackExperimentManifest,
  type FeedbackExperimentManifest,
} from '../src/domain/feedback-loop-experiment.js';
import { verifyCompiledRuntimeProvenance } from '../src/application/runtime-provenance.js';

type CheckStatus = 'ready' | 'not_ready' | 'unknown';

interface PreflightCheck {
  readonly status: CheckStatus;
  readonly reason: string;
  readonly identity?: string;
}

interface PreflightManifest {
  readonly schemaVersion: 2;
  readonly status: 'READY' | 'BLOCKED';
  readonly generatedAt: string;
  readonly sourceCommit: string;
  readonly runtimeRoot: string;
  readonly authenticationRoute: typeof codexAuthenticationRoute;
  readonly checks: Readonly<Record<string, PreflightCheck>>;
  readonly runtime?: {
    readonly model: string;
    readonly reasoningEffort: FeedbackHarborJobIdentity['reasoningEffort'];
    readonly harborVersion: string;
    readonly imageDigest?: string;
    readonly taskImages?: readonly { readonly reference: string; readonly digest: string }[];
    readonly mode: 'cold';
    readonly nConcurrentTrials: 1;
    readonly nAttempts: 1;
    readonly authenticationRoute: typeof codexAuthenticationRoute;
    readonly embeddingLibraryPath?: string;
  };
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const command = (name: string, args: readonly string[], environment?: Readonly<Record<string, string>>): PreflightCheck => {
  const result = spawnSync(name, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(environment === undefined ? {} : { env: { ...process.env, ...environment } }),
  });
  if (result.error !== undefined) return { status: 'not_ready', reason: `${name} unavailable` };
  if (result.status !== 0) return { status: 'not_ready', reason: `${name} exited ${String(result.status)}` };
  const identity = result.stdout.trim().split(/\r?\n/u)[0]?.trim();
  return {
    status: identity === undefined || identity.length === 0 ? 'unknown' : 'ready',
    reason: identity === undefined || identity.length === 0 ? `${name} returned no identity` : 'provider executable responded',
    ...(identity === undefined || identity.length === 0 ? {} : { identity: identity.slice(0, 200) }),
  };
};

const embeddingCache = async (): Promise<PreflightCheck> => {
  const configured = process.env.FASTEMBED_CACHE_PATH?.trim();
  const candidates = configured === undefined || configured.length === 0
    ? ['.cache/ace-fastembed', '.venv-embedding-fast']
    : [configured];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { status: 'ready', reason: 'embedding cache path is accessible', identity: resolve(candidate) };
    } catch {
      // Probe the next explicitly permitted local candidate.
    }
  }
  return { status: 'not_ready', reason: 'embedding cache path is not accessible' };
};

const harborDataset = (): PreflightCheck => {
  const result = spawnSync('harbor', ['datasets', 'list', '--legacy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error !== undefined || result.status !== 0) return { status: 'not_ready', reason: 'Harbor dataset registry could not be queried' };
  return result.stdout.includes('scale-ai/swe-atlas-qna')
    ? { status: 'ready', reason: 'pinned SWE-Atlas dataset is listed by the registry', identity: 'scale-ai/swe-atlas-qna' }
    : { status: 'not_ready', reason: 'pinned scale-ai/swe-atlas-qna is not listed by the Harbor registry' };
};

const codexAuth = async (): Promise<PreflightCheck> => {
  // Harbor's CODEX_FORCE_AUTH_JSON route resolves Path.home()/.codex/auth.json
  // on the host. Do not inspect CODEX_HOME here unless the generated job also
  // switches to CODEX_AUTH_JSON_PATH.
  const authPath = resolve(process.env.HOME ?? '/', '.codex', 'auth.json');
  if (!existsSync(authPath)) return { status: 'not_ready', reason: 'Codex auth file is unavailable' };
  try {
    return inspectCodexAuthJson(authPath, await readFile(authPath, 'utf8'));
  } catch {
    return { status: 'not_ready', reason: 'Codex auth file could not be read' };
  }
};

const sourceCheckout = (): { readonly check: PreflightCheck; readonly commit: string } => {
  try {
    const runtimeRoot = resolve('.');
    const actualRoot = resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
    if (realpathSync(actualRoot) !== realpathSync(runtimeRoot)) {
      return { check: { status: 'not_ready', reason: 'preflight must run from the ACE Git checkout root' }, commit };
    }
    if (!/^[a-f0-9]{40,64}$/iu.test(commit)) {
      return { check: { status: 'not_ready', reason: 'ACE Git commit identity is invalid' }, commit: 'unknown' };
    }
    if (dirty.length > 0) {
      return { check: { status: 'not_ready', reason: 'ACE checkout is dirty; exact-current preflight requires frozen source bytes' }, commit };
    }
    return { check: { status: 'ready', reason: 'ACE checkout is clean at an exact Git commit', identity: commit }, commit };
  } catch {
    return { check: { status: 'not_ready', reason: 'ACE Git checkout identity could not be verified' }, commit: 'unknown' };
  }
};

const compiledRuntime = async (): Promise<PreflightCheck> => {
  const runtimeRoot = resolve('.');
  const executable = resolve(runtimeRoot, 'dist/bin/ace-mcp.js');
  if (!existsSync(executable)) return { status: 'not_ready', reason: 'compiled ACE runtime is missing' };
  const verified = await verifyCompiledRuntimeProvenance(runtimeRoot, executable);
  return verified._tag === 'Err'
    ? { status: 'not_ready', reason: verified.error.message }
    : {
      status: 'ready',
      reason: 'compiled ACE runtime provenance matches the current source checkout',
      identity: `${verified.value.sourceCommit}:${verified.value.executableSha256}`,
    };
};

const aceConfigDigestCheck = async (
  jobs: FeedbackHarborPairIdentity | undefined,
  experiment: FeedbackExperimentManifest | undefined,
): Promise<PreflightCheck> => {
  if (jobs === undefined || experiment === undefined) {
    return { status: 'not_ready', reason: 'ACE config digest requires frozen Harbor jobs and experiment manifest' };
  }
  if (!jobs.aceConfigPath.startsWith('/ace/')) {
    return { status: 'not_ready', reason: 'ACE job config path is not inside the mounted /ace checkout' };
  }
  const runtimeRoot = resolve('.');
  const hostPath = resolve(runtimeRoot, jobs.aceConfigPath.slice('/ace/'.length));
  const containment = relative(runtimeRoot, hostPath);
  if (isAbsolute(containment) || containment === '..' || containment.startsWith('../')) {
    return { status: 'not_ready', reason: 'ACE job config path escapes the current checkout' };
  }
  try {
    const actual = createHash('sha256').update(await readFile(hostPath)).digest('hex');
    return actual === experiment.aceConfigDigest
      ? { status: 'ready', reason: 'ACE job config bytes match the experiment digest', identity: actual }
      : { status: 'not_ready', reason: 'ACE job config digest does not match experiment manifest' };
  } catch {
    return { status: 'not_ready', reason: 'ACE job config bytes could not be read' };
  }
};

const qdrant = async (url: string): Promise<PreflightCheck> => {
  try {
    const response = await fetch(`${url.replace(/\/$/u, '')}/collections`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { status: 'not_ready', reason: `Qdrant returned HTTP ${response.status}` };
    return { status: 'ready', reason: 'Qdrant collections endpoint responded', identity: url };
  } catch (error) {
    return { status: 'not_ready', reason: error instanceof Error ? error.message : 'Qdrant request failed' };
  }
};

const harborJobIdentity = async (
  nativeJobPath: string | undefined,
  aceJobPath: string | undefined,
): Promise<{ readonly check: PreflightCheck; readonly identity?: FeedbackHarborPairIdentity }> => {
  if (nativeJobPath === undefined || aceJobPath === undefined) {
    return { check: { status: 'not_ready', reason: 'native and ACE optional Harbor job paths are required' } };
  }
  try {
    const [nativeBytes, aceBytes] = await Promise.all([readFile(nativeJobPath), readFile(aceJobPath)]);
    const nativeJob = JSON.parse(nativeBytes.toString('utf8')) as unknown;
    const aceJob = JSON.parse(aceBytes.toString('utf8')) as unknown;
    const checked = validateMatchingFeedbackHarborJobs(nativeJob, aceJob);
    if (checked._tag === 'Err') return { check: { status: 'not_ready', reason: checked.error.message } };
    return {
      check: { status: 'ready', reason: 'native and ACE optional jobs pin the same serial model/runtime identity', identity: checked.value.model },
      identity: checked.value,
    };
  } catch (error) {
    return { check: { status: 'not_ready', reason: error instanceof Error ? error.message : 'Harbor job identity could not be read' } };
  }
};

const inspectDockerImage = (target: string, digest: string): PreflightCheck => {
  if (!dockerImageDigestPattern.test(digest)) return { status: 'not_ready', reason: `invalid Docker image digest for ${target}` };
  const result = spawnSync('docker', ['image', 'inspect', '--format', '{{json .}}', target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined || result.status !== 0) {
    return { status: 'not_ready', reason: `Docker image ${target} is not available for inspection at ${digest}` };
  }
  try {
    const inspection = JSON.parse(result.stdout.trim()) as unknown;
    return dockerImageMatchesDigest(digest, inspection)
      ? { status: 'ready', reason: 'Docker resolved the pinned image digest', identity: `${target}@${digest}` }
      : { status: 'not_ready', reason: `Docker inspection for ${target} did not match image digest ${digest}` };
  } catch {
    return { status: 'not_ready', reason: 'Docker image inspection returned malformed JSON' };
  }
};

const dockerImages = (
  imageDigest: string | undefined,
  taskImages: readonly { readonly reference: string; readonly digest: string }[] | undefined,
): PreflightCheck => {
  const images = taskImages !== undefined && taskImages.length > 0
    ? taskImages.map((image) => ({ target: image.reference, digest: image.digest }))
    : imageDigest === undefined ? [] : [{ target: imageDigest, digest: imageDigest }];
  if (images.length === 0) return { status: 'not_ready', reason: 'an explicit Docker image digest or task image manifest is required' };
  const checks = images.map((image) => inspectDockerImage(image.target, image.digest));
  const failed = checks.find((check) => check.status !== 'ready');
  return failed ?? { status: 'ready', reason: 'Docker resolved every pinned task image', identity: images.map((image) => `${image.target}@${image.digest}`).join(',') };
};

const parseArgs = (): {
  readonly outputDirectory: string;
  readonly embeddingPython: string;
  readonly embeddingLibraryPath?: string;
  readonly qdrantUrl: string;
  readonly nativeJobPath?: string;
  readonly aceJobPath?: string;
  readonly imageDigest?: string;
  readonly experimentManifestPath?: string;
} => {
  const args = process.argv.slice(2);
  let outputDirectory = process.env.ACE_FEEDBACK_OUTPUT?.trim() || 'artifacts/feedback/preflight';
  let embeddingPython = process.env.ACE_EMBEDDING_PYTHON?.trim() || '.venv-embedding-fast/bin/python';
  let embeddingLibraryPath = process.env.ACE_EMBEDDING_LD_LIBRARY_PATH?.trim();
  let qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
  let nativeJobPath: string | undefined;
  let aceJobPath: string | undefined;
  let imageDigest: string | undefined;
  let experimentManifestPath: string | undefined;
  while (args.length > 0) {
    const current = args.shift();
    const value = args.shift();
    if (current === '--output' && value !== undefined) outputDirectory = value;
    else if (current === '--embedding-python' && value !== undefined) embeddingPython = value;
    else if (current === '--embedding-library-path' && value !== undefined) embeddingLibraryPath = value;
    else if (current === '--qdrant-url' && value !== undefined) qdrantUrl = value;
    else if (current === '--native-job' && value !== undefined) nativeJobPath = resolve(value);
    else if (current === '--ace-job' && value !== undefined) aceJobPath = resolve(value);
    else if (current === '--image-digest' && value !== undefined) imageDigest = value.trim();
    else if (current === '--experiment-manifest' && value !== undefined) experimentManifestPath = resolve(value);
    else throw new Error('Usage: tsx scripts/feedback-loop-preflight.ts [--output dir] [--embedding-python path] [--embedding-library-path path] [--qdrant-url url] [--native-job path] [--ace-job path] [--image-digest sha256:<64hex>] [--experiment-manifest path]');
  }
  return {
    outputDirectory: resolve(outputDirectory),
    embeddingPython,
    ...(embeddingLibraryPath === undefined || embeddingLibraryPath.length === 0 ? {} : { embeddingLibraryPath }),
    qdrantUrl,
    ...(nativeJobPath === undefined ? {} : { nativeJobPath }),
    ...(aceJobPath === undefined ? {} : { aceJobPath }),
    ...(imageDigest === undefined ? {} : { imageDigest }),
    ...(experimentManifestPath === undefined ? {} : { experimentManifestPath }),
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  let experimentManifest: FeedbackExperimentManifest | undefined;
  let manifestTaskImages: readonly { readonly reference: string; readonly digest: string }[] | undefined;
  let manifestImageDigest: string | undefined;
  if (args.experimentManifestPath !== undefined) {
    const experiment = validateFeedbackExperimentManifest(JSON.parse(await readFile(args.experimentManifestPath, 'utf8')) as unknown);
    if (experiment._tag === 'Err') throw new Error(`BLOCKED: ${experiment.error.path}: ${experiment.error.message}`);
    experimentManifest = experiment.value;
    manifestTaskImages = experiment.value.taskImages;
    manifestImageDigest = experiment.value.imageDigest;
  }
  const effectiveImageDigest = args.imageDigest ?? manifestImageDigest;
  const imageBindingFailures = validateFeedbackImageOverride(
    args.imageDigest,
    manifestImageDigest,
    manifestTaskImages ?? [],
  );
  const harborJobs = await harborJobIdentity(args.nativeJobPath, args.aceJobPath);
  const source = sourceCheckout();
  const currentSourceCommit = source.commit;
  const embeddingEnvironment = {
    ACE_EMBEDDING_PYTHON: args.embeddingPython,
    PYTHONDONTWRITEBYTECODE: '1',
    ...(args.embeddingLibraryPath === undefined ? {} : { ACE_EMBEDDING_LD_LIBRARY_PATH: args.embeddingLibraryPath }),
    ...(process.env.LD_PRELOAD?.trim() === undefined ? {} : { LD_PRELOAD: process.env.LD_PRELOAD.trim() }),
    ...(process.env.ACE_EMBEDDING_LD_PRELOAD?.trim() === undefined ? {} : { LD_PRELOAD: process.env.ACE_EMBEDDING_LD_PRELOAD.trim() }),
  };
  const sparseEmbeddingEnvironment = {
    ACE_SPARSE_EMBEDDING_PYTHON: process.env.ACE_SPARSE_EMBEDDING_PYTHON?.trim() || args.embeddingPython,
    PYTHONDONTWRITEBYTECODE: '1',
    ...(args.embeddingLibraryPath === undefined ? {} : { ACE_SPARSE_EMBEDDING_LD_LIBRARY_PATH: args.embeddingLibraryPath }),
    ...(process.env.ACE_SPARSE_EMBEDDING_LD_PRELOAD?.trim() === undefined ? {} : { LD_PRELOAD: process.env.ACE_SPARSE_EMBEDDING_LD_PRELOAD.trim() }),
  };
  const checks: Record<string, PreflightCheck> = {
    sourceCheckout: source.check,
    runtimeProvenance: await compiledRuntime(),
    node: command('node', ['--version']),
    npm: command('npm', ['--version']),
    astGrep: command('./node_modules/.bin/ast-grep', ['--version']),
    typescriptLanguageServer: command('./node_modules/.bin/typescript-language-server', ['--version']),
    embeddingPython: existsSync('scripts/fastembed-worker.sh')
      ? command('bash', ['scripts/fastembed-worker.sh'], embeddingEnvironment)
      : command(args.embeddingPython, ['-c', 'import fastembed, onnxruntime; print(fastembed.__version__)'], embeddingEnvironment),
    sparseEmbedding: existsSync('scripts/fastembed-sparse-worker.sh')
      ? command('bash', ['scripts/fastembed-sparse-worker.sh'], sparseEmbeddingEnvironment)
      : { status: 'not_ready', reason: 'sparse FastEmbed worker launcher is missing' },
    harbor: command('harbor', ['--version']),
    harborRun: command('harbor', ['run', '--help']),
    harborDatasets: command('harbor', ['datasets', 'list']),
    harborDatasetPinned: harborDataset(),
    codex: command('codex', ['--version']),
    codexAuth: await codexAuth(),
    docker: command('docker', ['--version']),
    harborJobs: harborJobs.check,
    harborImageDigest: dockerImages(effectiveImageDigest, manifestTaskImages),
    aceConfigDigest: await aceConfigDigestCheck(harborJobs.identity, experimentManifest),
  };
  const harborVersion = checks.harbor.identity;
  if (experimentManifest === undefined) {
    checks.experimentBinding = { status: 'not_ready', reason: 'experiment manifest is required for exact-current feedback preflight' };
  } else if (harborJobs.identity === undefined || harborVersion === undefined) {
    checks.experimentBinding = { status: 'not_ready', reason: 'experiment identity cannot be bound until Harbor jobs/version are ready' };
  } else {
    const failures = [
      ...validateFeedbackPreflightBinding({
        currentSourceCommit,
        actualHarborVersion: harborVersion,
        expectedAuthenticationRoute: codexAuthenticationRoute,
        jobModel: harborJobs.identity.model,
        jobReasoningEffort: harborJobs.identity.reasoningEffort,
        experiment: experimentManifest,
      }),
      ...imageBindingFailures,
    ];
    checks.experimentBinding = failures.length === 0
      ? { status: 'ready', reason: 'experiment identity matches current checkout, Harbor jobs/version, image provenance and OAuth route' }
      : { status: 'not_ready', reason: `experiment identity mismatch: ${[...new Set(failures)].join(', ')}` };
  }
  checks.qdrant = await qdrant(args.qdrantUrl);
  checks.embeddingCache = await embeddingCache();
  const required = [
    'sourceCheckout', 'runtimeProvenance', 'node', 'npm', 'astGrep', 'typescriptLanguageServer',
    'embeddingPython', 'sparseEmbedding', 'harbor', 'harborRun', 'harborDatasetPinned', 'codex',
    'codexAuth', 'docker', 'harborJobs', 'harborImageDigest', 'aceConfigDigest', 'experimentBinding',
    'embeddingCache', 'qdrant',
  ];
  const blocked = required.filter((name) => checks[name]?.status !== 'ready');
  const manifest: PreflightManifest = {
    schemaVersion: 2,
    status: blocked.length === 0 ? 'READY' : 'BLOCKED',
    generatedAt: new Date().toISOString(),
    sourceCommit: currentSourceCommit,
    runtimeRoot: resolve('.'),
    authenticationRoute: codexAuthenticationRoute,
    checks,
    ...(blocked.length === 0 && harborJobs.identity !== undefined && (effectiveImageDigest !== undefined || manifestTaskImages !== undefined)
      ? {
        runtime: {
          model: harborJobs.identity.model,
          reasoningEffort: harborJobs.identity.reasoningEffort,
          harborVersion: checks.harbor.identity ?? 'unknown',
          ...(effectiveImageDigest === undefined ? {} : { imageDigest: effectiveImageDigest }),
          ...(manifestTaskImages === undefined ? {} : { taskImages: manifestTaskImages }),
          mode: 'cold' as const,
          nConcurrentTrials: 1 as const,
          nAttempts: 1 as const,
          authenticationRoute: codexAuthenticationRoute,
          ...(args.embeddingLibraryPath === undefined ? {} : { embeddingLibraryPath: args.embeddingLibraryPath }),
        },
      }
      : {}),
  };
  await mkdir(args.outputDirectory, { recursive: true });
  await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    status: manifest.status,
    blocked,
    output: resolve(args.outputDirectory, 'manifest.json'),
    manifestSha256: sha256(`${JSON.stringify(manifest, null, 2)}\n`),
  })}\n`);
  if (blocked.length > 0) process.exitCode = 2;
};

await main();
