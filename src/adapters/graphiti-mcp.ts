import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { authorizeOutbound, type ProjectDataPolicy } from '../domain/policy.js';
import { projectionKey, type EpisodeId, type ProjectionReceipt } from '../domain/memory.js';
import type { GraphProjectionPort } from '../application/ports.js';
import type { WorkspaceId } from '../domain/workspace.js';

export interface GraphitiMcpOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly groupId: string;
  readonly workspaceId: WorkspaceId;
  readonly policy: ProjectDataPolicy;
}
const uuidFor = (id: string): string => {
  const hex = createHash('sha256').update(id).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};
const errorResult = (message: string): Result<never, DomainError> =>
  err(domainError('EXTERNAL_UNAVAILABLE', 'graphiti', message));
const graphitiErrorText = (reply: unknown): string | undefined => {
  if (typeof reply !== 'object' || reply === null) return 'invalid Graphiti MCP tool result';
  const parsedReply = reply as { isError?: boolean; content?: readonly unknown[] };
  for (const block of parsedReply.content ?? []) {
    if (typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') return parsed.error;
    } catch {
      // Textual non-JSON success is supported by Graphiti.
    }
  }
  return parsedReply.isError === true ? 'Graphiti returned an MCP tool failure' : undefined;
};

const validateReply = (reply: unknown): Result<void, DomainError> => {
  const message = graphitiErrorText(reply);
  return message === undefined ? ok(undefined) : errorResult(message);
};

const validateDeleteReply = (reply: unknown): Result<void, DomainError> => {
  const message = graphitiErrorText(reply);
  if (message === undefined) return ok(undefined);
  // Deletion is idempotent. Graphiti remove_episode reports a missing episode as
  // an error, but absence already satisfies the privacy postcondition.
  if (/\b(?:not\s+found|does\s+not\s+exist|no\s+such)\b/iu.test(message)) return ok(undefined);
  return errorResult(message);
};

/** Connect to Graphiti's *official MCP server*, never invent REST episode routes.
 * One client/transport per initialized bounded-context instance. */
export const makeGraphitiMcpPort = async (options: GraphitiMcpOptions): Promise<{
  readonly projection: GraphProjectionPort;
  readonly close: () => Promise<void>;
}> => {
  if (options.groupId.trim().length === 0) throw new Error('Graphiti group_id is required');
  const client = new Client({ name: 'ace-graphiti-memory', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: options.command,
    args: [...options.args],
  });
  await client.connect(transport);

  const invoke = (name: string, args: Record<string, unknown>, validate = validateReply): Effect.Effect<Result<void, DomainError>> =>
    Effect.tryPromise({
      try: async () => {
        const reply = await client.callTool({ name, arguments: args });
        return validate(reply);
      },
      catch: () => domainError('EXTERNAL_UNAVAILABLE', 'graphiti', 'Graphiti MCP invocation failed'),
    }).pipe(Effect.catchAll((cause) => Effect.succeed(err(cause))));

  const authorize = (operation: string): Result<void, DomainError> => {
    const action = authorizeOutbound({
      workspaceId: options.workspaceId, operation, destination: 'local',
      dataClasses: ['private_conversation'], paths: [], secretDetected: false,
    }, options.policy);
    if (action._tag === 'Err') return action;
    return action.value.outcome === 'allowed'
      ? ok(undefined)
      : err(domainError('POLICY_DENIED', 'graphiti', action.value.reasonCode));
  };
  const projection: GraphProjectionPort = {
    project: (input) => Effect.gen(function* () {
      const granted = authorize('memory_projection');
      if (granted._tag === 'Err') return granted;
      if (!Number.isSafeInteger(input.occurredAtMs) || input.occurredAtMs < 0) {
        return err(domainError('INVALID_MEMORY', 'occurred_at_ms', 'Graphiti reference time must be a non-negative safe integer'));
      }
      const referenceTime = new Date(input.occurredAtMs);
      if (Number.isNaN(referenceTime.getTime())) {
        return err(domainError('INVALID_MEMORY', 'occurred_at_ms', 'Graphiti reference time must be representable as an ISO timestamp'));
      }
      // No auto-approval of extracted facts: Graphiti edges are derived projections.
      const episodeUuid = uuidFor(input.episodeId);
      const receipt = yield* invoke('add_memory', {
        uuid: episodeUuid, name: `ace:${input.episodeId}`,
        group_id: options.groupId,
        source: 'json',
        source_description: `ACE extractor ${input.extractorVersion} (proposed facts)`,
        reference_time: referenceTime.toISOString(),
        episode_body: JSON.stringify({ claims: input.claims, approval: 'unverified' }),
      });
      if (receipt._tag === 'Err') return receipt;
      return ok({
        key: projectionKey(input.episodeId, input.extractorVersion),
        episodeId: input.episodeId, extractorVersion: input.extractorVersion,
        // Graphiti queues episode processing asynchronously. Never claim completion on enqueue.
        status: 'pending', attempts: 1,
      } satisfies ProjectionReceipt);
    }),
    purge: (episodeId: EpisodeId) => Effect.gen(function* () {
      const granted = authorize('memory_purge');
      if (granted._tag === 'Err') return granted;
      return yield* invoke('delete_episode', { uuid: uuidFor(episodeId), group_id: options.groupId }, validateDeleteReply);
    }),
  };
  return { projection, close: () => client.close() };
};
