import assert from 'node:assert/strict';
import test from 'node:test';
import { auditedHarborLabel } from '../src/domain/harbor-report-label.js';

test('rejected evidence remains rejected regardless of experiment design', () => {
  for (const design of [undefined, 'forced-tool-use', 'optional-natural-tool-use']) {
    assert.equal(auditedHarborLabel('rejected', design), 'rejected');
  }
});

test('historical, forced and unknown designs cannot promote accepted evidence', () => {
  for (const design of [undefined, 'forced-tool-use', 'unknown-design']) {
    assert.equal(auditedHarborLabel('measured-not-necessarily-5x', design), 'diagnostic-only (not DBC-12 acceptance)');
  }
});

test('natural runs preserve gate classification and unknown acceptance fails closed', () => {
  assert.equal(auditedHarborLabel('diagnostic-only', 'optional-natural-tool-use'), 'diagnostic-only');
  assert.equal(auditedHarborLabel('measured-not-necessarily-5x', 'optional-natural-tool-use'), 'measured-not-necessarily-5x');
  assert.equal(auditedHarborLabel('unexpected', 'optional-natural-tool-use'), 'rejected');
});
