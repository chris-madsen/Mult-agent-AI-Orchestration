import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { authorizeOutbound, type ProjectDataPolicy } from '../domain/policy.js';
import {
  projectionKey,
  type EpisodeId,
  type MemorySearchHit,
  type MemorySearchResult,
  type ProjectionReceipt,
  type SessionEpisode,
} from '../domain/memory.js';
import type { GraphProjectionPort, GraphProjectionStatePort, MemorySearchPort, ProviderTraceSink } from '../application/ports.js';
import type { WorkspaceId } from '../domain/workspace.js';
import type { AsyncMemoryArchivePort } from './file-memory-archive.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

export interface GraphitiMcpOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly groupId: string;
  readonly workspaceId: WorkspaceId;
  readonly policy: ProjectDataPolicy;
  /** Required to expose provenance-safe memory search. */
  readonly archive?: AsyncMemoryArchivePort;
  readonly trace?: ProviderTraceSink;
  readonly providerVersion?: string;
}

export const graphitiEpisodeUuid = (id: string): string => {
  const hex = createHash('sha256').update(id).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

const errorResult = (message: string): Result<never, DomainError> =>
  err(domainError('EXTERNAL_UNAVAILABLE', 'graphiti', message));

const replyJsonObject = (reply: unknown): Result<Record<string, unknown>, DomainError> => {
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti', 'Graphiti MCP tool result must be an object'));
  }
  const value = reply as { readonly structuredContent?: unknown; readonly content?: readonly unknown[]; readonly isError?: boolean };
  if (typeof value.structuredContent === 'object' && value.structuredContent !== null && !Array.isArray(value.structuredContent)) {
    return ok(value.structuredContent as Record<string, unknown>);
  }
  for (const block of value.content ?? []) {
    if (typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return ok(parsed as Record<string, unknown>);
      }
    } catch {
      // Continue looking for a JSON content block; plain text success messages
      // are allowed for mutation tools but not for typed search responses.
    }
  }
  return value.isError === true
    ? errorResult('Graphiti returned an MCP tool failure')
    : err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti', 'Graphiti MCP result did not contain typed JSON'));
};

