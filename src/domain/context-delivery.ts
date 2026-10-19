import type { ContextBundle, RetrievalEvidence } from './retrieval.js';

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

/** A structural declaration rather than arbitrary substring truncation. */
const declarationLine = (content: string): string =>
  (() => {
    const firstLine = content.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ?? '';
    // A minified one-line body has no useful declaration boundary. Expose its
    // exact expansion handle, not megabytes of opaque source as a "summary".
    return firstLine.length <= 512 ? firstLine : '';
  })();

export const projectContextForDelivery = (
  bundle: ContextBundle,
  intent: ContextDeliveryIntent,
): ContextBundle => {
  if (intent === 'inspect') return bundle;
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
};

type ContextCarrier = Readonly<Record<string, unknown>>;

export const contextTransportText = (bundle: ContextCarrier): string => {
  const evidence = Array.isArray(bundle.evidence) ? bundle.evidence : [];
  const sources = evidence.flatMap((value): string[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.citation !== 'string') return [];
    const mode = item.contentDelivery === 'expand' ? ' [exact body via ace_expand]' : '';
    const line = item.source === 'code' && typeof item.content === 'string' && item.content.length > 0
      ? ` — ${item.content.split(/\r?\n/u)[0]?.trim() ?? ''}`
      : '';
    return [`- ${item.citation}${mode}${line}`];
  });
  const warnings = Array.isArray(bundle.warnings) ? bundle.warnings : [];
  return [
    `ACE source map: ${evidence.length} cited items, complete=${bundle.complete === true}.`,
    ...sources,
    ...(warnings.length === 0 ? [] : [`Warnings: ${warnings.map(String).join('; ')}`]),
    'Use structuredContent for verified inlined snippets; call ace_expand(handle, cursor) for lossless original bytes when needed.',
  ].join('\n');
};
