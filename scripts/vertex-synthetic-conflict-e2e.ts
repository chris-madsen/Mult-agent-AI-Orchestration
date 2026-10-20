import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFetchHttpPort } from '../src/adapters/http-provider-boundaries.js';
import { makeFileProviderTrace } from '../src/adapters/provider-trace.js';
import { makeVertexRagRetrievalPort } from '../src/adapters/vertex-rag.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const main = async (): Promise<void> => {
  if (process.env.ACE_VERTEX_SYNTHETIC_RETRIEVAL_ACK !== 'true') {
    throw new Error('Set ACE_VERTEX_SYNTHETIC_RETRIEVAL_ACK=true; this gate queries only the approved synthetic fixture scope.');
  }

  const project = required('ACE_VERTEX_PROJECT');
  const corpusId = required('ACE_VERTEX_CORPUS_ID');
  const location = process.env.ACE_VERTEX_LOCATION?.trim() || 'europe-west4';
  if (![project, corpusId, location].every((value) => /^[A-Za-z0-9_-]+$/u.test(value))) {
    throw new Error('Vertex resource identifiers must contain only letters, digits, underscore or hyphen');
  }

  const [
    docArg = 'benchmarks/fixtures/vertex-docs/adr-vertex-conflict-v1.md',
    codeArg = 'benchmarks/fixtures/vertex-code/current-policy.ts',
    outputArg = 'artifacts/vertex-synthetic-conflict/evidence.json',
  ] = process.argv.slice(2);
  const docPath = resolve(docArg);
  const codePath = resolve(codeArg);
  const outputPath = resolve(outputArg);
  const [docBytes, codeBytes] = await Promise.all([readFile(docPath), readFile(codePath)]);
  const docText = docBytes.toString('utf8');
  const codeText = codeBytes.toString('utf8');

  if (!docText.includes('fixture_version: vertex-conflict-v1')
    || !docText.includes('aceVertexConflictPolicy')
    || !docText.includes('wait for explicit operator confirmation')) {
    throw new Error('synthetic Vertex document fixture does not match its frozen conflict contract');
  }
  if (!codeText.includes('aceVertexConflictPolicy') || !codeText.includes('retry-immediately')) {
    throw new Error('synthetic current-code fixture does not match its frozen conflict contract');
  }

  const workspace = makeWorkspaceId('vertex-synthetic-conflict-e2e');
  if (workspace._tag === 'Err') throw new Error(workspace.error.message);
  await mkdir(dirname(outputPath), { recursive: true });
  const tracePath = resolve(dirname(outputPath), 'provider-trace.jsonl');
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  if (token.length === 0) throw new Error('gcloud returned an empty access token');

  const policy = {
    ...defaultLocalPolicy(workspace.value),
    cloudOptIn: true,
    allowedCloudProviders: ['vertex'] as const,
    allowedCloudDataClassesByProvider: { vertex: ['project_document'] as const },
  };
  const provider = makeVertexRagRetrievalPort({
    project,
    location,
    corpusId,
    accessToken: () => token,
    policy,
    http: makeFetchHttpPort(),
    authorizedPaths: [docArg],
    trace: makeFileProviderTrace(tracePath),
    providerVersion: process.env.ACE_VERTEX_PROVIDER_VERSION?.trim() || 'vertex-rag/v1beta1',
  });
  const requestId = `vertex-synthetic-${Date.now()}`;
  const retrieved = await Effect.runPromise(provider.search({
    workspaceId: workspace.value,
    query: 'aceVertexConflictPolicy operator confirmation retry policy vertex-conflict-v1',
    topK: 10,
    requestId,
  }));
  if (retrieved._tag === 'Err') throw new Error(`${retrieved.error.code}: ${retrieved.error.message}`);

  const matching = retrieved.value.filter((item) =>
    item.source === 'documentation'
    && item.content.includes('aceVertexConflictPolicy')
    && item.content.includes('vertex-conflict-v1')
    && item.content.includes('operator confirmation'));
  if (matching.length === 0) {
    throw new Error('Vertex returned no cited context matching the imported synthetic versioned ADR fixture');
  }
  if (matching.some((item) => item.citation.trim().length === 0)) {
    throw new Error('Vertex returned synthetic content without a source citation');
  }

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/u.test(sourceCommit)) throw new Error('could not resolve exact Vertex evidence source commit');
  const evidence = {
    evidence: 'real-vertex-synthetic-code-doc-conflict',
    sourceCommit,
    requestId,
    project,
    location,
    corpusId,
    documentation: {
      fixturePath: docArg,
      fixtureSha256: sha256(docBytes),
      fixtureVersion: 'vertex-conflict-v1',
      citations: matching.map((item) => item.citation),
      retrievedEvidenceIds: matching.map((item) => item.evidenceId),
      claim: 'wait-for-operator-confirmation',
      vertexServerRevision: 'unknown',
    },
    currentCode: {
      fixturePath: codeArg,
      fixtureSha256: sha256(codeBytes),
      symbol: 'aceVertexConflictPolicy',
      claim: 'retry-immediately',
    },
    conflict: {
      detectedByGate: true,
      priorityForCurrentBehavior: 'current-code',
      note: 'Vertex server-side document revision metadata is not asserted; version identity is proven only by the retrieved fixture_version marker plus retained committed fixture digest.',
    },
    providerTrace: tracePath,
  };
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    status: 'PASS',
    output: outputArg,
    requestId,
    citations: matching.length,
  }) + '\n');
};

await main();
