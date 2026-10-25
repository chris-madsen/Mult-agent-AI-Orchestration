import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { readHarborFourArmTrialObservations } from '../src/adapters/harbor-four-arm-trial-evidence.js';

test('raw Harbor adapter reads trial facts and keeps uninstrumented native reads unknown', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-trial-adapter-');
  const aggregatePath = join(root, 'result.json');
  const trialDirectory = join(root, 'trial-0');
  await mkdir(join(trialDirectory, 'agent'), { recursive: true });
  await writeFile(aggregatePath, '{}\n', 'utf8');
  await writeFile(join(trialDirectory, 'result.json'), JSON.stringify({
    trial_id: 'trial-0',
    task_name: 'task-a',
    exception_info: null,
    verifier_result: { rewards: { reward: 1 } },
    agent_result: { n_input_tokens: 11, n_cache_tokens: 2, n_output_tokens: 3 },
    started_at: '2026-10-22T10:00:00.000Z',
    finished_at: '2026-10-22T10:00:01.250Z',
  }) + '\n', 'utf8');
  await writeFile(join(trialDirectory, 'agent', 'codex.txt'), 'plain Codex output without ACE events\n', 'utf8');

  const observations = await readHarborFourArmTrialObservations('native', aggregatePath);
  assert.equal(observations.length, 1);
  const [observation] = observations;
  assert.equal(observation?.success, true);
  assert.equal(observation?.rawInputTokens, 11);
  assert.equal(observation?.cachedInputTokens, 2);
  assert.equal(observation?.latencyMs, 1250);
  assert.equal(observation?.observedAceCalls, 0);
  assert.equal(observation?.nativeFileReads, null);
  assert.equal(observation?.timedOut, null);
});

test('raw Harbor adapter blocks when a trial result has no verifier outcome', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-trial-adapter-missing-');
  const aggregatePath = join(root, 'result.json');
  const trialDirectory = join(root, 'trial-0');
  await mkdir(join(trialDirectory, 'agent'), { recursive: true });
  await writeFile(aggregatePath, '{}\n', 'utf8');
  await writeFile(join(trialDirectory, 'result.json'), JSON.stringify({ task_name: 'task-a' }) + '\n', 'utf8');
  await writeFile(join(trialDirectory, 'agent', 'codex.txt'), 'missing verifier\n', 'utf8');

  await assert.rejects(
    readHarborFourArmTrialObservations('native', aggregatePath),
    /BLOCKED: missing verifier reward/u,
  );
});

test('raw Harbor adapter keeps verifier timeouts out of quality and savings evidence', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-trial-adapter-timeout-');
  const aggregatePath = join(root, 'result.json');
  const trialDirectory = join(root, 'trial-0');
  await mkdir(join(trialDirectory, 'agent'), { recursive: true });
  await writeFile(aggregatePath, '{}\n', 'utf8');
  await writeFile(join(trialDirectory, 'result.json'), JSON.stringify({
    task_name: 'task-a',
    exception_info: { type: 'VerifierTimeoutError', message: 'verifier timed out' },
    timed_out: true,
    agent_result: { n_input_tokens: 100, n_output_tokens: 10 },
  }) + '\n', 'utf8');
  await writeFile(join(trialDirectory, 'agent', 'codex.txt'), 'verifier timeout\n', 'utf8');

  await assert.rejects(
    readHarborFourArmTrialObservations('native', aggregatePath),
    /BLOCKED: missing verifier reward/u,
  );
});

test('raw Harbor adapter rejects a missing aggregate even if trial directories exist', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-missing-aggregate-');
  const trialDirectory = join(root, 'trial-0');
  await mkdir(join(trialDirectory, 'agent'), { recursive: true });
  await writeFile(join(trialDirectory, 'result.json'), '{}\n', 'utf8');
  await assert.rejects(
    readHarborFourArmTrialObservations('native', join(root, 'missing-result.json')),
  );
});

test('raw Harbor adapter orders serial trials by timestamps, not lexical directory names', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-trial-order-');
  await writeFile(join(root, 'result.json'), '{}\n', 'utf8');
  for (const [directory, task, started] of [
    ['trial-10', 'second', '2026-10-22T10:00:02.000Z'],
    ['trial-2', 'first', '2026-10-22T10:00:01.000Z'],
  ]) {
    const path = join(root, directory);
    await mkdir(join(path, 'agent'), { recursive: true });
    await writeFile(join(path, 'result.json'), JSON.stringify({
      task_name: task,
      verifier_result: { rewards: { reward: 1 } },
      exception_info: null,
      started_at: started,
      finished_at: '2026-10-22T10:00:03.000Z',
      agent_result: { n_input_tokens: 10, n_output_tokens: 1, n_cache_tokens: 0 },
    }) + '\n', 'utf8');
    await writeFile(join(path, 'agent', 'codex.txt'), 'empty trace\n', 'utf8');
  }
  const result = await readHarborFourArmTrialObservations('native', join(root, 'result.json'));
  assert.deepEqual(result.map((item) => item.taskName), ['first', 'second']);
});


