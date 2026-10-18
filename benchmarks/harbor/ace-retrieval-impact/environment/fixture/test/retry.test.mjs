import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectWithRetries } from '../src/services/connections.js';
import { paymentStatus } from '../src/services/payments.js';
test('independent retry budgets', () => {
  assert.equal(connectWithRetries([true, true]), 'retrying');
  assert.equal(connectWithRetries([true, true, true]), 'abandoned');
  assert.equal(paymentStatus(2), 'abandoned');
  assert.equal(paymentStatus(1), 'retry');
});
