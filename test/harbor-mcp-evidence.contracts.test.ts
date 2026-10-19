import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSuccessfulAceContextEvent,
  isSuccessfulAceContextJsonLine,
} from '../src/domain/harbor-mcp-evidence.js';

const event = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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

test('Harbor evidence accepts only a completed ACE context call', () => {
  assert.equal(isSuccessfulAceContextEvent(event()), true);
  assert.equal(isSuccessfulAceContextJsonLine(JSON.stringify(event())), true);
});

test('Harbor evidence rejects an ACE call that returned NOT_READY', () => {
  assert.equal(isSuccessfulAceContextEvent(event({ status: 'failed' })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ status: 'in_progress' })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ status: 'completed', error: 'NOT_READY' })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ result: { structured_content: { status: 'not_ready' } } })), false);
  assert.equal(isSuccessfulAceContextEvent(event({ result: { structured_content: { complete: false } } })), false);
});

test('Harbor evidence rejects unrelated, malformed, and incomplete events', () => {
  assert.equal(isSuccessfulAceContextEvent(event({ server: 'other' })), false);
  assert.equal(isSuccessfulAceContextEvent({ item: null }), false);
  assert.equal(isSuccessfulAceContextJsonLine('not-json'), false);
});
