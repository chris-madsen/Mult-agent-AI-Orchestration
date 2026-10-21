import { createHash } from 'node:crypto';
import type {
  BundleId,
  ContextBundle,
  ContextDeliveryMetrics,
  EvidenceId,
  EvidenceReceiptId,
  RetrievalEvidence,
} from './retrieval.js';

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

const evidenceContentBytes = (evidence: readonly RetrievalEvidence[]): number =>
  evidence.reduce((total, item) => total + utf8Bytes(item.content), 0);

const uniqueEvidenceContentBytes = (evidence: readonly RetrievalEvidence[]): number => {
  const uniqueContent = new Set<string>();
  let total = 0;
  for (const item of evidence) {
    if (item.content.length === 0 || uniqueContent.has(item.content)) continue;
    uniqueContent.add(item.content);
    total += utf8Bytes(item.content);
  }
  return total;
};

interface DeliveryMetricStages {
  readonly initialEvidence?: readonly RetrievalEvidence[];
  readonly projectedEvidence?: readonly RetrievalEvidence[];
}

export const deliveryMetricsFor = (
  bundle: Omit<ContextBundle, 'deliveryMetrics'>,
  stages: DeliveryMetricStages = {},
): ContextDeliveryMetrics => {
  const initialEvidence = stages.initialEvidence ?? bundle.evidence;
  const projectedEvidence = stages.projectedEvidence ?? bundle.evidence;
  const initialEvidenceBytes = evidenceContentBytes(initialEvidence);
  const projectedEvidenceBytes = evidenceContentBytes(projectedEvidence);
  const newContextBytes = evidenceContentBytes(bundle.evidence);
  const reusedContextBytes = bundle.evidence.reduce((total, item) => total + (item.reusedContentBytes ?? 0), 0);
  const uniqueContentBytes = uniqueEvidenceContentBytes(projectedEvidence);
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
    duplicateContentBytes: Math.max(0, projectedEvidenceBytes - uniqueContentBytes),
    projectionBytesAvoided: Math.max(0, initialEvidenceBytes - projectedEvidenceBytes),
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

const structuralOutline = (item: RetrievalEvidence): string | undefined => {
  const name = item.structuralName?.trim();
  const kind = item.structuralKind;
  if ((name === undefined || name.length === 0) && kind === undefined) return undefined;
  return [
    item.structuralExported === true ? 'exported' : undefined,
    kind ?? 'symbol',
    name,
    item.structuralLanguage === undefined ? undefined : `[${item.structuralLanguage}]`,
  ].filter((value): value is string => value !== undefined && value.length > 0).join(' ');
};

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
    item.sourceDigest ?? null,
    item.sourceRevision ?? null,
    item.content,
    item.freshness,
  ]),
  partialSources: [...bundle.partialSources].sort(),
  complete: bundle.complete,
})) as BundleId;

export interface ContextReceiptInput {
  readonly knownEvidenceIds?: readonly string[];
  readonly knownBundleId?: string;
  /** Internal workspace scope; never serialized into the MCP response. */
  readonly receiptScope?: string;
}

const freshnessWeight = (value: RetrievalEvidence['freshness']): number => {
  switch (value) {
    case 'current': return 4;
    case 'unknown': return 3;
    case 'stale': return 2;
    case 'changed_during_request': return 1;
  }
};

const proofWeight = (value: RetrievalEvidence['proofClass']): number => {
  switch (value) {
    case 'direct': return 3;
    case 'derived': return 2;
    case 'uncertain': return 1;
  }
};

const dedupeKeyFor = (item: RetrievalEvidence): string | undefined => {
  // A source digest is the verification boundary. Without it, equal-looking
  // snippets may come from different revisions and must remain distinct.
  if (item.source !== 'code' || item.sourceDigest === undefined) return undefined;
  return JSON.stringify([
    item.sourceDigest,
    item.citation,
    item.content,
    item.conflictKey ?? null,
    item.conflictValue ?? null,
  ]);
};

const evidenceAliases = (item: RetrievalEvidence): Set<string> => new Set([
  String(item.evidenceId),
  ...(item.equivalentEvidenceIds ?? []).map(String),
]);

const withEvidenceAliases = (
  item: RetrievalEvidence,
  ...others: readonly RetrievalEvidence[]
): RetrievalEvidence => {
  const aliases = new Set<string>();
  for (const candidate of [item, ...others]) {
    for (const id of evidenceAliases(candidate)) aliases.add(id);
  }
  aliases.delete(String(item.evidenceId));
  return aliases.size === 0
    ? item
    : { ...item, equivalentEvidenceIds: [...aliases].map((id) => id as EvidenceId) };
};

const deliveryProjectionFor = (item: RetrievalEvidence, intent: ContextDeliveryIntent): string => [
  intent,
  item.contentDelivery ?? 'inline',
  item.originalSpanLines ?? '',
].join(':');

