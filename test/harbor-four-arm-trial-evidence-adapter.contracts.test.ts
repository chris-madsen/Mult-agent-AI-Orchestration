import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readHarborFourArmLedgerArtifacts, readHarborFourArmTrialObservations } from '../src/adapters/harbor-four-arm-trial-evidence.js';
import { readHarborFeedbackTrialObservations } from '../src/adapters/harbor-feedback-trial-evidence.js';
import { evaluateNativeResponsesStreamEvidence } from '../src/domain/native-responses-stream-receipt.js';

const withTrial = async (fn: (root: string, dir: string, aggregate: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'ace-gateway-trial-'));
  const dir = join(root, 'trial-1');
  const aggregate = join(root, 'aggregate.json');
  try {
    await mkdir(join(dir, 'agent'), { recursive: true });
    await writeFile(aggregate, JSON.stringify({ n_total_trials: 1 }));
    await writeFile(join(dir, 'result.json'), JSON.stringify({
      trial_id: 't1', task_name: 'task-1',
      started_at: '2026-11-14T10:00:00Z', finished_at: '2026-11-14T10:01:00Z',
      verifier_result: { rewards: { reward: 1 } }, exception_info: null,
      agent_result: { n_input_tokens: 120, n_output_tokens: 15 },
    }));
    await fn(root, dir, aggregate);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('native Harbor baseline has no Gateway requests or fabricated telemetry', async () => {
  await withTrial(async (_, __, aggregate) => {
    const [result] = await readHarborFourArmTrialObservations('native', aggregate);
    assert.equal(result?.observedAceCalls, 0);
    assert.equal(result?.successfulAceCalls, 0);
    assert.equal(result?.rawInputTokens, 120);
    assert.equal(result?.newContextBytes, null);
  });
});

test('Gateway arm without request-bound receipts is blocked, not counted as success', async () => {
  await withTrial(async (_, __, aggregate) => {
    await assert.rejects(readHarborFourArmTrialObservations('dense', aggregate), /missing native Responses projection evidence/u);
  });
});

test('Gateway projection is distinct from model-invoked ACE tools and final-provider delivery', async () => {
  await withTrial(async (_, dir, aggregate) => {
    const projection = {
      schemaVersion: 'ace.context.v3', requestId: 'req1',
      kind: 'PREPARED', baseBodySha256: 'a'.repeat(64),
      projectedBodySha256: 'b'.repeat(64), bodyBase64: 'e30=', reasonCode: 'VERIFIED_CONTEXT_ADDED',
    };
    await writeFile(join(dir, 'agent', 'ace-responses-projection.jsonl'), JSON.stringify(projection) + '\n');
    const [result] = await readHarborFourArmTrialObservations('hybrid', aggregate);
    assert.equal(result?.observedAceCalls, 0);
    assert.deepEqual(result?.gatewayProjectionRequestIds, ['req1']);
    assert.equal(result?.successfulAceCalls, 0);
    assert.equal(result?.rawOutputTokens, 15);
    assert.deepEqual(result?.successfulRequestIds, []);
  });
});

test('Harbor timeout remains a failed trial observation instead of aborting the denominator', async () => {
  await withTrial(async (_, dir, aggregate) => {
    await writeFile(join(dir, 'result.json'), JSON.stringify({
      trial_id: 't1', task_name: 'task-1',
      started_at: '2026-11-14T10:00:00Z', finished_at: '2026-11-14T10:01:00Z',
      verifier_result: null, exception_info: { type: 'VerifierTimeoutError' }, timed_out: true,
      agent_result: { n_input_tokens: 120 },
    }));
    const [trial] = await readHarborFourArmTrialObservations('native', aggregate);
    assert.equal(trial?.success, false);
    assert.equal(trial?.timedOut, true);
    assert.equal(trial?.rawInputTokens, 120);
    assert.equal(trial?.rawOutputTokens, null);
  });
});

test('malformed, duplicate and native-contaminating projection receipts fail closed', async () => {
  await withTrial(async (_, dir, aggregate) => {
    const path = join(dir, 'agent', 'ace-responses-projection.jsonl');
    await writeFile(path, '{"kind":"FAKE_SUCCESS"}\n');
    await assert.rejects(readHarborFourArmTrialObservations('dense', aggregate), /malformed native Responses projection evidence/u);
    const record = { schemaVersion: 'ace.context.v3', requestId: 'x', kind: 'BLOCK',
      baseBodySha256: 'a'.repeat(64), reasonCode: 'NOT_READY',
    };
    await writeFile(path, JSON.stringify(record) + '\n' + JSON.stringify(record) + '\n');
    await assert.rejects(readHarborFourArmTrialObservations('dense', aggregate), /duplicate native Responses projection/u);
    await assert.rejects(readHarborFourArmTrialObservations('native', aggregate), /native baseline contains/u);
  });
});

test('feedback adapter binds unsigned stream summaries to the exact Gateway projection request', async () => {
  await withTrial(async (_, dir, aggregate) => {
    const requestId = `ace-${'a'.repeat(32)}`;
    const attemptId = `bf-attempt-${'b'.repeat(32)}`;
    const projection = {
      schemaVersion: 'ace.context.v3', requestId, kind: 'PREPARED',
      baseBodySha256: 'a'.repeat(64), projectedBodySha256: 'b'.repeat(64),
      bodyBase64: 'e30=', reasonCode: 'VERIFIED_CONTEXT_ADDED',
    };
    await writeFile(join(dir, 'agent', 'ace-responses-projection.jsonl'), `${JSON.stringify(projection)}\n`);
    const streamResult = evaluateNativeResponsesStreamEvidence({
      schemaVersion: 1,
      requestId,
      attemptId,
      sourceCommit: '1'.repeat(40),
      bifrostCommit: '2'.repeat(40),
      aceRuntimeSha256: '3'.repeat(64),
      bifrostPluginSha256: '4'.repeat(64),
      pluginOrderSha256: '5'.repeat(64),
      provider: 'openai',
      model: 'gpt-test',
      destinationSha256: '6'.repeat(64),
      finalWireBodySha256: 'a'.repeat(64),
      serializedRequestSha256: 'c'.repeat(64),
      streamTrueVerified: true,
      storeFalseVerified: true,
      protectedItemsVerified: true,
      events: [{ sequenceNumber: 0, type: 'response.completed' }],
      transportOutcome: 'terminal',
      usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
    });
    assert.equal(streamResult._tag, 'Ok');
    if (streamResult._tag === 'Err') return;
    await writeFile(join(dir, 'agent', 'ace-native-responses-stream-receipts.jsonl'), `${JSON.stringify(streamResult.value)}\n`);

    const [trial] = await readHarborFeedbackTrialObservations('ace_optional', aggregate);
    assert.deepEqual(trial?.gatewayProjectionRequestIds, [requestId]);
    assert.equal(trial?.nativeResponsesStreamReceipts[0]?.evidenceStatus, 'NOT_CERTIFIED');

    await writeFile(join(dir, 'agent', 'ace-native-responses-stream-receipts.jsonl'), `${JSON.stringify({
      ...streamResult.value,
      requestId: `ace-${'d'.repeat(32)}`,
    })}\n`);
    await assert.rejects(readHarborFeedbackTrialObservations('ace_optional', aggregate), /not bound to a retained Gateway projection request/u);
  });
});


test('AR10 parses and hashes a same-byte versioned usage event from a real evidence file', async () => {
  await withTrial(async (root, dir) => {
    const data = {
      schemaVersion: 'ace.harbor.attempt-ledger.v1', kind: 'usage',
      arm: 'native', trialId: 't1', taskName: 'task-1', attemptId: 'a1',
      modelIdentity: 'model', providerIdentity: 'provider', runtimeImageIdentity: 'runtime',
      inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, reasoningOutputTokens: 20,
    };
    const path = join(dir, 'agent', 'usage.jsonl');
    await writeFile(path, JSON.stringify(data) + '\n');
    const read = await readHarborFourArmLedgerArtifacts(root, ['trial-1/agent/usage.jsonl'], 'usage');
    assert.equal(read.events.length, 1);
    assert.equal(read.events[0]?.kind, 'usage');
    assert.match(read.artifacts[0]?.sha256 ?? '', /^[a-f0-9]{64}$/u);
    await assert.rejects(readHarborFourArmLedgerArtifacts(root, ['trial-1/agent/usage.jsonl'], 'attempt'), /invalid Harbor attempt event/u);
    await assert.rejects(readHarborFourArmLedgerArtifacts(root, ['../outside.jsonl'], 'usage'), /escapes the frozen workspace/u);
    await assert.rejects(readHarborFourArmLedgerArtifacts(root,
      ['trial-1/agent/usage.jsonl', 'trial-1/agent/usage.jsonl'], 'usage'), /duplicate Harbor event artifact path/u);
  });
});

test('AR10 malformed JSONL is BLOCKED, not silently treated as empty usage', async () => {
  await withTrial(async (root, dir) => {
    await writeFile(join(dir, 'agent', 'usage.jsonl'), '{"kind":\\n');
    await assert.rejects(readHarborFourArmLedgerArtifacts(root, ['trial-1/agent/usage.jsonl'], 'usage'),
      /malformed Harbor event JSONL/u);
  });
});


test('AR10 rejects a symlink to a file outside the frozen workspace using the opened file identity', {
  skip: process.platform !== 'linux',
}, async () => {
  const external = await mkdtemp(join(tmpdir(), 'ace-ar10-escape-'));
  try {
    const externalFile = join(external, 'outside.jsonl');
    await writeFile(externalFile, '{"kind":"usage"}\n');
    await withTrial(async (root, dir) => {
      await symlink(externalFile, join(dir, 'agent', 'escape.jsonl'));
      await assert.rejects(
        readHarborFourArmLedgerArtifacts(root, ['trial-1/agent/escape.jsonl'], 'usage'),
      );
    });
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});
