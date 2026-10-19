import { domainError, type DomainError } from './errors.js';
import { admitMemoryEpisode, defaultMemoryAdmissionPolicy, type MemoryAdmissionPolicy } from './memory-admission.js';
import { err, ok, type Result } from './result.js';

export type MemoryHoldoutLanguage = 'en' | 'ru';
export type MemoryHoldoutExpected = 'project' | 'archive_only';

export interface MemoryAdmissionHoldoutSample {
  readonly id: string;
  readonly language: MemoryHoldoutLanguage;
  readonly category: string;
  readonly text: string;
  readonly expected: MemoryHoldoutExpected;
  readonly critical: boolean;
}

export interface MemoryAdmissionEvaluation {
  readonly total: number;
  readonly expectedProject: number;
  readonly expectedArchiveOnly: number;
  readonly projected: number;
  readonly durableRecall: number;
  readonly criticalDurableRecall: number;
  readonly falsePromotionRate: number;
  readonly projectionRate: number;
  readonly totalCharacters: number;
  readonly projectedCharacters: number;
  readonly projectedCharacterRatio: number;
  readonly missedDurableIds: readonly string[];
  readonly falsePromotionIds: readonly string[];
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

export const evaluateMemoryAdmissionHoldout = (
  samples: readonly MemoryAdmissionHoldoutSample[],
  policy: MemoryAdmissionPolicy = defaultMemoryAdmissionPolicy,
): Result<MemoryAdmissionEvaluation, DomainError> => {
  if (samples.length === 0) return err(domainError('INVALID_MEMORY', 'memory_holdout', 'holdout must not be empty'));
  const ids = new Set<string>();
  for (const sample of samples) {
    if (sample.id.trim().length === 0 || sample.category.trim().length === 0 || sample.text.trim().length === 0) {
      return err(domainError('INVALID_MEMORY', 'memory_holdout', 'holdout samples require id, category and text'));
    }
    if (ids.has(sample.id)) return err(domainError('INVALID_MEMORY', 'memory_holdout', 'holdout sample ids must be unique'));
    ids.add(sample.id);
  }

  const expectedProject = samples.filter((sample) => sample.expected === 'project');
  const expectedArchiveOnly = samples.filter((sample) => sample.expected === 'archive_only');
  const criticalProject = expectedProject.filter((sample) => sample.critical);
  if (expectedProject.length === 0 || expectedArchiveOnly.length === 0 || criticalProject.length === 0) {
    return err(domainError('INVALID_MEMORY', 'memory_holdout', 'holdout must include project, archive-only and critical durable samples'));
  }

  const observed = samples.map((sample) => ({
    sample,
    admission: admitMemoryEpisode({ searchText: sample.text }, policy),
  }));
  const admittedProject = observed.filter(({ admission }) => admission.kind === 'project');
  const trueProject = admittedProject.filter(({ sample }) => sample.expected === 'project');
  const criticalTrueProject = trueProject.filter(({ sample }) => sample.critical);
  const falsePromotions = admittedProject.filter(({ sample }) => sample.expected === 'archive_only');
  const missedDurable = observed.filter(({ sample, admission }) => sample.expected === 'project' && admission.kind !== 'project');
  const totalCharacters = samples.reduce((sum, sample) => sum + sample.text.length, 0);
  const projectedCharacters = admittedProject.reduce((sum, item) => sum + item.sample.text.length, 0);

  return ok({
    total: samples.length,
    expectedProject: expectedProject.length,
    expectedArchiveOnly: expectedArchiveOnly.length,
    projected: admittedProject.length,
    durableRecall: ratio(trueProject.length, expectedProject.length),
    criticalDurableRecall: ratio(criticalTrueProject.length, criticalProject.length),
    falsePromotionRate: ratio(falsePromotions.length, expectedArchiveOnly.length),
    projectionRate: ratio(admittedProject.length, samples.length),
    totalCharacters,
    projectedCharacters,
    projectedCharacterRatio: ratio(projectedCharacters, totalCharacters),
    missedDurableIds: missedDurable.map(({ sample }) => sample.id),
    falsePromotionIds: falsePromotions.map(({ sample }) => sample.id),
  });
};
