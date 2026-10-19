import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { domainError, type DomainError, type DomainErrorCode } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  ingestRepoPath,
  makeContentDigest,
  makeWorkspaceId,
  type FileObservation,
  type RepoPath,
  type WorkspaceId,
  type WorkspaceSnapshot,
} from '../domain/workspace.js';
import type { ExactRead, WorkspaceFilePort } from '../application/ports.js';
import { makeNodeWorkspacePort } from './node-workspace-port.js';

export type HostWorktreeRequest =
  | { readonly operation: 'canonicalize'; readonly workspaceId: string }
  | { readonly operation: 'snapshot'; readonly workspaceId: string; readonly observedAtMs: number }
  | { readonly operation: 'read_exact'; readonly workspaceId: string; readonly repoPath: string };

export type HostWorktreeValue =
  | { readonly logicalRoot: string }
  | { readonly snapshot: WorkspaceSnapshot }
  | { readonly bytesBase64: string; readonly digest: string };

export interface HostWorktreeWireResult {
  readonly ok: boolean;
  readonly value?: HostWorktreeValue;
  readonly error?: DomainError;
}

export interface HostWorktreeHelperService {
  readonly handle: (request: HostWorktreeRequest) => Promise<Result<HostWorktreeValue, DomainError>>;
}

const logicalRootFor = (workspaceId: WorkspaceId): string =>
  '/ace-host-workspace/' + createHash('sha256').update(workspaceId).digest('hex').slice(0, 24);

export const makeHostWorktreeHelperService = async (
  workspaces: Readonly<Record<string, string>>,
): Promise<Result<HostWorktreeHelperService, DomainError>> => {
  const entries = Object.entries(workspaces);
  if (entries.length === 0) {
    return err(domainError('INVALID_INPUT', 'workspaces', 'host helper requires at least one configured workspace'));
  }
  const files = makeNodeWorkspacePort({ allowedRoots: entries.map(([, root]) => root) });
  const roots = new Map<WorkspaceId, string>();
  for (const [rawWorkspaceId, root] of entries) {
    const workspaceId = makeWorkspaceId(rawWorkspaceId);
    if (workspaceId._tag === 'Err') return workspaceId;
    const canonical = await Effect.runPromise(files.canonicalizeRoot(root));
    if (canonical._tag === 'Err') return canonical;
    roots.set(workspaceId.value, canonical.value);
  }

  const rootFor = (rawWorkspaceId: string): Result<{ readonly workspaceId: WorkspaceId; readonly root: string }, DomainError> => {
    const workspaceId = makeWorkspaceId(rawWorkspaceId);
    if (workspaceId._tag === 'Err') return workspaceId;
    const root = roots.get(workspaceId.value);
    return root === undefined
      ? err(domainError('WORKSPACE_NOT_FOUND', 'workspace_id', 'workspace is not registered with the host helper'))
      : ok({ workspaceId: workspaceId.value, root });
  };

  return ok({
    handle: async (input) => {
      const selected = rootFor(input.workspaceId);
      if (selected._tag === 'Err') return selected;
      if (input.operation === 'canonicalize') {
        return ok({ logicalRoot: logicalRootFor(selected.value.workspaceId) });
      }
      if (input.operation === 'snapshot') {
        if (!Number.isSafeInteger(input.observedAtMs) || input.observedAtMs < 0) {
          return err(domainError('INVALID_INPUT', 'observed_at_ms', 'snapshot timestamp must be a non-negative safe integer'));
        }
        const snapshot = await Effect.runPromise(files.snapshot(selected.value.root, input.observedAtMs));
        return snapshot._tag === 'Err' ? snapshot : ok({ snapshot: snapshot.value });
      }
      const repoPath = ingestRepoPath(input.repoPath);
      if (repoPath._tag === 'Err') return repoPath;
      const read = await Effect.runPromise(files.readExact(selected.value.root, repoPath.value));
      return read._tag === 'Err'
        ? read
        : ok({ bytesBase64: Buffer.from(read.value.bytes).toString('base64'), digest: read.value.digest });
    },
  });
};

