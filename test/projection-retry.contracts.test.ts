import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deadLetterProjection,
  projectionRetryDue,
  recordProjectionEnqueue,
  repairProjection,
  scheduleProjectionRetry,
  type ProjectionReceipt,
  type ProjectionRetryPolicy,
} from '../src/domain/memory.js';

const receipt = (): ProjectionReceipt => ({
  key: 'episode-retry:extractor-v1' as never,
  episodeId: 'episode-retry' as never,
  extractorVersion: 'extractor-v1',
  status: 'pending',
  attempts: 0,
});

const policy: ProjectionRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 100,
};

test('projection failures use bounded exponential backoff and end in dead letter', () => {
  const first = scheduleProjectionRetry(receipt(), 100, 'EXTERNAL_UNAVAILABLE', policy);
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') throw new Error(first.error.message);
  assert.equal(first.value.status, 'incomplete');
  assert.equal(first.value.attempts, 1);
  assert.equal(first.value.totalAttempts, 1);
  assert.equal(first.value.nextAttemptAtMs, 110);
  assert.equal(projectionRetryDue(first.value, 109), false);
  assert.equal(projectionRetryDue(first.value, 110), true);

  const second = scheduleProjectionRetry(first.value, 110, 'EXTERNAL_UNAVAILABLE', policy);
  assert.equal(second._tag, 'Ok');
  if (second._tag === 'Err') throw new Error(second.error.message);
  assert.equal(second.value.status, 'incomplete');
  assert.equal(second.value.attempts, 2);
  assert.equal(second.value.totalAttempts, 2);
  assert.equal(second.value.nextAttemptAtMs, 130);

  const third = scheduleProjectionRetry(second.value, 130, 'EXTERNAL_UNAVAILABLE', policy);
  assert.equal(third._tag, 'Ok');
  if (third._tag === 'Err') throw new Error(third.error.message);
  assert.equal(third.value.status, 'dead_letter');
  assert.equal(third.value.attempts, 3);
  assert.equal(third.value.totalAttempts, 3);
  assert.equal(third.value.nextAttemptAtMs, undefined);
  assert.equal(third.value.deadLetteredAtMs, 130);
  assert.equal(projectionRetryDue(third.value, 10_000), false);
});

test('manual repair restarts the retry cycle but retains lifetime attempt history', () => {
  const dead = scheduleProjectionRetry({
    ...receipt(),
    status: 'incomplete',
    attempts: 2,
    totalAttempts: 5,
  }, 200, 'EXTERNAL_UNAVAILABLE', policy);
  assert.equal(dead._tag, 'Ok');
  if (dead._tag === 'Err') throw new Error(dead.error.message);
  assert.equal(dead.value.status, 'dead_letter');
  assert.equal(dead.value.totalAttempts, 6);

  const repaired = repairProjection(dead.value);
  assert.equal(repaired._tag, 'Ok');
  if (repaired._tag === 'Err') throw new Error(repaired.error.message);
  assert.equal(repaired.value.status, 'pending');
  assert.equal(repaired.value.attempts, 0);
  assert.equal(repaired.value.totalAttempts, 6);
  assert.equal(repaired.value.manualRepairCount, 1);
  assert.equal(projectionRetryDue(repaired.value, 200), true);

  const failedAgain = scheduleProjectionRetry(repaired.value, 201, 'EXTERNAL_UNAVAILABLE', policy);
  assert.equal(failedAgain._tag, 'Ok');
  if (failedAgain._tag === 'Err') throw new Error(failedAgain.error.message);
  assert.equal(failedAgain.value.attempts, 1);
  assert.equal(failedAgain.value.totalAttempts, 7);
});

test('successful enqueue records one attempt and defers materialization verification', () => {
  const provider: ProjectionReceipt = {
    ...receipt(),
    status: 'pending',
    attempts: 1,
  };
  const enqueued = recordProjectionEnqueue(receipt(), provider, 1000, 250);
  assert.equal(enqueued._tag, 'Ok');
  if (enqueued._tag === 'Err') throw new Error(enqueued.error.message);
  assert.equal(enqueued.value.status, 'pending');
  assert.equal(enqueued.value.attempts, 1);
  assert.equal(enqueued.value.totalAttempts, 1);
  assert.equal(enqueued.value.nextAttemptAtMs, 1250);
  assert.equal(projectionRetryDue(enqueued.value, 1249), false);
  assert.equal(projectionRetryDue(enqueued.value, 1250), true);

  const wrongIdentity = recordProjectionEnqueue(
    receipt(),
    { ...provider, episodeId: 'different-episode' as never },
    1000,
    250,
  );
  assert.equal(wrongIdentity._tag, 'Err');
});

test('explicit non-materialization dead letter is terminal until manual repair', () => {
  const dead = deadLetterProjection({
    ...receipt(),
    status: 'pending',
    attempts: 3,
    totalAttempts: 3,
  }, 500, 'PROJECTION_NOT_MATERIALIZED');
  assert.equal(dead._tag, 'Ok');
  if (dead._tag === 'Err') throw new Error(dead.error.message);
  assert.equal(dead.value.status, 'dead_letter');
  assert.equal(dead.value.lastErrorCode, 'PROJECTION_NOT_MATERIALIZED');
  assert.equal(dead.value.deadLetteredAtMs, 500);
  assert.equal(projectionRetryDue(dead.value, 1_000), false);
});
