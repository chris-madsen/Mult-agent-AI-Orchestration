import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { evaluateAmplifierGraphitiPreflight } from '../src/domain/amplifier-graphiti-preflight.js';

const execFileAsync = promisify(execFile);
const pinnedGraphitiRef = '3cc723cd292eb5c2ac5ea2c5539270b8e1b6389f';
const defaultConfig = 'infra/providers/amplifier-graphiti/graphiti-config.yaml';

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const boolEnv = (name: string, defaultValue: boolean): boolean => {
  const value = env(name);
  return value === undefined ? defaultValue : value === 'true';
};

const isLoopbackUrl = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  try {
    const hostname = new URL(value).hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

const isSecretFree = (contents: string): boolean => {
  if (/-----BEGIN [A-Z ]+-----/u.test(contents)) return false;
  if (/(?:sk-[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/u.test(contents)) return false;
  return !/^\s*(?:api_key|token|password|access_token)\s*:\s*[^$\s][^\n]*$/imu.test(contents);
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const gitHead = async (root: string): Promise<string | undefined> => {
  try {
    const result = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return result.stdout.trim().toLowerCase();
  } catch {
    return undefined;
  }
};

interface HttpProbe {
  readonly reachable: boolean;
  readonly ids: readonly string[];
}

const getModelIds = async (url: string, token: string | undefined): Promise<HttpProbe> => {
  if (token === undefined) return { reachable: false, ids: [] };
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { reachable: false, ids: [] };
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
      return { reachable: false, ids: [] };
    }
    const ids = body.data.flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'string') return [];
      return [entry.id];
    });
    return { reachable: true, ids };
  } catch {
    return { reachable: false, ids: [] };
  }
};

const parseArgs = (): { readonly output?: string } => {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (outputIndex >= 0 && output === undefined) throw new Error('--output requires a path');
  return { output };
};

const main = async (): Promise<void> => {
  const { output } = parseArgs();
  const faceUrl = env('ACE_AMPLIFIER_FACE_URL') ?? 'http://127.0.0.1:9099/v1';
  const faceToken = env('AMPLIFIER_AGENT_FACE_TOKEN');
  const requestedModel = env('ACE_AMPLIFIER_MODEL_ID') ?? 'gpt-5.6-luna';
  const faceModel = env('ACE_AMPLIFIER_FACE_MODEL') ?? requestedModel;
  const graphitiRoot = env('ACE_GRAPHITI_SOURCE_ROOT');
  const graphitiConfigPath = resolve(env('ACE_GRAPHITI_CONFIG') ?? defaultConfig);
  const graphitiCommand = env('ACE_GRAPHITI_COMMAND');
  const graphitiArgsRaw = env('ACE_GRAPHITI_ARGS_JSON');
  let graphitiArgsValid = false;
  if (graphitiArgsRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(graphitiArgsRaw);
      graphitiArgsValid = Array.isArray(parsed) && parsed.every((value) => typeof value === 'string');
    } catch {
      graphitiArgsValid = false;
    }
  }
  const graphitiCommandConfigured = graphitiCommand !== undefined && graphitiArgsValid;
  const configExists = await fileExists(graphitiConfigPath);
  const configContents = configExists ? await readFile(graphitiConfigPath, 'utf8') : '';
  const sourceRef = graphitiRoot === undefined ? undefined : await gitHead(graphitiRoot);
  const schemaPath = graphitiRoot === undefined ? undefined : resolve(graphitiRoot, 'mcp_server/src/config/schema.py');
  const factoryPath = graphitiRoot === undefined ? undefined : resolve(graphitiRoot, 'mcp_server/src/services/factories.py');
  const schemaContents = schemaPath !== undefined && await fileExists(schemaPath) ? await readFile(schemaPath, 'utf8') : '';
  const factoryContents = factoryPath !== undefined && await fileExists(factoryPath) ? await readFile(factoryPath, 'utf8') : '';
  const faceModels = await getModelIds(`${faceUrl.replace(/\/$/u, '')}/models`, faceToken);
  const liveCatalog = await getModelIds(`${faceUrl.replace(/\/$/u, '')}/providers/openai-chatgpt/models`, faceToken);
  const privateProfile = env('ACE_POLICY_PROFILE') === 'private-codex-cloud';
  const ownerApproval = env('ACE_OWNER_APPROVAL_REF');
  const privateCloudApprovalComplete = !privateProfile || (boolEnv('ACE_CLOUD_LLM_OPT_IN', false) && ownerApproval !== undefined);
  const sourceRootIsOfficial = graphitiRoot !== undefined
    && !/codex-kimi|8098|8099|appbuilder|shim/iu.test(graphitiRoot);
  const commandIsOfficial = graphitiCommandConfigured
    && !/codex-kimi|8098|8099|appbuilder|shim/iu.test(`${graphitiCommand} ${graphitiArgsRaw ?? ''}`);
  const localEmbedderSupported = schemaContents.includes('sentence_transformers');
  const localBgeSupported = factoryContents.includes('BGERerankerClient')
    && factoryContents.includes('sentence-transformers');
  const localBgeSelectable = localBgeSupported && schemaContents.includes('cross_encoder');
  const result = evaluateAmplifierGraphitiPreflight({
    faceUrlIsLoopback: isLoopbackUrl(faceUrl),
    faceTokenPresent: faceToken !== undefined,
    faceModelsReachable: faceModels.reachable,
    faceModelAliasPresent: faceModels.ids.includes(faceModel),
    liveCatalogReachable: liveCatalog.reachable,
    requestedModelPresent: liveCatalog.ids.includes(requestedModel),
    graphitiCommandConfigured: sourceRootIsOfficial && commandIsOfficial,
    graphitiSourceRefPinned: sourceRef === pinnedGraphitiRef,
    graphitiConfigPresent: configExists,
    graphitiConfigIsSecretFree: isSecretFree(configContents),
    structuredOutputJsonObject: /structured_output_mode:\s*(?:\$\{[^}]+:)?json_object/iu.test(configContents),
    falkorDbIsLoopback: /redis:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/u.test(configContents),
    localEmbedderSupportedByPinnedMcp: localEmbedderSupported,
    localRerankerSupportedByPinnedMcp: localBgeSelectable,
    syntheticOnlyPolicy: !privateProfile,
    privateCloudApprovalComplete,
  });
  const receipt = {
    schemaVersion: 1,
    evidence: 'amplifier-graphiti-preflight',
    generatedAt: new Date().toISOString(),
    status: result.status,
    pinned: {
      amplifierAgent: 'a289011169520f8cb2d023f0a486cbbb00082a8f',
      amplifierChatGptProvider: 'b1341edd1545ba4b89a416184797ccfbc346413b',
      graphiti: pinnedGraphitiRef,
    },
    requestedModel,
    faceModel,
    faceUrl,
    graphitiSourceRootConfigured: graphitiRoot !== undefined,
    graphitiSourceRef: sourceRef ?? 'unavailable',
    graphitiConfigPath,
    graphitiCommandConfigured,
    liveCatalogModelIds: liveCatalog.ids,
    checks: result.checks,
    productionClaims: result.productionClaims,
    note: 'No bearer token, OAuth token, private dialogue, source bytes, or query payload is retained.',
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (output !== undefined) {
    const outputPath = resolve(output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (result.status !== 'ready') process.exitCode = 2;
};

await main();