const graphitiErrorText = (reply: unknown): string | undefined => {
  if (typeof reply !== 'object' || reply === null) return 'invalid Graphiti MCP tool result';
  const parsedReply = reply as { isError?: boolean; content?: readonly unknown[]; structuredContent?: unknown };
  if (typeof parsedReply.structuredContent === 'object' && parsedReply.structuredContent !== null
    && !Array.isArray(parsedReply.structuredContent)) {
    const error = (parsedReply.structuredContent as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  for (const block of parsedReply.content ?? []) {
    if (typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') return parsed.error;
    } catch {
      // Textual non-JSON success is supported by Graphiti mutation tools.
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
  if (/\b(?:not\s+found|does\s+not\s+exist|no\s+such)\b/iu.test(message)) return ok(undefined);
  return errorResult(message);
};

const isoTime = (value: unknown): number | undefined | null => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

interface GraphitiFact {
  readonly fact: string;
  readonly groupId: string;
  readonly episodeUuids: readonly string[];
  readonly validAt?: number;
  readonly invalidAt?: number;
}

export const parseGraphitiFactSearchReply = (reply: unknown): Result<readonly GraphitiFact[], DomainError> => {
  const object = replyJsonObject(reply);
  if (object._tag === 'Err') return object;
  if (typeof object.value.error === 'string') return errorResult(object.value.error);
  if (!Array.isArray(object.value.facts)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.facts', 'Graphiti fact search response requires a facts array'));
  }
  const facts: GraphitiFact[] = [];
  for (const [index, raw] of object.value.facts.entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', `graphiti.facts[${index}]`, 'fact must be an object'));
    }
    const value = raw as Record<string, unknown>;
    const validAt = isoTime(value.valid_at);
    const invalidAt = isoTime(value.invalid_at);
    if (typeof value.fact !== 'string' || value.fact.trim().length === 0
      || typeof value.group_id !== 'string' || value.group_id.trim().length === 0
      || !Array.isArray(value.episodes) || !value.episodes.every((item) => typeof item === 'string' && item.length > 0)
      || validAt === null || invalidAt === null) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', `graphiti.facts[${index}]`, 'fact provenance/date fields are invalid'));
    }
    facts.push({
      fact: value.fact,
      groupId: value.group_id,
      episodeUuids: value.episodes,
      ...(validAt === undefined ? {} : { validAt }),
      ...(invalidAt === undefined ? {} : { invalidAt }),
    });
  }
  return ok(facts);
};

const stripOriginal = (episode: SessionEpisode, includeOriginal: boolean): MemorySearchHit['episode'] =>
  includeOriginal ? episode : {
    episodeId: episode.episodeId,
    workspaceId: episode.workspaceId,
    sessionId: episode.sessionId,
    sourcePointer: episode.sourcePointer,
    occurredAtMs: episode.occurredAtMs,
    importedAtMs: episode.importedAtMs,
    contentDigest: episode.contentDigest,
    searchText: episode.searchText,
    ...(episode.memoryHint === undefined ? {} : { memoryHint: episode.memoryHint }),
    tombstoned: episode.tombstoned,
  };

/** Connect to Graphiti's official MCP server over stdio.
 * The reference server must stay on a trusted local boundary; ACE performs its
 * own workspace policy and provenance validation before exposing search hits. */
export const makeGraphitiMcpPort = async (options: GraphitiMcpOptions): Promise<{
  readonly projection: GraphProjectionPort;
  readonly memory?: MemorySearchPort;
  readonly projectionState: GraphProjectionStatePort;
  readonly close: () => Promise<void>;
}> => {
  if (options.groupId.trim().length === 0) throw new Error('Graphiti group_id is required');
  const client = new Client({ name: 'ace-graphiti-memory', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: options.command, args: [...options.args] });
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
      workspaceId: options.workspaceId,
      operation,
      destination: 'local',
      dataClasses: ['private_conversation'],
      paths: [],
      secretDetected: false,
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
      const episodeUuid = graphitiEpisodeUuid(input.episodeId);
      const receipt = yield* invoke('add_memory', {
        uuid: episodeUuid,
        name: `ace:${input.episodeId}`,
        group_id: options.groupId,
        source: 'json',
        source_description: `ACE extractor ${input.extractorVersion} (proposed facts)`,
        reference_time: referenceTime.toISOString(),
        episode_body: JSON.stringify({ claims: input.claims, approval: 'unverified' }),
      });
      if (receipt._tag === 'Err') return receipt;
      return ok({
        key: projectionKey(input.episodeId, input.extractorVersion),
        episodeId: input.episodeId,
        extractorVersion: input.extractorVersion,
        status: 'pending',
        attempts: 1,
      } satisfies ProjectionReceipt);
    }),
    purge: (episodeId: EpisodeId) => Effect.gen(function* () {
      const granted = authorize('memory_purge');
      if (granted._tag === 'Err') return granted;
      return yield* invoke('delete_episode', {
        uuid: graphitiEpisodeUuid(episodeId),
        group_id: options.groupId,
      }, validateDeleteReply);
    }),
  };

  const memory: MemorySearchPort | undefined = options.archive === undefined ? undefined : {
    search: (input) => {
      const startedAtMs = Date.now();
      const operation = Effect.tryPromise({
        try: async (): Promise<Result<MemorySearchResult, DomainError>> => {
          if (input.workspaceId !== options.workspaceId) {
            return err(domainError('POLICY_DENIED', 'workspace_id', 'Graphiti memory provider belongs to another workspace'));
          }
          const granted = authorize('memory_search');
          if (granted._tag === 'Err') return granted;
          const reply = await client.callTool({
            name: 'search_memory_facts',
            arguments: { query: input.query, group_ids: [options.groupId], max_facts: 50 },
          });
          const parsed = parseGraphitiFactSearchReply(reply);
          if (parsed._tag === 'Err') return parsed;
          const listed = await options.archive!.listEpisodes();
          if (listed._tag === 'Err') return listed;
          const byGraphitiUuid = new Map(
            listed.value
              .filter((episode) => episode.workspaceId === options.workspaceId && !episode.tombstoned)
              .map((episode) => [graphitiEpisodeUuid(episode.episodeId), episode] as const),
          );
          const excerpts = new Map<EpisodeId, { readonly episode: SessionEpisode; readonly facts: string[] }>();
          for (const fact of parsed.value) {
            if (fact.groupId !== options.groupId) {
              return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.group_id', 'Graphiti returned a fact from another group'));
            }
            if (input.asOfMs !== undefined
              && ((fact.validAt !== undefined && fact.validAt > input.asOfMs)
                || (fact.invalidAt !== undefined && fact.invalidAt <= input.asOfMs))) continue;
            if (fact.episodeUuids.length === 0) {
              return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.episodes', 'derived fact has no original episode provenance'));
            }
            for (const graphitiUuid of fact.episodeUuids) {
              const episode = byGraphitiUuid.get(graphitiUuid);
              if (episode === undefined) {
                return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.episodes', 'derived fact cannot be linked to a verified ACE archive original'));
              }
              if (input.asOfMs !== undefined && episode.occurredAtMs > input.asOfMs) continue;
              const existing = excerpts.get(episode.episodeId) ?? { episode, facts: [] };
              if (!existing.facts.includes(fact.fact)) existing.facts.push(fact.fact);
              excerpts.set(episode.episodeId, existing);
            }
          }
          const hits: MemorySearchHit[] = [...excerpts.values()]
            .sort((left, right) => right.episode.occurredAtMs - left.episode.occurredAtMs)
            .map(({ episode, facts }) => ({
              episode: stripOriginal(episode, input.includeOriginal),
              matchingExcerpt: facts.join('\n'),
              decisionStates: [],
            }));
          return ok({
            hits,
            conflicts: [],
            ...(input.asOfMs === undefined ? {} : { asOfMs: input.asOfMs }),
          });
        },
        catch: () => domainError('EXTERNAL_UNAVAILABLE', 'graphiti', 'Graphiti memory search failed'),
      }).pipe(Effect.catchAll((cause) => Effect.succeed(err(cause))));
      return Effect.map(operation, (result) => {
        providerTraceEvent(options.trace ?? noopProviderTrace, {
          provider: 'graphiti',
          providerVersion: options.providerVersion ?? 'graphiti-mcp/unknown',
          operation: 'search_memory_facts',
          status: result._tag === 'Ok' ? 'success' : 'failure',
          durationMs: Math.max(0, Date.now() - startedAtMs),
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
        });
        return result;
      });
    },
  };

  const projectionState = {
    isPresent: (episodeId: EpisodeId): Effect.Effect<Result<boolean, DomainError>> =>
      Effect.tryPromise({
        try: async () => {
          const granted = authorize('memory_reconcile');
          if (granted._tag === 'Err') return granted;
          const reply = await client.callTool({
            name: 'get_episodes',
            arguments: { group_ids: [options.groupId], max_episodes: 100_000 },
          });
          const parsed = replyJsonObject(reply);
          if (parsed._tag === 'Err') return parsed;
          if (typeof parsed.value.error === 'string') return errorResult(parsed.value.error);
          if (!Array.isArray(parsed.value.episodes)) {
            return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.episodes', 'Graphiti get_episodes requires an episodes array'));
          }
          const expected = graphitiEpisodeUuid(episodeId);
          for (const raw of parsed.value.episodes) {
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
              return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.episodes', 'Graphiti episode must be an object'));
            }
            const episode = raw as { readonly uuid?: unknown; readonly group_id?: unknown };
            if (typeof episode.group_id === 'string' && episode.group_id !== options.groupId) {
              return err(domainError('INVALID_EXTERNAL_RESPONSE', 'graphiti.group_id', 'Graphiti returned an episode from another group'));
            }
            if (episode.uuid === expected) return ok(true);
          }
          return ok(false);
        },
        catch: () => domainError('EXTERNAL_UNAVAILABLE', 'graphiti', 'Graphiti projection reconciliation failed'),
      }).pipe(Effect.catchAll((cause) => Effect.succeed(err(cause)))),
  };

  return {
    projection,
    ...(memory === undefined ? {} : { memory }),
    projectionState,
    close: () => client.close(),
  };
};
