import type { RetrievalEvidence } from './retrieval.js';

export type ContextAssemblySource = RetrievalEvidence['source'];
export type ContextAssemblySection = 'code' | 'repo_map' | 'lsp' | 'other';
export type ContextAssemblySectionBudgets = Readonly<Partial<Record<ContextAssemblySection, number>>>;
export type ContextAssemblySectionUsage = Readonly<Record<ContextAssemblySection, number>>;

export interface ContextAssemblyInput {
  readonly evidence: readonly RetrievalEvidence[];
  readonly budgetTokens: number;
  /** Optional absolute token caps; omitted sections use bounded defaults. */
  readonly sectionBudgets?: ContextAssemblySectionBudgets;
  /** Native host/model tokenizer. Omit only when no model-bound counter is available. */
  readonly countTokens?: (text: string) => number;
}

export interface ContextAssemblyResult {
  readonly selected: readonly RetrievalEvidence[];
  readonly omitted: readonly RetrievalEvidence[];
  readonly text: string;
  readonly estimatedTokens: number;
  readonly tokenCountMode: 'host_counter' | 'character_estimate';
  readonly truncated: boolean;
  readonly limitations: readonly string[];
  readonly sectionBudgets: Readonly<Record<ContextAssemblySection, number>>;
  readonly sectionUsage: ContextAssemblySectionUsage;
}

const sourcePriority: readonly ContextAssemblySource[] = [
  'code',
  'structural',
  'lsp',
  'documentation',
  'memory',
  'history',
];

const sectionFor = (source: ContextAssemblySource): ContextAssemblySection => {
  if (source === 'code') return 'code';
  if (source === 'structural') return 'repo_map';
  if (source === 'lsp') return 'lsp';
  return 'other';
};

const defaultSectionBudgets = (budgetTokens: number): Readonly<Record<ContextAssemblySection, number>> => ({
  code: Math.max(8, Math.floor(budgetTokens * 0.6)),
  repo_map: Math.max(4, Math.floor(budgetTokens * 0.15)),
  lsp: Math.max(4, Math.floor(budgetTokens * 0.15)),
  other: Math.max(4, Math.floor(budgetTokens * 0.1)),
});

const sectionBudgetsFor = (
  budgetTokens: number,
  requested: ContextAssemblySectionBudgets | undefined,
): Readonly<Record<ContextAssemblySection, number>> => {
  const defaults = defaultSectionBudgets(budgetTokens);
  return {
    code: requested?.code ?? defaults.code,
    repo_map: requested?.repo_map ?? defaults.repo_map,
    lsp: requested?.lsp ?? defaults.lsp,
    other: requested?.other ?? defaults.other,
  };
};

// Diagnostic fallback only; never claim that this estimate is an exact model budget.
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const evidenceText = (item: RetrievalEvidence): string => {
  const header = `[${item.source}] ${item.citation}`;
  if (item.content.length === 0) return `${header}\n[exact evidence available via expansion handle]`;
  return `${header}\n${item.content}`;
};

const dedupeKey = (item: RetrievalEvidence): string => (
  item.sourceDigest !== undefined
    ? ['exact-source', item.sourceDigest, item.citation, item.content].join('\0')
    : ['receipt', item.receiptId ?? item.evidenceId, item.citation, item.content].join('\0')
);

export const assembleContext = (input: ContextAssemblyInput): ContextAssemblyResult => {
  const grouped = new Map<ContextAssemblySource, RetrievalEvidence[]>();
  for (const item of input.evidence) grouped.set(item.source, [...(grouped.get(item.source) ?? []), item]);
  const ordered = sourcePriority.flatMap((source) => grouped.get(source) ?? []);
  const selected: RetrievalEvidence[] = [];
  const omitted: RetrievalEvidence[] = [];
  const blocks: string[] = [];
  const sectionBlocks: Record<ContextAssemblySection, string[]> = {
    code: [], repo_map: [], lsp: [], other: [],
  };
  const countTokens = input.countTokens ?? estimateTokens;
  const countVerified = (content: string): number => {
    const count = countTokens(content);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('model token counter returned a non-integer, negative or unsafe count');
    }
    return count;
  };
  const seen = new Set<string>();
  let estimatedTokens = 0;
  let budgetOmitted = 0;
  const sectionBudgets = sectionBudgetsFor(input.budgetTokens, input.sectionBudgets);
  const sectionUsage: Record<ContextAssemblySection, number> = { code: 0, repo_map: 0, lsp: 0, other: 0 };

  for (const item of ordered) {
    if (seen.has(dedupeKey(item))) {
      omitted.push(item);
      continue;
    }
    seen.add(dedupeKey(item));
    const block = evidenceText(item);
    const section = sectionFor(item.source);
    // Count the entire model-visible string: BPE is not additive across blocks
    // or separators. The host owns exact tokenization when available.
    const nextSection = [...sectionBlocks[section], block].join('\n\n');
    const nextSectionTokens = countVerified(nextSection);
    const nextWholeTokens = countVerified([...blocks, block].join('\n\n'));
    if (nextSectionTokens > sectionBudgets[section]
      || nextWholeTokens > input.budgetTokens) {
      budgetOmitted += 1;
      omitted.push(item);
      continue;
    }
    selected.push(item);
    blocks.push(block);
    sectionBlocks[section].push(block);
    estimatedTokens = nextWholeTokens;
    sectionUsage[section] = nextSectionTokens;
  }

  return {
    selected,
    omitted,
    text: blocks.join('\n\n'),
    estimatedTokens,
    tokenCountMode: input.countTokens === undefined ? 'character_estimate' : 'host_counter',
    truncated: budgetOmitted > 0,
    limitations: budgetOmitted === 0 ? [] : [`${budgetOmitted} evidence items omitted by context budget`],
    sectionBudgets,
    sectionUsage,
  };
};
