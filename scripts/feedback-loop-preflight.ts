import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dockerImageDigestPattern,
  dockerImageMatchesDigest,
  validateMatchingFeedbackHarborJobs,
  type FeedbackHarborJobIdentity,
  type FeedbackHarborPairIdentity,
} from '../src/domain/feedback-harbor-config.js';
import {
  classifyFeedbackVerifierHttpStatus,
  hermesCodexAuthenticationRoute,
  inspectFeedbackVerifierConfiguration,
  inspectHermesAuthJson,
  validateFeedbackImageOverride,
  validateFeedbackPreflightBinding,
} from '../src/domain/feedback-preflight.js';
import {
  validateFeedbackExperimentManifest,
  validateFeedbackTaskManifest,
  type FeedbackExperimentManifest,
} from '../src/domain/feedback-loop-experiment.js';
import { verifyCompiledRuntimeProvenance } from '../src/application/runtime-provenance.js';
import { verifyAceRuntimeBundle } from '../src/application/ace-runtime-bundle.js';

type CheckStatus = 'ready' | 'not_ready' | 'unknown' | 'not_required';

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
  readonly authenticationRoute: typeof hermesCodexAuthenticationRoute;
  readonly checks: Readonly<Record<string, PreflightCheck>>;
  readonly runtime?: {
    readonly agent: 'hermes';
    readonly agentVersion: string;
    readonly model: string;
    readonly reasoningEffort: FeedbackHarborJobIdentity['reasoningEffort'];
    readonly harborVersion: string;
    readonly imageDigest?: string;
    readonly taskImages?: readonly { readonly reference: string; readonly digest: string }[];
    readonly mode: 'cold';
    readonly nConcurrentTrials: 1;
    readonly nAttempts: 1;
    readonly authenticationRoute: typeof hermesCodexAuthenticationRoute;
    readonly embeddingLibraryPath?: string;
  };
}

const aceRuntimeBundle = async (
  bundlePath: string | undefined,
  expectedDigest: string | undefined,
): Promise<PreflightCheck> => {
  if (bundlePath === undefined) return { status: 'not_ready', reason: 'ACE runtime bundle is required for container preflight' };
  return verifyAceRuntimeBundle(bundlePath, expectedDigest);
};

const taskRuntimeProbe = (
  bundlePath: string | undefined,
  taskImages: readonly { readonly reference: string; readonly digest: string }[] | undefined,
): PreflightCheck => {
  if (bundlePath === undefined || taskImages === undefined || taskImages.length === 0) {
    return { status: 'not_ready', reason: 'task runtime probe requires the ACE bundle and task image manifest' };
  }
  const identities: string[] = [];
  for (const image of taskImages) {
    const result = spawnSync('node', ['scripts/harbor-ace-runtime-probe.mjs', '--image', `${image.reference}@${image.digest}`, '--bundle', resolve(bundlePath)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error !== undefined || result.status !== 0) return { status: 'not_ready', reason: `task runtime probe failed for ${image.reference}` };
    try {
      const output = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1) ?? '{}') as Record<string, unknown>;
      if (output.status !== 'READY' || output.pluginImport !== true || output.bridgeImport !== true || output.effectImport !== true) {
        return { status: 'not_ready', reason: `task runtime probe returned a non-ready result for ${image.reference}` };
      }
      identities.push(`${image.reference}@${image.digest}:${String(output.node)}:${String(output.python)}:${String(output.hermesVersion)}`);
    } catch {
      return { status: 'not_ready', reason: `task runtime probe returned malformed JSON for ${image.reference}` };
    }
  }
  return { status: 'ready', reason: 'the real Hermes plugin and ContextEngine loaded inside every task image', identity: identities.join(',') };
};

const sha256 = (value: string | Uint8Array): string => {
  const hash = createHash('sha256');
  if (typeof value === 'string') hash.update(value, 'utf8');
  else hash.update(value);
  return hash.digest('hex');
};

const gitBytes = (root: string, args: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...args]);
const gitText = (root: string, args: readonly string[]): string => gitBytes(root, args).toString('utf8').trim();

