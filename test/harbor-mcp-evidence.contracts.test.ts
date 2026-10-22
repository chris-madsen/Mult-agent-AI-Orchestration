import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isObservedAceToolEvent,
  isObservedAceToolJsonLine,
  isObservedAceContextEvent,
  isObservedAceContextJsonLine,
  isSuccessfulAceToolEvent,
  isSuccessfulAceToolJsonLine,
  isSuccessfulAceContextEvent,
  isSuccessfulAceContextJsonLine,
  successfulAceContextRequestId,
  successfulAceContextRequestIdJsonLine,
} from '../src/domain/harbor-mcp-evidence.js';

const event = (overrides: Record<string, unknown> = {}, eventType = 'item.completed'): Record<string, unknown> => ({
  type: eventType,
  item: {
    type: 'mcp_tool_call',
    server: 'ace',
    tool: 'ace_context',
    error: null,
    status: 'completed',
    result: {
      structured_content: {
        complete: true,
        evidence: [{
          source: 'code',
          freshness: 'current',
          proofClass: 'direct',
          citation: 'fixture.ts:1-3',
        }],
        requestId: 'ace-request-123',
      },
    },
    ...overrides,
  },
});

test('Harbor evidence accepts only a terminal completed and complete ACE context call as attribution evidence', () => {
  assert.equal(isObservedAceContextEvent(event()), true);
  assert.equal(isSuccessfulAceContextEvent(event()), true);
  assert.equal(isObservedAceContextJsonLine(JSON.stringify(event())), true);
  assert.equal(isSuccessfulAceContextJsonLine(JSON.stringify(event())), true);
  assert.equal(successfulAceContextRequestId(event()), 'ace-request-123');
  assert.equal(successfulAceContextRequestIdJsonLine(JSON.stringify(event())), 'ace-request-123');
});

test('Harbor evidence preserves failed and partial ACE calls as observed but not successful', () => {
  const failed = event({ status: 'failed', error: { message: 'NOT_READY' }, result: undefined });
  assert.equal(isObservedAceContextEvent(failed), true);
  assert.equal(isSuccessfulAceContextEvent(failed), false);

  const partial = event({ result: { structured_content: { complete: false, partialSources: ['qdrant'] } } });
  assert.equal(isObservedAceContextEvent(partial), true);
  assert.equal(isSuccessfulAceContextEvent(partial), false);
  assert.equal(successfulAceContextRequestId(partial), undefined);

  const notReady = event({ result: { structured_content: { complete: true, status: 'not_ready', evidence: [{ source: 'code', freshness: 'current', proofClass: 'direct' }] } } });
  assert.equal(isObservedAceContextEvent(notReady), true);
  assert.equal(isSuccessfulAceContextEvent(notReady), false);
});

test('Harbor attribution rejects complete-but-empty or unverified context', () => {
  assert.equal(isObservedAceContextEvent(event({ result: { structured_content: { complete: true, evidence: [] } } })), true);
  assert.equal(isSuccessfulAceContextEvent(event({ result: { structured_content: { complete: true, evidence: [] } } })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ result: { structured_content: { complete: true, evidence: [{ source: 'code', freshness: 'unknown', proofClass: 'uncertain' }] } } })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ result: { structured_content: { complete: true, evidence: [{ source: 'documentation', freshness: 'current', proofClass: 'direct' }] } } })), false);
});

test('Harbor evidence rejects non-terminal, unrelated and malformed events', () => {
  assert.equal(isObservedAceContextEvent(event({}, 'item.started')), false);
  assert.equal(isSuccessfulAceContextEvent(event({}, 'item.started')), false);
  assert.equal(isObservedAceContextEvent(event({ status: 'in_progress' })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ status: 'in_progress' })), false);
  assert.equal(isObservedAceContextEvent(event({ server: 'other' })), false);
  assert.equal(isSuccessfulAceContextEvent({ item: null }), false);
  assert.equal(isObservedAceContextJsonLine('not-json'), false);
  assert.equal(isSuccessfulAceContextJsonLine('not-json'), false);
  assert.equal(successfulAceContextRequestIdJsonLine('not-json'), undefined);
});

test('DBC-12 does not count a completed MCP tool error as a successful context response', () => {
  const good = event();
  const item = good.item as Record<string, unknown>;
  const original = item.result as Record<string, unknown>;
  const failed = event({ result: { ...original, isError: true } });
  assert.equal(isObservedAceContextEvent(failed), true);
  assert.equal(isSuccessfulAceContextEvent(failed), false);
  assert.equal(successfulAceContextRequestId(failed), undefined);
  assert.equal(isSuccessfulAceContextEvent(event({ result: { ...original, is_error: true } })), false);
});

test('feedback telemetry counts exact ace_expand calls without inventing provider correlation', () => {
  const expand = event({
    tool: 'ace_expand',
    result: {
      structured_content: {
        content_utf8: 'const value = 1;\n',
        digest: 'a'.repeat(64),
        offset: 0,
        total_bytes: 18,
      },
    },
  });
  assert.equal(isObservedAceToolEvent(expand), true);
  assert.equal(isObservedAceToolJsonLine(JSON.stringify(expand)), true);
  assert.equal(isSuccessfulAceToolEvent(expand), true);
  assert.equal(isSuccessfulAceToolJsonLine(JSON.stringify(expand)), true);
  assert.equal(isObservedAceContextEvent(expand), false);
  assert.equal(isSuccessfulAceContextEvent(expand), false);
  assert.equal(isSuccessfulAceToolEvent({ ...expand, item: { ...(expand.item as Record<string, unknown>), result: { isError: true } } }), false);
});