const receiptIdFor = (
  item: RetrievalEvidence,
  intent: ContextDeliveryIntent,
  scope: string | undefined,
): EvidenceReceiptId | undefined => {
  if (scope === undefined || scope.trim().length === 0) return undefined;
  const bodyDigest = createHash('sha256').update(item.content, 'utf8').digest('hex');
  const identity = [
    'ace-receipt-v1',
    scope.trim(),
    item.source,
    item.citation,
    item.sourceDigest ?? '',
    item.sourceRevision ?? '',
    bodyDigest,
    deliveryProjectionFor(item, intent),
    item.freshness,
    item.proofClass,
  ].join('\0');
  return `receipt-v1-${createHash('sha256').update(identity, 'utf8').digest('hex')}` as EvidenceReceiptId;
};

/**
 * Only collapse duplicate digest-verified code representations of the same
 * exact span/body. This is intentionally an exact-span rule: nested ranges
 * are not inferred to be redundant because an inner function, claim, or
 * citation can carry independent retrieval value.
 * Cross-source evidence is intentionally preserved even when text matches:
 * independent docs/memory/history provenance is necessary for conflicts and
 * rationale. Input order is the final tie-breaker, preserving retrieval rank.
 */
export const dedupeEvidenceForDelivery = (
  evidence: readonly RetrievalEvidence[],
): readonly RetrievalEvidence[] => {
  const selected: RetrievalEvidence[] = [];
  const codeIndex = new Map<string, number>();
  for (const item of evidence) {
    const key = dedupeKeyFor(item);
    if (key === undefined) {
      selected.push(item);
      continue;
    }
    const priorIndex = codeIndex.get(key);
    if (priorIndex === undefined) {
      codeIndex.set(key, selected.length);
      selected.push(item);
      continue;
    }
    const prior = selected[priorIndex];
    if (prior === undefined) continue;
    const priorWeight = freshnessWeight(prior.freshness) * 10
      + proofWeight(prior.proofClass)
      + (prior.expansionHandle === undefined ? 0 : 1);
    const nextWeight = freshnessWeight(item.freshness) * 10
      + proofWeight(item.proofClass)
      + (item.expansionHandle === undefined ? 0 : 1);
    if (nextWeight > priorWeight) {
      selected[priorIndex] = withEvidenceAliases(item, prior);
    } else {
      selected[priorIndex] = withEvidenceAliases(prior, item);
    }
  }
  return selected;
};

const suppressKnownEvidence = (
  evidence: readonly RetrievalEvidence[],
  knownEvidenceIds: readonly string[],
  receiptMatchesBundle: boolean,
  receiptScope: string | undefined,
): readonly RetrievalEvidence[] => {
  if (!receiptMatchesBundle && (knownEvidenceIds.length === 0 || receiptScope === undefined)) return evidence;
  const known = new Set(knownEvidenceIds);
  return evidence.map((item) => {
    const exactReceiptKnown = receiptScope !== undefined
      && item.receiptId !== undefined
      && known.has(item.receiptId);
    const legacyEvidenceKnown = receiptMatchesBundle
      && knownEvidenceIds.length > 0
      && known.has(item.evidenceId);
    const wholeBundleKnown = receiptMatchesBundle && knownEvidenceIds.length === 0;
    if ((!exactReceiptKnown && !legacyEvidenceKnown && !wholeBundleKnown) || item.content.length === 0) return item;
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
  const sourceAwareBundle: ContextBundle = {
    ...bundle,
    evidence: dedupeEvidenceForDelivery(bundle.evidence),
  };
  const initialEvidence = sourceAwareBundle.evidence;
  const projected = intent === 'inspect'
    ? sourceAwareBundle
    : (() => {
      let inlinedCode = 0;
      const evidence: RetrievalEvidence[] = sourceAwareBundle.evidence.map((item) => {
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
          content: structuralOutline(item) ?? declarationLine(item.content),
          contentDelivery: 'expand' as const,
          originalSpanLines: lines.length,
        };
      });
      return { ...sourceAwareBundle, evidence };
    })();

  // Recompute from the projected evidence instead of trusting an upstream
  // optional id: a caller may reuse a ContextBundle object after source bytes
  // or delivery projection changed.
  const bundleId = bundleIdentity(projected);
  const knownEvidenceIds = receipts.knownEvidenceIds ?? [];
  const receiptEvidence = projected.evidence.map((item) => {
    const receiptId = receiptIdFor(item, intent, receipts.receiptScope);
    return {
      ...item,
      ...(receiptId === undefined ? {} : { receiptId }),
    };
  });
  const evidence = suppressKnownEvidence(
    receiptEvidence,
    knownEvidenceIds,
    receipts.knownBundleId !== undefined && receipts.knownBundleId === bundleId,
    receipts.receiptScope,
  );
  const delivered: ContextBundle = {
    ...projected,
    bundleId,
    evidence,
    ...(receipts.knownBundleId === undefined || receipts.knownBundleId.trim().length === 0
      ? {}
      : { supersedesBundleId: receipts.knownBundleId.trim() as BundleId }),
  };
  return {
    ...delivered,
    deliveryMetrics: deliveryMetricsFor(delivered, {
      initialEvidence,
      projectedEvidence: projected.evidence,
    }),
  };
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
