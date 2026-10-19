import { Effect, Schema } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, isErr, ok, type Result } from '../domain/result.js';
import { workspaceIdFrom, type WorkspaceServicePorts } from '../application/workspace-service.js';
import type { ArtifactStore } from '../application/ports.js';
import type { ContextBundle } from '../domain/retrieval.js';
import { projectContextForDelivery, resolveDeliveryIntent } from '../domain/context-delivery.js';
import type { MemorySearchResult } from '../domain/memory.js';
import type { WorkspaceId } from '../domain/workspace.js';

const ContextInput = Schema.Struct({
  workspace_id: Schema.String,
  query: Schema.String,
  intent: Schema.optional(Schema.String),
  include_docs: Schema.optional(Schema.Boolean),
  include_memory: Schema.optional(Schema.Boolean),
});

const ExpandInput = Schema.Struct({
  handle: Schema.String,
  cursor: Schema.optional(Schema.String),
  max_bytes: Schema.optional(Schema.Number),
});

const WorkspaceStatusInput = Schema.Struct({ workspace_id: Schema.String });

const MemoryInput = Schema.Struct({
  workspace_id: Schema.String,
  query: Schema.String,
  as_of: Schema.optional(Schema.String),
  include_original: Schema.optional(Schema.Boolean),
});

type ContextInputValue = Schema.Schema.Type<typeof ContextInput>;
type ExpandInputValue = Schema.Schema.Type<typeof ExpandInput>;
type WorkspaceStatusInputValue = Schema.Schema.Type<typeof WorkspaceStatusInput>;
type MemoryInputValue = Schema.Schema.Type<typeof MemoryInput>;

export type ToolName = 'ace_context' | 'ace_expand' | 'ace_workspace_status' | 'ace_memory_search';

export interface ToolCall {
  readonly name: string;
  readonly arguments: unknown;
}

export type GatewayResponse =
  | { readonly status: 'ok'; readonly result: Readonly<Record<string, unknown>> }
  | { readonly status: 'not_ready'; readonly capability: string; readonly code: 'NOT_READY'; readonly detail: string }
  | { readonly status: 'error'; readonly error: DomainError };

export interface McpGatewayPorts extends WorkspaceServicePorts {
  readonly artifacts: ArtifactStore;
  readonly context?: ContextProvider;
  readonly memory?: MemoryProvider;
}

export interface ContextProvider {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly intent?: string;
    readonly includeDocs: boolean;
    readonly includeMemory: boolean;
  }) => Effect.Effect<Result<ContextBundle, DomainError>>;
}

export interface MemoryProvider {
  readonly search: (input: {
    readonly workspaceId: WorkspaceId;
    readonly query: string;
    readonly asOfMs?: number;
    readonly includeOriginal: boolean;
  }) => Effect.Effect<Result<MemorySearchResult, DomainError>>;
}

const decode = <Value>(schema: Schema.Schema<Value, Value, never>, input: unknown): Result<Value, DomainError> => {
  try {
    return ok(Schema.decodeUnknownSync(schema)(input));
  } catch {
    return err(domainError('INVALID_INPUT', 'arguments', 'tool arguments do not match the versioned schema'));
  }
};

const responseError = (result: Result<unknown, DomainError>): GatewayResponse =>
  result._tag === 'Err' ? { status: 'error', error: result.error } : { status: 'ok', result: {} };

const notReady = (capability: string): GatewayResponse => ({
  status: 'not_ready',
  capability,
  code: 'NOT_READY',
  detail: `${capability} is not implemented in foundation; no provider success is simulated`,
});

export const makeMcpGateway = (ports: McpGatewayPorts) => ({
  handle: (call: ToolCall): Effect.Effect<GatewayResponse> =>
    Effect.gen(function* () {
      switch (call.name) {
        case 'ace_context': {
          const input = decode(ContextInput, call.arguments);
          if (isErr(input)) return responseError(input);
          const workspaceId = workspaceIdFrom(input.value.workspace_id);
          if (isErr(workspaceId)) return responseError(workspaceId);
          const workspace = yield* ports.store.get(workspaceId.value);
          if (isErr(workspace)) return responseError(workspace);
          if (ports.context !== undefined) {
            const result = yield* ports.context.search({
              workspaceId: workspaceId.value,
              query: input.value.query,
              ...(input.value.intent === undefined ? {} : { intent: input.value.intent }),
              includeDocs: input.value.include_docs ?? false,
              includeMemory: input.value.include_memory ?? false,
            });
            if (isErr(result)) return responseError(result);
            const delivered = projectContextForDelivery(result.value, resolveDeliveryIntent(input.value.intent));
            return { status: 'ok', result: { ...delivered } };
          }
          return notReady('unified_context');
        }
        case 'ace_expand': {
          const input = decode(ExpandInput, call.arguments);
          if (isErr(input)) return responseError(input);
          const range = yield* ports.artifacts.readRange(input.value.handle, input.value.cursor, input.value.max_bytes);
          if (isErr(range)) return responseError(range);
          return {
            status: 'ok',
            result: {
              encoding: 'base64',
              content_base64: Buffer.from(range.value.bytes).toString('base64'),
              digest: range.value.digest,
              offset: range.value.offset,
              total_bytes: range.value.totalBytes,
              ...(range.value.nextCursor === undefined ? {} : { next_cursor: range.value.nextCursor }),
            },
          };
        }
        case 'ace_workspace_status': {
          const input = decode(WorkspaceStatusInput, call.arguments);
          if (isErr(input)) return responseError(input);
          const workspaceId = workspaceIdFrom(input.value.workspace_id);
          if (isErr(workspaceId)) return responseError(workspaceId);
          const workspace = yield* ports.store.get(workspaceId.value);
          if (isErr(workspace)) return responseError(workspace);
          return {
            status: 'ok',
            result: {
              workspace_id: workspace.value.workspaceId,
              observation_epoch: workspace.value.observationEpoch,
              index_status: ports.context === undefined ? 'not_ready' : 'ready',
              freshness: workspace.value.lastObservation === undefined ? 'unknown' : 'observed',
            },
          };
        }
        case 'ace_memory_search': {
          const input = decode(MemoryInput, call.arguments);
          if (isErr(input)) return responseError(input);
          const workspaceId = workspaceIdFrom(input.value.workspace_id);
          if (isErr(workspaceId)) return responseError(workspaceId);
          const workspace = yield* ports.store.get(workspaceId.value);
          if (isErr(workspace)) return responseError(workspace);
          if (ports.memory !== undefined) {
            const asOfMs = input.value.as_of === undefined ? undefined : Date.parse(input.value.as_of);
            if (asOfMs !== undefined && !Number.isFinite(asOfMs)) {
              return responseError(err(domainError('INVALID_INPUT', 'as_of', 'as_of must be an ISO date')));
            }
            const result = yield* ports.memory.search({
              workspaceId: workspaceId.value,
              query: input.value.query,
              ...(asOfMs === undefined ? {} : { asOfMs }),
              includeOriginal: input.value.include_original ?? false,
            });
            if (isErr(result)) return responseError(result);
            return { status: 'ok', result: { ...result.value } };
          }
          return notReady('project_memory');
        }
        default:
          return responseError(err(domainError('INVALID_INPUT', 'tool', 'unknown ACE tool')));
      }
    }),
});

export type { ContextInputValue, ExpandInputValue, MemoryInputValue, WorkspaceStatusInputValue };