const contextPluginDigest = (root: string, revision: string): string => {
  const paths = gitText(root, [
    'ls-tree', '-r', '-z', '--name-only', revision, 'integrations/hermes/ace_context_engine/',
  ]).split('\0').filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
  const entries = paths.map((path) => {
    const bytes = gitBytes(root, ['show', `${revision}:${path}`]);
    return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  return sha256(Buffer.from(JSON.stringify({
    schemaVersion: 1,
    identity: 'hermes-ace-context-plugin',
    revision,
    entries,
  }, null, 2) + '\n', 'utf8'));
};

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

const harborDataset = (datasetId: string): PreflightCheck => {
  if (datasetId === 'local/ace-suite') {
    return { status: 'not_required', reason: 'local deterministic dataset does not require Harbor registry access', identity: datasetId };
  }
  const result = spawnSync('harbor', ['datasets', 'list', '--legacy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error !== undefined || result.status !== 0) return { status: 'not_ready', reason: 'Harbor dataset registry could not be queried' };
  return result.stdout.includes('scale-ai/swe-atlas-qna')
    ? { status: 'ready', reason: 'pinned SWE-Atlas dataset is listed by the registry', identity: 'scale-ai/swe-atlas-qna' }
    : { status: 'not_ready', reason: 'pinned scale-ai/swe-atlas-qna is not listed by the Harbor registry' };
};

const verifierEnvSection = (taskToml: string): string =>
  taskToml.match(/\[verifier\.env\]([\s\S]*?)(?=\n\[|$)/u)?.[1] ?? '';

const verifierTomlValue = (section: string, name: string): string | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*=\\s*"([^"]*)"\\s*$`, 'mu').exec(section)?.[1];
};

const resolveVerifierTemplate = (value: string | undefined, fallback: string | undefined): string | undefined => {
  if (value === undefined) return fallback;
  const exact = /^\$\{([A-Z0-9_]+)\}$/u.exec(value);
  if (exact?.[1] !== undefined) return process.env[exact[1]] ?? '';
  const withDefault = /^\$\{([A-Z0-9_]+):-([^}]*)\}$/u.exec(value);
  if (withDefault?.[1] !== undefined) return process.env[withDefault[1]] ?? withDefault[2] ?? '';
  return value;
};

const taskPathsFromJob = async (jobPath: string | undefined): Promise<readonly string[]> => {
  if (jobPath === undefined) return [];
  const value = JSON.parse(await readFile(jobPath, 'utf8')) as { readonly tasks?: readonly { readonly path?: unknown }[] };
  return (value.tasks ?? []).map((task) => typeof task.path === 'string' ? resolve(task.path) : undefined)
    .filter((path): path is string => path !== undefined);
};

const taskVerifier = async (nativeJobPath: string | undefined): Promise<PreflightCheck> => {
  const taskPaths = await taskPathsFromJob(nativeJobPath);
  if (taskPaths.length === 0) return { status: 'not_ready', reason: 'task verifier probe requires generated task paths' };
  const identities: string[] = [];
  for (const taskPath of taskPaths) {
    let taskToml: string;
    try {
      taskToml = await readFile(resolve(taskPath, 'task.toml'), 'utf8');
    } catch {
      return { status: 'not_ready', reason: 'task verifier probe could not read task.toml' };
    }
    const section = verifierEnvSection(taskToml);
    const declaredVerifierKeys = ['EVAL_API_KEY', 'EVAL_BASE_URL', 'EVAL_MODEL']
      .map((name) => verifierTomlValue(section, name))
      .filter((value): value is string => value !== undefined);
    if (declaredVerifierKeys.length === 0) {
      identities.push('local-task-verifier');
      continue;
    }
    const apiKey = resolveVerifierTemplate(verifierTomlValue(section, 'EVAL_API_KEY'), process.env.EVAL_API_KEY ?? process.env.OPENAI_API_KEY);
    const baseUrl = resolveVerifierTemplate(verifierTomlValue(section, 'EVAL_BASE_URL'), process.env.EVAL_BASE_URL ?? process.env.OPENAI_API_BASE);
    const model = resolveVerifierTemplate(verifierTomlValue(section, 'EVAL_MODEL'), process.env.EVAL_MODEL);
    const configuration = inspectFeedbackVerifierConfiguration({ apiKey, baseUrl, model });
    if (configuration.status !== 'ready' || configuration.identity === undefined) {
      return { status: 'not_ready', reason: configuration.reason };
    }
    try {
      const response = await fetch(`${baseUrl!.replace(/\/$/u, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      const readiness = classifyFeedbackVerifierHttpStatus(response.status, configuration.identity);
      if (readiness.status !== 'ready') return { status: 'not_ready', reason: readiness.reason, identity: readiness.identity };
      identities.push(configuration.identity);
    } catch {
      return { status: 'not_ready', reason: 'task verifier endpoint is unavailable', identity: configuration.identity };
    }
  }
  return {
    status: 'ready',
    reason: 'task verifier accepted an authenticated readiness probe for every frozen task',
    identity: [...new Set(identities)].sort().join(','),
  };
};

const hermesCodexAuth = async (): Promise<PreflightCheck> => {
  const configured = process.env.HERMES_AUTH_JSON_PATH?.trim();
  const hermesHome = process.env.HERMES_HOME?.trim();
  const authPath = configured && configured.length > 0
    ? resolve(configured)
    : resolve(hermesHome && hermesHome.length > 0 ? hermesHome : resolve(process.env.HOME ?? '/', '.hermes'), 'auth.json');
  if (!existsSync(authPath)) return { status: 'not_ready', reason: 'Hermes auth file is unavailable' };
  try {
    return inspectHermesAuthJson(authPath, await readFile(authPath, 'utf8'));
  } catch {
    return { status: 'not_ready', reason: 'Hermes auth file could not be read' };
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

const agentRuntimeDigestCheck = async (
  experiment: FeedbackExperimentManifest | undefined,
): Promise<PreflightCheck> => {
  if (experiment === undefined) return { status: 'not_ready', reason: 'Hermes adapter/bridge/plugin digests require an experiment manifest' };
  try {
    const adapter = createHash('sha256').update(await readFile('scripts/harbor_hermes_codex_oauth.py')).digest('hex');
    // The Harbor command is a source-bound shell wrapper, but the executable
    // provider path is dist/bin/ace-context-bridge.js. Verify those exact bytes.
    const bridge = createHash('sha256').update(await readFile('dist/bin/ace-context-bridge.js')).digest('hex');
    const plugin = contextPluginDigest(resolve('.'), experiment.sourceCommit);
    if (adapter !== experiment.agentAdapterSha256
      || bridge !== experiment.aceContextBridgeSha256
      || plugin !== experiment.contextPluginSha256) {
      return { status: 'not_ready', reason: 'Hermes adapter, ContextEngine bridge or plugin digest does not match experiment manifest' };
    }
    return { status: 'ready', reason: 'Hermes adapter, ContextEngine bridge and plugin match experiment digests', identity: `${adapter}:${bridge}:${plugin}` };
  } catch {
    return { status: 'not_ready', reason: 'Hermes adapter, ContextEngine bridge or plugin could not be read' };
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
  readonly taskManifestPath?: string;
  readonly nativeJobPath?: string;
  readonly aceJobPath?: string;
  readonly aceRuntimeBundlePath?: string;
  readonly imageDigest?: string;
  readonly experimentManifestPath?: string;
} => {
  const args = process.argv.slice(2);
  let outputDirectory = process.env.ACE_FEEDBACK_OUTPUT?.trim() || 'artifacts/feedback/preflight';
  let embeddingPython = resolve(process.env.ACE_EMBEDDING_PYTHON?.trim() || '.venv-embedding-fast/bin/python');
  let embeddingLibraryPath = process.env.ACE_EMBEDDING_LD_LIBRARY_PATH?.trim();
  let qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
  let taskManifestPath: string | undefined;
  let nativeJobPath: string | undefined;
  let aceJobPath: string | undefined;
  let aceRuntimeBundlePath: string | undefined;
  let imageDigest: string | undefined;
  let experimentManifestPath: string | undefined;
  while (args.length > 0) {
    const current = args.shift();
    const value = args.shift();
    if (current === '--output' && value !== undefined) outputDirectory = value;
    else if (current === '--embedding-python' && value !== undefined) embeddingPython = value;
    else if (current === '--embedding-library-path' && value !== undefined) embeddingLibraryPath = value;
    else if (current === '--qdrant-url' && value !== undefined) qdrantUrl = value;
    else if (current === '--task-manifest' && value !== undefined) taskManifestPath = resolve(value);
    else if (current === '--native-job' && value !== undefined) nativeJobPath = resolve(value);
    else if (current === '--ace-job' && value !== undefined) aceJobPath = resolve(value);
    else if (current === '--ace-runtime-bundle' && value !== undefined) aceRuntimeBundlePath = resolve(value);
    else if (current === '--image-digest' && value !== undefined) imageDigest = value.trim();
    else if (current === '--experiment-manifest' && value !== undefined) experimentManifestPath = resolve(value);
    else throw new Error('Usage: tsx scripts/feedback-loop-preflight.ts [--output dir] [--embedding-python path] [--embedding-library-path path] [--qdrant-url url] [--task-manifest path] [--native-job path] [--ace-job path] [--ace-runtime-bundle path] [--image-digest sha256:<64hex>] [--experiment-manifest path]');
  }
  return {
    outputDirectory: resolve(outputDirectory),
    embeddingPython,
    ...(embeddingLibraryPath === undefined || embeddingLibraryPath.length === 0 ? {} : { embeddingLibraryPath }),
    qdrantUrl,
    ...(taskManifestPath === undefined ? {} : { taskManifestPath }),
    ...(nativeJobPath === undefined ? {} : { nativeJobPath }),
    ...(aceJobPath === undefined ? {} : { aceJobPath }),
    ...(aceRuntimeBundlePath === undefined ? {} : { aceRuntimeBundlePath }),
    ...(imageDigest === undefined ? {} : { imageDigest }),
    ...(experimentManifestPath === undefined ? {} : { experimentManifestPath }),
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  let datasetId = 'scale-ai/swe-atlas-qna';
  if (args.taskManifestPath !== undefined) {
    const taskManifest = validateFeedbackTaskManifest(JSON.parse(await readFile(args.taskManifestPath, 'utf8')) as unknown);
    if (taskManifest._tag === 'Err') throw new Error(`BLOCKED: ${taskManifest.error.path}: ${taskManifest.error.message}`);
    datasetId = taskManifest.value.dataset.id;
  }
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
    harborDatasetPinned: harborDataset(datasetId),
    hermesCodexAuth: await hermesCodexAuth(),
    docker: command('docker', ['--version']),
    harborJobs: harborJobs.check,
    taskVerifier: await taskVerifier(args.nativeJobPath),
    harborImageDigest: dockerImages(effectiveImageDigest, manifestTaskImages),
    agentRuntimeDigest: await agentRuntimeDigestCheck(experimentManifest),
    aceRuntimeBundle: await aceRuntimeBundle(args.aceRuntimeBundlePath, experimentManifest?.aceRuntimeBundleSha256),
    taskRuntimeProbe: taskRuntimeProbe(args.aceRuntimeBundlePath, manifestTaskImages),
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
        expectedAuthenticationRoute: hermesCodexAuthenticationRoute,
        jobAgent: harborJobs.identity.agent,
        jobAgentVersion: harborJobs.identity.agentVersion,
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
    'embeddingPython', 'sparseEmbedding', 'harbor', 'harborRun', 'harborDatasetPinned',
    'hermesCodexAuth', 'docker', 'harborJobs', 'harborImageDigest', 'agentRuntimeDigest', 'aceRuntimeBundle', 'taskRuntimeProbe', 'experimentBinding',
    'embeddingCache', 'qdrant', 'taskVerifier',
  ];
  const blocked = required.filter((name) => !['ready', 'not_required'].includes(checks[name]?.status ?? 'not_ready'));
  const manifest: PreflightManifest = {
    schemaVersion: 2,
    status: blocked.length === 0 ? 'READY' : 'BLOCKED',
    generatedAt: new Date().toISOString(),
    sourceCommit: currentSourceCommit,
    runtimeRoot: resolve('.'),
    authenticationRoute: hermesCodexAuthenticationRoute,
    checks,
    ...(blocked.length === 0 && harborJobs.identity !== undefined && (effectiveImageDigest !== undefined || manifestTaskImages !== undefined)
      ? {
        runtime: {
          agent: harborJobs.identity.agent,
          agentVersion: harborJobs.identity.agentVersion,
          model: harborJobs.identity.model,
          reasoningEffort: harborJobs.identity.reasoningEffort,
          harborVersion: checks.harbor.identity ?? 'unknown',
          ...(effectiveImageDigest === undefined ? {} : { imageDigest: effectiveImageDigest }),
          ...(manifestTaskImages === undefined ? {} : { taskImages: manifestTaskImages }),
          mode: 'cold' as const,
          nConcurrentTrials: 1 as const,
          nAttempts: 1 as const,
          authenticationRoute: hermesCodexAuthenticationRoute,
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
