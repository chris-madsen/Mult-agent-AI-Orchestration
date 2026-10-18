import { createHash } from 'node:crypto';
import {
  comparisonEvidenceSource,
  evaluationSuiteFingerprintSource,
  freezeEvaluationSuite,
  makeComparisonReport,
  type ComparisonReportInput,
  type EvaluationSuite,
  type ComparisonReport,
} from '../domain/evaluation.js';
import type { DomainError } from '../domain/errors.js';
import type { Result } from '../domain/result.js';

export const sha256Text = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export const freezeSuiteWithSha256 = (suite: EvaluationSuite) =>
  freezeEvaluationSuite(suite, sha256Text(evaluationSuiteFingerprintSource(suite)));

export const makeComparisonReportWithSha256 = (
  input: Omit<ComparisonReportInput, 'evidenceHash'>,
): Result<ComparisonReport, DomainError> => {
  const provisional = makeComparisonReport({ ...input, evidenceHash: '0'.repeat(64) });
  if (provisional._tag === 'Err') return provisional;
  return makeComparisonReport({
    ...input,
    evidenceHash: sha256Text(comparisonEvidenceSource(provisional.value)),
  });
};