export interface HostHelperTransport {
  readonly invoke: (request: HostWorktreeRequest) => Promise<Result<HostWorktreeValue, DomainError>>;
}

const domainCodes: ReadonlySet<string> = new Set<DomainErrorCode>([
  'INVALID_INPUT', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_ROOT_NOT_ALLOWED', 'PATH_ESCAPE', 'FILE_NOT_FOUND',
  'DIGEST_MISMATCH', 'WORKTREE_RACED', 'SNAPSHOT_FAILED', 'PERSISTENCE_FAILED', 'POLICY_DENIED', 'AUTH_REQUIRED',
  'SECRET_DETECTED', 'AUDIT_FAILED', 'ARTIFACT_NOT_FOUND', 'INVALID_HANDLE', 'NOT_READY', 'INVALID_BENCHMARK',
  'INVALID_USAGE', 'USAGE_UNAVAILABLE', 'UNSUPPORTED_PROVIDER', 'QUALITY_GATE_FAILED', 'INVALID_RETRIEVAL',
  'INVALID_MEMORY', 'INVALID_ROUTING', 'ARCHIVE_TOMBSTONED', 'EXTERNAL_UNAVAILABLE', 'INVALID_EXTERNAL_RESPONSE',
]);

const parseWireResult = (raw: unknown): Result<HostWorktreeValue, DomainError> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'worktree_helper', 'helper response must be an object'));
  }
  const wire = raw as HostWorktreeWireResult;
  if (wire.ok === true && typeof wire.value === 'object' && wire.value !== null) return ok(wire.value);
  if (wire.ok === false && typeof wire.error === 'object' && wire.error !== null
    && domainCodes.has(wire.error.code) && typeof wire.error.path === 'string' && typeof wire.error.message === 'string') {
    return err(wire.error);
  }
  return err(domainError('INVALID_EXTERNAL_RESPONSE', 'worktree_helper', 'helper response has an invalid result envelope'));
};

export interface MtlsHostHelperOptions {
  readonly endpoint: string;
  readonly caFile: string;
  readonly certificateFile: string;
  readonly privateKeyFile: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export const makeMtlsHostHelperTransport = async (options: MtlsHostHelperOptions): Promise<Result<HostHelperTransport, DomainError>> => {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    return err(domainError('INVALID_INPUT', 'worktree_helper_url', 'host helper URL is invalid'));
  }
  if (endpoint.protocol !== 'https:' || endpoint.username !== '' || endpoint.password !== '') {
    return err(domainError('INVALID_INPUT', 'worktree_helper_url', 'host helper requires an credential-free https URL'));
  }
  const [ca, cert, key] = await Promise.all([
    readFile(options.caFile),
    readFile(options.certificateFile),
    readFile(options.privateKeyFile),
  ]).catch(() => [undefined, undefined, undefined] as const);
  if (ca === undefined || cert === undefined || key === undefined) {
    return err(domainError('AUTH_REQUIRED', 'worktree_helper_tls', 'mTLS CA, client certificate and private key are required'));
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024 * 1024;
  return ok({
    invoke: (payload) => new Promise((resolve) => {
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const request = httpsRequest(endpoint, {
        method: 'POST',
        ca,
        cert,
        key,
        rejectUnauthorized: true,
        servername: endpoint.hostname,
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length),
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxResponseBytes) {
            response.destroy(new Error('host helper response exceeds limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            resolve(err(domainError('EXTERNAL_UNAVAILABLE', 'worktree_helper', 'host helper returned HTTP ' + String(response.statusCode ?? 'unknown'))));
            return;
          }
          try {
            resolve(parseWireResult(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown));
          } catch {
            resolve(err(domainError('INVALID_EXTERNAL_RESPONSE', 'worktree_helper', 'host helper returned invalid JSON')));
          }
        });
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error('host helper timed out')));
      request.on('error', () => resolve(err(domainError('EXTERNAL_UNAVAILABLE', 'worktree_helper', 'mTLS host helper request failed'))));
      request.end(body);
    }),
  });
};

