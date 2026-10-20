import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assessThreeArmReports,
  validateHarborPairReport,
  validateHarborReportExecutionIdentity,
  validateThreeArmDesign,
  type HarborPairReportSummary,
} from '../src/domain/harbor-three-arm.js';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

const pair = (
  evaluationDesign: string,
  observedCalls: number,
  completeCalls: number,
): HarborPairReportSummary => ({
  native: {
    aggregateSha256: 'a'.repeat(64),
    trials: 9,
    successes: 9,
    taskNames: ['ace-cloud-policy-impact', 'ace-cloud-policy-impact', 'ace-cloud-policy-impact', 'ace-retrieval-impact', 'ace-retrieval-impact', 'ace-retrieval-impact', 'ace-shared-archive-impact', 'ace-shared-archive-impact', 'ace-shared-archive-impact'],
    rawTotalTokens: 900_000,
    costUsd: 9,
  },
  // The real gate records an aggregate identity for each executed arm.
  ace: {
    aggregateSha256: 'c'.repeat(64),
    trials: 9,
    successes: 9,
    taskNames: ['ace-cloud-policy-impact', 'ace-cloud-policy-impact', 'ace-cloud-policy-impact', 'ace-retrieval-impact', 'ace-retrieval-impact', 'ace-retrieval-impact', 'ace-shared-archive-impact', 'ace-shared-archive-impact', 'ace-shared-archive-impact'],
    rawTotalTokens: 700_000,
    costUsd: 8,
    aceObservedCalls: observedCalls,
    aceCalls: completeCalls,
  },
  paired: true,
  qualityNonInferior: true,
  evaluationDesign,
  providerCorrelationVerified: completeCalls > 0,
  acceptance: completeCalls > 0 ? 'diagnostic-only' : 'rejected',
  costScope: 'codex-reported-usage-only; local infrastructure cost unmeasured',
});

test('committed Harbor jobs implement one native, one optional-natural and one forced diagnostic arm', async () => {
  const [native, natural, forced] = await Promise.all([
    readJson('benchmarks/harbor/ace-suite/retrieval-native-paired-job.json'),
    readJson('benchmarks/harbor/ace-suite/retrieval-ace-natural-job.json'),
    readJson('benchmarks/harbor/ace-suite/retrieval-ace-paired-job.json'),
  ]);
  const result = validateThreeArmDesign(native, natural, forced);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.distinctTaskCount, 3);
  assert.deepEqual(result.value.natural.extraInstructions, []);
  assert.ok(result.value.forced.extraInstructions.length > 0);
  assert.equal(result.value.natural.codexConfig, result.value.forced.codexConfig);
});

test('Harbor ACE config uses maintained structural/LSP providers and no removed Tree-sitter route', async () => {
  const config = await readFile('benchmarks/harbor/ace-retrieval-codex-config.toml', 'utf8');
  assert.match(config, /ACE_AST_GREP_COMMAND\s*=\s*"\/ace\/node_modules\/\.bin\/ast-grep"/u);
  assert.match(config, /ACE_AST_GREP_VERSION\s*=\s*"ast-grep\/0\.51\.0"/u);
  assert.match(config, /ACE_LSP_COMMAND\s*=\s*"\/ace\/node_modules\/\.bin\/typescript-language-server"/u);
  assert.match(config, /ACE_LSP_VERSION\s*=\s*"typescript-language-server\/6\.0\.2"/u);
  assert.doesNotMatch(config, /ACE_TREE_SITTER/u);
  assert.doesNotMatch(config, /ACE_ALLOW_LOCAL_FALLBACK/u);
});

test('zero-call natural ACE arm cannot claim retrieval benefit even when forced arm calls ACE', () => {
  const result = assessThreeArmReports(
    pair('optional-natural-tool-use', 0, 0),
    pair('forced-tool-use', 9, 9),
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.naturalUse, 'not_observed');
  assert.equal(result.value.productionAcceptance, 'rejected');
  assert.equal(result.value.forcedArm, 'diagnostic-only');
});

test('natural successful ACE use with correlated providers remains diagnostic while infrastructure cost is unknown', () => {
  const result = assessThreeArmReports(
    pair('optional-natural-tool-use', 6, 6),
    pair('forced-tool-use', 9, 9),
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.naturalUse, 'observed_complete');
  assert.equal(result.value.naturalProviderCorrelationVerified, true);
  assert.equal(result.value.costTelemetryComplete, false);
  assert.equal(result.value.productionAcceptance, 'diagnostic-only');
  assert.equal(result.value.naturalRawTokenRatioAceOverNative, 700_000 / 900_000);
});

test('three-arm report refuses different native aggregates', () => {
  const natural = pair('optional-natural-tool-use', 3, 3);
  const forced = pair('forced-tool-use', 9, 9);
  const changed: HarborPairReportSummary = {
    ...forced,
    native: { ...forced.native, aggregateSha256: 'b'.repeat(64) },
  };
  const result = assessThreeArmReports(natural, changed);
  assert.equal(result._tag, 'Err');
});

test('arbitrary or empty legacy cost scope cannot become complete cost telemetry', () => {
  for (const costScope of ['', 'local-costs-are-free', 'codex-only-but-trust-me']) {
    const result = assessThreeArmReports(
      { ...pair('optional-natural-tool-use', 6, 6), costScope },
      pair('forced-tool-use', 9, 9),
    );
    assert.equal(result._tag, 'Ok');
    if (result._tag === 'Ok') {
      assert.equal(result.value.costTelemetryComplete, false);
      assert.equal(result.value.productionAcceptance, 'diagnostic-only');
    }
  }
});

test('complete telemetry with null token counters is rejected rather than accepted', () => {
  const natural = {
    ...pair('optional-natural-tool-use', 6, 6),
    native: { ...pair('optional-natural-tool-use', 6, 6).native, rawTotalTokens: null },
    costTelemetry: {
      status: 'complete' as const,
      scope: 'end-to-end',
      modelCostUsd: 1,
      embeddingCostUsd: 0,
      retrievalCostUsd: 0,
      indexingCostUsd: 0,
      infrastructureCostUsd: 0,
      totalCostUsd: 1,
    },
  };
  const result = assessThreeArmReports(natural, pair('forced-tool-use', 9, 9));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') assert.equal(result.value.productionAcceptance, 'rejected');
});

test('report parser rejects a provider-correlation verdict without observed calls', () => {
  const result = validateHarborPairReport({
    ...pair('optional-natural-tool-use', 0, 0),
    providerCorrelationVerified: true,
  });
  assert.equal(result._tag, 'Err');
});

test('execution identity rejects a foreign config digest and task list', () => {
  const parsed = validateHarborPairReport({
    ...pair('optional-natural-tool-use', 6, 6),
    aceJobConfigSha256: 'a'.repeat(64),
  });
  assert.equal(parsed._tag, 'Ok');
  if (parsed._tag === 'Err') throw new Error(parsed.error.message);
  const foreignDigest = validateHarborReportExecutionIdentity(parsed.value, 'b'.repeat(64), parsed.value.native.taskNames);
  assert.equal(foreignDigest._tag, 'Err');
  const foreignTasks = validateHarborReportExecutionIdentity(parsed.value, 'a'.repeat(64), ['foreign-task']);
  assert.equal(foreignTasks._tag, 'Err');
});
