import type { RetrievalEvidence } from './retrieval.js';

export type ContextAssemblySource = RetrievalEvidence['source'];

export interface ContextAssemblyInput {
  readonly evidence: readonly RetrievalEvidence[];
  readonly budgetTokens: number;
}

export interface ContextAssemblyResult {
  readonly selected: readonly RetrievalEvidence[];
  readonly omitted: readonly RetrievalEvidence[];
  readonly text: string;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
  readonly limitations: readonly string[];
}

const sourcePriority: readonly ContextAssemblySource[] = [
  'code',
  'structural',
  'lsp',
  'documentation',
  'memory',
  'history',
];

const tokensFor = (text: string): number => Math.ceil(text.length / 4);

const evidenceText = (item: RetrievalEvidence): string => {
  const header = `[${item.source}] ${item.citation}`;
  if (item.content.length === 0) return `${header}\n[exact evidence available via expansion handle]`;
  return `${header}\n${item.content}`;
};

const dedupeKey = (item: RetrievalEvidence): string => [
  item.receiptId ?? item.evidenceId,
  item.sourceDigest ?? '',
  item.citation,
].join('\0');

export const assembleContext = (input: ContextAssemblyInput): ContextAssemblyResult => {
  const grouped = new Map<ContextAssemblySource, RetrievalEvidence[]>();
  for (const item of input.evidence) grouped.set(item.source, [...(grouped.get(item.source) ?? []), item]);
  const ordered = sourcePriority.flatMap((source) => grouped.get(source) ?? []);
  const selected: RetrievalEvidence[] = [];
  const omitted: RetrievalEvidence[] = [];
  const blocks: string[] = [];
  const seen = new Set<string>();
  let estimatedTokens = 0;

  for (const item of ordered) {
    if (seen.has(dedupeKey(item))) {
      omitted.push(item);
      continue;
    }
    seen.add(dedupeKey(item));
    const block = evidenceText(item);
    const nextTokens = tokensFor(`${blocks.length === 0 ? '' : '\n\n'}${block}`);
    if (estimatedTokens + nextTokens > input.budgetTokens) {
      omitted.push(item);
      continue;
    }
    selected.push(item);
    blocks.push(block);
    estimatedTokens += nextTokens;
  }

  return {
    selected,
    omitted,
    text: blocks.join('\n\n'),
    estimatedTokens,
    truncated: omitted.length > 0,
    limitations: omitted.length === 0 ? [] : [`${omitted.length} evidence items omitted by context budget or deduplication`],
  };
};
