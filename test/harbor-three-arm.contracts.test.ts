import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assessThreeArmReports,
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
    taskNames: ['ace-cloud-policy-impact', 'ace-retrieval-impact', 'ace-shared-archive-impact'],
    rawTotalTokens: 900_000,
    costUsd: 9,
  },
  ace: {
    trials: 9,
    successes: 9,
    taskNames: ['ace-cloud-policy-impact', 'ace-retrieval-impact', 'ace-shared-archive-impact'],
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