const parseSnapshot = (value: HostWorktreeValue): Result<WorkspaceSnapshot, DomainError> => {
  if (!('snapshot' in value) || typeof value.snapshot !== 'object' || value.snapshot === null) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'snapshot', 'host helper snapshot response is missing'));
  }
  const raw = value.snapshot as WorkspaceSnapshot;
  if (typeof raw.headRevision !== 'string' || !Array.isArray(raw.files) || !Array.isArray(raw.removedPaths)
    || (raw.gitStatus !== undefined && raw.gitStatus !== 'available' && raw.gitStatus !== 'not_repository')) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'snapshot', 'host helper snapshot envelope is invalid'));
  }
  const files: FileObservation[] = [];
  for (const item of raw.files) {
    if (typeof item !== 'object' || item === null) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'snapshot.files', 'snapshot file observation must be an object'));
    }
    const repoPath = ingestRepoPath(item.repoPath);
    const digest = makeContentDigest(item.digest);
    if (repoPath._tag === 'Err' || digest._tag === 'Err'
      || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0
      || !Number.isSafeInteger(item.observedAtMs) || item.observedAtMs < 0
      || !['tracked', 'untracked', 'deleted', 'unknown'].includes(item.state)) {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'snapshot.files', 'snapshot file observation is invalid'));
    }
    files.push({ ...item, repoPath: repoPath.value, digest: digest.value });
  }
  const removedPaths: RepoPath[] = [];
  for (const valuePath of raw.removedPaths) {
    const repoPath = ingestRepoPath(valuePath);
    if (repoPath._tag === 'Err') return err(domainError('INVALID_EXTERNAL_RESPONSE', 'snapshot.removed_paths', 'removed path is invalid'));
    removedPaths.push(repoPath.value);
  }
  return ok({
    headRevision: raw.headRevision,
    files,
    removedPaths,
    ...(raw.gitStatus === undefined ? {} : { gitStatus: raw.gitStatus }),
  });
};

export const makeHostWorkspacePort = (
  workspaceId: WorkspaceId,
  transport: HostHelperTransport,
): WorkspaceFilePort => ({
  canonicalizeRoot: () => Effect.promise(async () => {
    const response = await transport.invoke({ operation: 'canonicalize', workspaceId });
    if (response._tag === 'Err') return response;
    return 'logicalRoot' in response.value && typeof response.value.logicalRoot === 'string'
      ? ok(response.value.logicalRoot)
      : err(domainError('INVALID_EXTERNAL_RESPONSE', 'root_path', 'host helper did not return a logical workspace root'));
  }),
  snapshot: (_logicalRoot, observedAtMs) => Effect.promise(async () => {
    const response = await transport.invoke({ operation: 'snapshot', workspaceId, observedAtMs });
    return response._tag === 'Err' ? response : parseSnapshot(response.value);
  }),
  readExact: (_logicalRoot, repoPath) => Effect.promise(async () => {
    const response = await transport.invoke({ operation: 'read_exact', workspaceId, repoPath });
    if (response._tag === 'Err') return response;
    if (!('bytesBase64' in response.value) || !('digest' in response.value)
      || typeof response.value.bytesBase64 !== 'string' || typeof response.value.digest !== 'string') {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'read_exact', 'host helper exact-read response is invalid'));
    }
    const digest = makeContentDigest(response.value.digest);
    if (digest._tag === 'Err') return err(domainError('INVALID_EXTERNAL_RESPONSE', 'read_exact.digest', 'host helper digest is invalid'));
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(response.value.bytesBase64, 'base64'));
    } catch {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', 'read_exact.bytes', 'host helper bytes are invalid base64'));
    }
    const observed = createHash('sha256').update(bytes).digest('hex');
    if (observed !== digest.value) {
      return err(domainError('DIGEST_MISMATCH', 'worktree_helper', 'host helper bytes do not match the reported digest'));
    }
    return ok<ExactRead>({ bytes, digest: digest.value });
  }),
});
