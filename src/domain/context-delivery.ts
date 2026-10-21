import type { BundleId, ContextBundle, ContextDeliveryMetrics, RetrievalEvidence } from './retrieval.js';

/**
 * User-visible retrieval intent is a delivery choice, not a different trust
 * level: source verification/coverage happen BEFORE projection.
 *
 * "locate" is a navigation-first response. "inspect" returns the complete
 * verified snippet bodies. Neither mode imposes a byte/token ceiling on
 * ace_expand, which remains an exact, paginated original-byte transport.
 */
export type ContextDeliveryIntent = 'locate' | 'inspect';

export const resolveDeliveryIntent = (intent: string | undefined): ContextDeliveryIntent =>
  intent === 'inspect' || intent === 'full' || intent === 'implementation' ? 'inspect' : 'locate';

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export const deliveryMetricsFor = (
  bundle: Omit<ContextBundle, 'deliveryMetrics'>,
): ContextDeliveryMetrics => {
  const newContextBytes = bundle.evidence.reduce((total, item) => total + utf8Bytes(item.content), 0);
  const reusedContextBytes = bundle.evidence.reduce((total, item) => total + (item.reusedContentBytes ?? 0), 0);
  const initialEvidenceBytes = newContextBytes + reusedContextBytes;
  const uniqueContent = new Map<string, number>();
  for (const item of bundle.evidence) {
    const key = item.sourceDigest ?? item.content;
    uniqueContent.set(key, Math.max(uniqueContent.get(key) ?? 0, utf8Bytes(item.content)));
  }
  const uniqueContentBytes = [...uniqueContent.values()].reduce((total, bytes) => total + bytes, 0);
  const expansionBytesAvailable = bundle.evidence.reduce(
    (total, item) => total + (item.expansionTotalBytes ?? 0),
    0,
  );
  const expansionHandleCount = bundle.evidence.filter((item) => item.expansionHandle !== undefined).length;
  const structuredContentBytes = utf8Bytes(JSON.stringify(bundle));
  return {
    initialEvidenceBytes,
    structuredContentBytes,
    uniqueContentBytes,
    duplicateContentBytes: Math.max(0, newContextBytes - uniqueContentBytes),
    newContextBytes,
    reusedContextBytes,
    duplicateContextBytesAvoided: reusedContextBytes,
    uniqueEvidenceCount: new Set(bundle.evidence.map((item) => item.evidenceId)).size,
    expansionBytesAvailable,
    expansionHandleCount,
  };
};

/** A structural declaration rather than arbitrary substring truncation. */
const declarationLine = (content: string): string =>
  (() => {
    const firstLine = content.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ?? '';
    // A minified one-line body has no useful declaration boundary. Expose its
    // exact expansion handle, not megabytes of opaque source as a "summary".
    return firstLine.length <= 512 ? firstLine : '';
  })();

const fnv1a64 = (value: string, seed: bigint): string => {
  let hash = seed;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
};

const stableReceiptDigest = (value: string): string => [
  0xcbf29ce484222325n,
  0x84222325cbf29ce4n,
  0x9e3779b185ebca87n,
  0xd6e8feb86659fd93n,
].map((seed) => fnv1a64(value, seed)).join('');

const bundleIdentity = (bundle: ContextBundle): BundleId => stableReceiptDigest(JSON.stringify({
  query: bundle.query,
  evidence: bundle.evidence.map((item) => [
    item.evidenceId,
    item.source,
    item.citation,
    item.sourceRevision ?? item.sourceDigest ?? null,
    item.freshness,
  ]),
  partialSources: [...bundle.partialSources].sort(),
  complete: bundle.complete,
})) as BundleId;

export interface ContextReceiptInput {
  readonly knownEvidenceIds?: readonly string[];
  readonly knownBundleId?: string;
}

const suppressKnownEvidence = (
  evidence: readonly RetrievalEvidence[],
  knownEvidenceIds: readonly string[],
): readonly RetrievalEvidence[] => {
  if (knownEvidenceIds.length === 0) return evidence;
  const known = new Set(knownEvidenceIds);
  return evidence.map((item) => {
    if (!known.has(item.evidenceId) || item.content.length === 0) return item;
    return {
      ...item,
      reusedContentBytes: utf8Bytes(item.content),
      content: '',
      contentDelivery: 'known_reference' as const,
    };
  });
};

export const projectContextForDelivery = (
  bundle: ContextBundle,
  intent: ContextDeliveryIntent,
  receipts: ContextReceiptInput = {},
): ContextBundle => {
  const projected = intent === 'inspect'
    ? bundle
    : (() => {
      let inlinedCode = 0;
      const evidence: RetrievalEvidence[] = bundle.evidence.map((item) => {
        if (item.source !== 'code' || item.expansionHandle === undefined) return item;
        inlinedCode += 1;

        // Inline the top two ranked symbol bodies when short enough to be a
        // convenient review unit. For a long symbol, return its declaration and
        // an explicit full-original handle rather than silently slicing source.
        const lines = item.content.split(/\r?\n/u);
        const fullInline = inlinedCode <= 2 && lines.length <= 40 && item.content.length <= 2_048;
        if (fullInline) return item;
        return {
          ...item,
          content: declarationLine(item.content),
          contentDelivery: 'expand' as const,
          originalSpanLines: lines.length,
        };
      });
      return { ...bundle, evidence };
    })();

  const bundleId = projected.bundleId ?? bundleIdentity(projected);
  const knownEvidenceIds = receipts.knownEvidenceIds ?? [];
  const evidence = suppressKnownEvidence(projected.evidence, knownEvidenceIds);
  const delivered: ContextBundle = {
    ...projected,
    bundleId,
    evidence,
    ...(receipts.knownBundleId === undefined || receipts.knownBundleId.trim().length === 0
      ? {}
      : { supersedesBundleId: receipts.knownBundleId.trim() as BundleId }),
  };
  return { ...delivered, deliveryMetrics: deliveryMetricsFor(delivered) };
};

type ContextCarrier = Readonly<Record<string, unknown>>;

export const contextTransportText = (bundle: ContextCarrier): string => {
  const evidence = Array.isArray(bundle.evidence) ? bundle.evidence : [];
  const sources = evidence.flatMap((value): string[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.citation !== 'string') return [];
    const span = typeof item.expansionCursor === 'string' && typeof item.expansionMaxBytes === 'number'
      ? ` cursor=${item.expansionCursor}, max_bytes=${item.expansionMaxBytes}`
      : '';
    const mode = item.contentDelivery === 'expand'
      ? ` [exact body via ace_expand(handle${span})]`
      : item.contentDelivery === 'known_reference'
        ? ` [body omitted: caller supplied stable evidence receipt${typeof item.expansionHandle === 'string' ? `; exact body via ace_expand(handle${span})` : ''}]`
        : '';
    // Do not mirror snippet text here: structuredContent owns verified code
    // bodies. Text is a compact navigation map only.
    return [`- ${item.citation}${mode}`];
  });
  const warnings = Array.isArray(bundle.warnings) ? bundle.warnings : [];
  return [
    `ACE source map: ${evidence.length} cited items, complete=${bundle.complete === true}.`,
    ...sources,
    ...(warnings.length === 0 ? [] : [`Warnings: ${warnings.map(String).join('; ')}`]),
    'Use structuredContent for verified inlined snippets; for a cited symbol call ace_expand(handle, cursor=expansionCursor, max_bytes=expansionMaxBytes, format=utf8). Omit cursor/max_bytes only when the full original file is needed.',
  ].join('\n');
};