test('raw Harbor adapter keeps four-arm context correlation stable while recording ace_expand separately', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-expand-');
  const aggregatePath = join(root, 'result.json');
  const trialDirectory = join(root, 'trial-0');
  await mkdir(join(trialDirectory, 'agent'), { recursive: true });
  await writeFile(aggregatePath, '{}\n', 'utf8');
  await writeFile(join(trialDirectory, 'result.json'), JSON.stringify({
    trial_id: 'trial-expand',
    task_name: 'task-a',
    exception_info: null,
    verifier_result: { rewards: { reward: 1 } },
    agent_result: { n_input_tokens: 11, n_cache_tokens: 2, n_output_tokens: 3 },
    started_at: '2026-10-22T10:00:00.000Z',
    finished_at: '2026-10-22T10:00:01.000Z',
  }) + '\n', 'utf8');
  const contextEvent = {
    type: 'item.completed',
    item: {
      type: 'mcp_tool_call', server: 'ace', tool: 'ace_context', error: null, status: 'completed',
      result: { structured_content: {
        complete: true, requestId: 'request-context',
        delivery_metrics: { uniqueContentBytes: 10, newContextBytes: 8, reusedContextBytes: 2, duplicateContextBytesAvoided: 1 },
        evidence: [{ source: 'code', freshness: 'current', proofClass: 'direct', receiptId: 'receipt-context', reusedContentBytes: 2 }],
      } },
    },
  };
  const expandEvent = {
    type: 'item.completed',
    item: {
      type: 'mcp_tool_call', server: 'ace', tool: 'ace_expand', error: null, status: 'completed',
      result: { structured_content: {
        content_utf8: 'const x = 1;\n', digest: 'a'.repeat(64), offset: 0, total_bytes: 13,
        delivery_metrics: { expanded_bytes: 13, total_bytes: 13 },
      } },
    },
  };
  await writeFile(join(trialDirectory, 'agent', 'codex.txt'), JSON.stringify(contextEvent) + '\n' + JSON.stringify(expandEvent) + '\n', 'utf8');

  const [observation] = await readHarborFourArmTrialObservations('dense', aggregatePath);
  assert.equal(observation?.observedAceCalls, 1, 'four-arm context-call contract must stay context-only');
  assert.equal(observation?.successfulAceCalls, 1, 'provider-correlated successful calls remain ace_context only');
  const extended = observation as typeof observation & { readonly observedAceToolCalls?: number; readonly successfulAceToolCalls?: number };
  assert.equal(extended?.observedAceToolCalls, 2);
  assert.equal(extended?.successfulAceToolCalls, 2);
  assert.equal(observation?.successfulRequestIds.length, 1);
  assert.equal(observation?.uniqueContextBytes, 10, 'ace_expand delivery metrics must not erase context metrics');
});


test('raw Harbor adapter reads Hermes MCP session calls and preserves ACE correlation', async () => {
  const root = await mkdtemp('/tmp/ace-harbor-hermes-adapter-');
  const aggregatePath = join(root, 'result.json');
  const trialDirectory = join(root, 'trial-0');
  await mkdir(join(trialDirectory, 'agent'), { recursive: true });
  await writeFile(aggregatePath, '{}\n', 'utf8');
  await writeFile(join(trialDirectory, 'result.json'), JSON.stringify({
    trial_id: 'trial-hermes',
    task_name: 'task-a',
    exception_info: null,
    verifier_result: { rewards: { reward: 1 } },
    agent_result: { n_input_tokens: 21, n_output_tokens: 5 },
    started_at: '2026-10-23T10:00:00.000Z',
    finished_at: '2026-10-23T10:00:02.000Z',
  }) + '\n', 'utf8');
  const structured = {
    complete: true,
    requestId: 'hermes-request-1',
    delivery_metrics: { uniqueContentBytes: 12, newContextBytes: 12, reusedContextBytes: 0, duplicateContextBytesAvoided: 0 },
    evidence: [{ source: 'code', freshness: 'current', proofClass: 'direct', receiptId: 'hermes-receipt-1', reusedContentBytes: 0 }],
  };
  const session = {
    id: 'session-1',
    messages: [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-1', function: { name: 'mcp_ace_ace_context', arguments: '{"query":"where"}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: JSON.stringify({ structured_content: structured }) },
    ],
  };
  await writeFile(join(trialDirectory, 'agent', 'hermes-session.jsonl'), JSON.stringify(session) + '\n', 'utf8');

  const [observation] = await readHarborFourArmTrialObservations('dense', aggregatePath);
  assert.equal(observation?.observedAceCalls, 1);
  assert.equal(observation?.successfulAceCalls, 1);
  assert.deepEqual(observation?.successfulRequestIds, ['hermes-request-1']);
  assert.equal(observation?.uniqueContextBytes, 12);
});
