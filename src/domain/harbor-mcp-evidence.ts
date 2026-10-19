type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
};

const hasNoError = (value: unknown): boolean => value === undefined || value === null || value === '';

const hasCompleteContextResult = (item: JsonObject): boolean => {
  const result = object(item.result);
  const structuredContent = object(result?.structured_content);
  return structuredContent?.complete === true && structuredContent.status !== 'not_ready';
};

/**
 * Counts only a completed ACE tool call as provider invocation evidence.
 *
 * Codex emits an `item.completed` event even when the MCP tool itself returns
 * a failed result. The nested item status and the structured completeness
 * marker are therefore authoritative here; checking only `error` would turn
 * `NOT_READY` into a false success.
 */
export const isSuccessfulAceContextEvent = (event: unknown): boolean => {
  const eventObject = object(event);
  const item = object(eventObject?.item);
  return item?.type === 'mcp_tool_call'
    && item.server === 'ace'
    && item.tool === 'ace_context'
    && item.status === 'completed'
    && hasNoError(item.error)
    && hasCompleteContextResult(item);
};

export const isSuccessfulAceContextJsonLine = (line: string): boolean => {
  try {
    return isSuccessfulAceContextEvent(JSON.parse(line) as unknown);
  } catch {
    return false;
  }
};
