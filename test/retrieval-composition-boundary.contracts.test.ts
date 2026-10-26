import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultStrategyForComposition,
  parseRetrievalComposition,
  parseRetrievalStrategy,
  parseRetrievalStrategyForComposition,
  retrievalCompositionProviderIdentity,
  retrievalProviderRequirements,
} from '../src/domain/retrieval-composition.js';

test('retrieval strategy requirements do not start unselected providers', () => {
  assert.deepEqual(retrievalProviderRequirements('dense'), { dense: true, sparse: false });
  assert.deepEqual(retrievalProviderRequirements('sparse'), { dense: false, sparse: true });
  assert.deepEqual(retrievalProviderRequirements('hybrid_rrf'), { dense: true, sparse: true });
});

test('retrieval strategy parser defaults to hybrid and rejects unknown values', () => {
  assert.equal(parseRetrievalStrategy(undefined)._tag, 'Ok');
  assert.equal(parseRetrievalStrategy('dense')._tag, 'Ok');
  assert.equal(parseRetrievalStrategy('unknown')._tag, 'Err');
});

test('replacement composition has an explicit dense default without changing legacy mode', () => {
  assert.equal(parseRetrievalComposition(undefined)._tag, 'Ok');
  assert.equal(defaultStrategyForComposition('legacy-hybrid'), 'hybrid_rrf');
  assert.equal(defaultStrategyForComposition('repo-map-qdrant-lsp-v2'), 'dense');
  assert.equal(parseRetrievalComposition('unknown')._tag, 'Err');
});

test('replacement composition rejects sparse and hybrid strategy overrides', () => {
  assert.equal(parseRetrievalStrategyForComposition('repo-map-qdrant-lsp-v2', undefined).value, 'dense');
  assert.equal(parseRetrievalStrategyForComposition('repo-map-qdrant-lsp-v2', 'sparse')._tag, 'Err');
  assert.equal(parseRetrievalStrategyForComposition('repo-map-qdrant-lsp-v2', 'hybrid_rrf')._tag, 'Err');
  assert.equal(parseRetrievalStrategyForComposition('legacy-hybrid', 'hybrid_rrf').value, 'hybrid_rrf');
});

test('provider identity marks an unselected branch as not required', () => {
  assert.deepEqual(retrievalCompositionProviderIdentity('dense', 'dense-v1', undefined), {
    dense: 'dense-v1',
    sparse: 'not-required',
  });
  assert.deepEqual(retrievalCompositionProviderIdentity('hybrid_rrf', 'dense-v1', undefined), {
    dense: 'dense-v1',
    sparse: 'unavailable',
  });
});
