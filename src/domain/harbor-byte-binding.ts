export interface HarborTaskByteBinding {
  readonly id: string;
  readonly repositoryId: string;
  readonly path: string;
  readonly sha256: string;
}

export interface HarborConfigByteBinding {
  readonly path: string | null;
  readonly bytesSha256: string | null;
  readonly effectiveSha256: string;
}

export interface HarborExternalEvidence {
  readonly schemaVersion: 1;
  readonly taskManifestPath: string;
  readonly taskManifestSha256: string;
  readonly taskBytesSha256: string;
  readonly taskBindings: readonly HarborTaskByteBinding[];
  readonly repositoryRevisions: Readonly<Record<string, string>>;
  readonly modelIdentity: string;
  readonly providerIdentity: string;
  readonly runtimeImageIdentity: string;
  readonly codexConfig: HarborConfigByteBinding;
}

export const harborTaskBindingDigestInput = (
  bindings: readonly HarborTaskByteBinding[],
): string => JSON.stringify([...bindings]
  .sort((left, right) => left.id.localeCompare(right.id) || left.path.localeCompare(right.path)));

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

/**
 * Returns the canonical effective Codex/MCP configuration payload to hash at
 * the imperative boundary. It includes the environment and the literal
 * config path, while the separately supplied config digest binds file bytes.
 */
export const effectiveHarborConfigurationPayload = (
  value: unknown,
  configBytesSha256: string | null,
): string => {
  const root = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const agent = Array.isArray(root.agents) && root.agents.length === 1
    && typeof root.agents[0] === 'object' && root.agents[0] !== null
    ? root.agents[0] as Record<string, unknown>
    : {};
  const kwargs = typeof agent.kwargs === 'object' && agent.kwargs !== null && !Array.isArray(agent.kwargs)
    ? agent.kwargs
    : {};
  return JSON.stringify(canonicalize({
    agent: {
      name: agent.name ?? null,
      model_name: agent.model_name ?? null,
      env: agent.env ?? null,
      kwargs,
    },
    environment: root.environment ?? null,
    configBytesSha256,
  }));
};
