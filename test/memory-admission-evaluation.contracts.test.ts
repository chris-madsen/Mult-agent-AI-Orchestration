import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  evaluateMemoryAdmissionHoldout,
  type MemoryAdmissionHoldoutSample,
} from '../src/domain/memory-admission-evaluation.js';

interface Fixture {
  readonly schema_version: number;
  readonly status: string;
  readonly samples: readonly MemoryAdmissionHoldoutSample[];
}

test('frozen EN/RU admission holdout preserves critical durable recall without keyword false promotions', async () => {
  const fixture = JSON.parse(
    await readFile('benchmarks/fixtures/memory-admission-holdout-v1.json', 'utf8'),
  ) as Fixture;
  assert.equal(fixture.schema_version, 1);
  assert.equal(fixture.status, 'frozen_after_initial_commit');

  const result = evaluateMemoryAdmissionHoldout(fixture.samples);
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.total, 20);
  assert.equal(result.value.expectedProject, 10);
  assert.equal(result.value.expectedArchiveOnly, 10);
  assert.equal(result.value.durableRecall, 1);
  assert.equal(result.value.criticalDurableRecall, 1);
  assert.equal(result.value.falsePromotionRate, 0);
  assert.deepEqual(result.value.missedDurableIds, []);
  assert.deepEqual(result.value.falsePromotionIds, []);
  assert.ok(result.value.projectedCharacterRatio > 0);
  assert.ok(result.value.projectedCharacterRatio < 1);
});

test('admission holdout evaluator rejects duplicate IDs instead of hiding fixture corruption', () => {
  const sample: MemoryAdmissionHoldoutSample = {
    id: 'duplicate',
    language: 'en',
    category: 'durable_decision',
    text: 'We decided to use the local index.',
    expected: 'project',
    critical: true,
  };
  const result = evaluateMemoryAdmissionHoldout([
    sample,
    { ...sample, text: 'ordinary transcript', expected: 'archive_only', critical: false },
  ]);
  assert.equal(result._tag, 'Err');
});
