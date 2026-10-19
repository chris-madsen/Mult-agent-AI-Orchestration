import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isObservedAceContextEvent,
  isObservedAceContextJsonLine,
  isSuccessfulAceContextEvent,
  isSuccessfulAceContextJsonLine,
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
});

test('Harbor evidence preserves failed and partial ACE calls as observed but not successful', () => {
  const failed = event({ status: 'failed', error: { message: 'NOT_READY' }, result: undefined });
  assert.equal(isObservedAceContextEvent(failed), true);
  assert.equal(isSuccessfulAceContextEvent(failed), false);

  const partial = event({ result: { structured_content: { complete: false, partialSources: ['qdrant'] } } });
  assert.equal(isObservedAceContextEvent(partial), true);
  assert.equal(isSuccessfulAceContextEvent(partial), false);

  const notReady = event({ result: { structured_content: { complete: true, status: 'not_ready' } } });
  assert.equal(isObservedAceContextEvent(notReady), true);
  assert.equal(isSuccessfulAceContextEvent(notReady), false);
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
});
