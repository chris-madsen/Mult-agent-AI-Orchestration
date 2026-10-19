type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
};

const hasNoError = (value: unknown): boolean => value === undefined || value === null || value === '';

const aceContextItem = (event: unknown): JsonObject | null => {
  const eventObject = object(event);
  const item = object(eventObject?.item);
  if (eventObject?.type !== 'item.completed') return null;
  if (item?.type !== 'mcp_tool_call' || item.server !== 'ace' || item.tool !== 'ace_context') return null;
  return item;
};

const hasCompleteContextResult = (item: JsonObject): boolean => {
  const result = object(item.result);
  // A completed JSON-RPC exchange may still contain a failed MCP tool result.
  // Never count an error-bearing tool response as DBC-12 retrieval success.
  if (result?.isError === true || result?.is_error === true) return false;
  const structuredContent = object(result?.structured_content);
  const evidence = Array.isArray(structuredContent?.evidence) ? structuredContent.evidence : [];
  const hasVerifiedCodeEvidence = evidence.some((entry) => {
    const evidenceItem = object(entry);
    return evidenceItem?.source === 'code' && evidenceItem.freshness === 'current' && evidenceItem.proofClass === 'direct';
  });
  return structuredContent?.complete === true
    && structuredContent.status !== 'not_ready'
    && structuredContent.status !== 'error'
    && hasVerifiedCodeEvidence;
};

/**
 * Counts one terminal Codex event per ACE context invocation, including
 * partial/failed/NOT_READY calls. DBC-12 requires the benchmark to report
 * actual call counts and failures, so these observations must not disappear.
 */
export const isObservedAceContextEvent = (event: unknown): boolean => {
  const item = aceContextItem(event);
  return item !== null && (item.status === 'completed' || item.status === 'failed');
};

/**
 * Strong attribution evidence: the ACE call reached a terminal successful MCP
 * result, the structured ContextBundle is complete, and it contains at least one\n * current/direct code evidence item. Partial/failed/empty calls are
 * still observed invocations, but cannot establish ACE-caused retrieval value.
 */
export const isSuccessfulAceContextEvent = (event: unknown): boolean => {
  const item = aceContextItem(event);
  return item?.status === 'completed'
    && hasNoError(item.error)
    && hasCompleteContextResult(item);
};

const successfulRequestId = (item: JsonObject): string | undefined => {
  if (item.status !== 'completed' || !hasNoError(item.error) || !hasCompleteContextResult(item)) return undefined;
  const result = object(item.result);
  const structuredContent = object(result?.structured_content);
  return typeof structuredContent?.requestId === 'string' && structuredContent.requestId.length > 0
    ? structuredContent.requestId
    : undefined;
};

export const successfulAceContextRequestId = (event: unknown): string | undefined => {
  const item = aceContextItem(event);
  return item === null ? undefined : successfulRequestId(item);
};

export const successfulAceContextRequestIdJsonLine = (line: string): string | undefined => {
  try {
    return successfulAceContextRequestId(JSON.parse(line) as unknown);
  } catch {
    return undefined;
  }
};

const fromJsonLine = (line: string, predicate: (event: unknown) => boolean): boolean => {
  try {
    return predicate(JSON.parse(line) as unknown);
  } catch {
    return false;
  }
};

export const isObservedAceContextJsonLine = (line: string): boolean =>
  fromJsonLine(line, isObservedAceContextEvent);

export const isSuccessfulAceContextJsonLine = (line: string): boolean =>
  fromJsonLine(line, isSuccessfulAceContextEvent);
