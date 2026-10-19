import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseExternalRoute } from '../src/routes/cloud.mjs';
import { chooseLocalRoute } from '../src/routes/local.mjs';
import { permitExternal } from '../src/security/decision.mjs';

test('secret-bearing requests are denied while public documentation remains allowed', () => {
  assert.equal(permitExternal({ kind: 'workspace-source', secretDetected: true }), false);
  assert.equal(permitExternal({ kind: 'public-documentation', secretDetected: false }), true);
  assert.equal(chooseExternalRoute({ kind: 'workspace-source', secretDetected: true }), 'local');
  assert.equal(chooseLocalRoute({ kind: 'workspace-source', secretDetected: true }), 'local');
});
