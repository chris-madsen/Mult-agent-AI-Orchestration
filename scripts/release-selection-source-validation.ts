import {
  evaluateEmbeddingSelection,
  type EmbeddingComparisonReport,
  type EmbeddingSelectionPolicy,
} from '../src/domain/embedding-selection.js';
import {
  evaluateSemanticProviderSelection,
  type SemanticProviderReport,
  type SemanticSelectionPolicy,
} from '../src/domain/semantic-provider-selection.js';

export interface RetainedJsonEvidence {
  readonly path: string;
  readonly sha256: string;
  readonly value: unknown;
}

export type ReadRetainedJson = (path: string) => Promise<RetainedJsonEvidence>;

export interface SelectionSourceEvidence {
  readonly embedding?: {
    readonly report: { readonly path: string; readonly sha256: string };
    readonly policy: { readonly path: string; readonly sha256: string };
  };
  readonly semantic?: {
    readonly policy: { readonly path: string; readonly sha256: string };
    readonly reports: readonly { readonly path: string; readonly sha256: string }[];
  };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const validateEmbeddingSources = async (
  selection: Record<string, unknown>,
  readJson: ReadRetainedJson,
): Promise<SelectionSourceEvidence['embedding'] | undefined> => {
  const hasReportPath = 'reportPath' in selection;
  const hasPolicyPath = 'policyPath' in selection;
  if (!hasReportPath && !hasPolicyPath) return undefined;
  if (!nonEmpty(selection.reportPath) || !nonEmpty(selection.policyPath)
    || !nonEmpty(selection.reportSha256) || !nonEmpty(selection.policySha256)) {
    throw new Error('embedding selection source identity is incomplete');
  }
  const [report, policy] = await Promise.all([
    readJson(selection.reportPath),
    readJson(selection.policyPath),
  ]);
  if (report.sha256 !== selection.reportSha256 || policy.sha256 !== selection.policySha256) {
    throw new Error('embedding selection source digest mismatch');
  }
  const verdict = evaluateEmbeddingSelection(
    report.value as EmbeddingComparisonReport,
    policy.value as EmbeddingSelectionPolicy,
  );
  if (verdict._tag === 'Err') {
    throw new Error(`embedding selection source evaluator rejected evidence: ${verdict.error.message}`);
  }
  if (!sameJson(verdict.value, selection.verdict)) {
    throw new Error('embedding selection verdict does not match retained source reports');
  }
  return {
    report: { path: report.path, sha256: report.sha256 },
    policy: { path: policy.path, sha256: policy.sha256 },
  };
};

const validateSemanticSources = async (
  selection: Record<string, unknown>,
  readJson: ReadRetainedJson,
): Promise<SelectionSourceEvidence['semantic'] | undefined> => {
  const hasPolicyPath = 'policyPath' in selection;
  const hasReports = 'reports' in selection;
  if (!hasPolicyPath && !hasReports) return undefined;
  if (!nonEmpty(selection.policyPath) || !nonEmpty(selection.policySha256)
    || !Array.isArray(selection.reports) || selection.reports.length < 2) {
    throw new Error('semantic selection source identity is incomplete');
  }
  const reportEntries = selection.reports.map((entry) => {
    const value = record(entry);
    if (value === undefined || !nonEmpty(value.path) || !nonEmpty(value.sha256)) {
      throw new Error('semantic selection report source identity is incomplete');
    }
    return { path: value.path, sha256: value.sha256 };
  });
  const policy = await readJson(selection.policyPath);
  if (policy.sha256 !== selection.policySha256) {
    throw new Error('semantic selection policy digest mismatch');
  }
  const reports = await Promise.all(reportEntries.map((entry) => readJson(entry.path)));
  if (reports.some((report, index) => report.sha256 !== reportEntries[index]?.sha256)) {
    throw new Error('semantic selection source digest mismatch');
  }
  const verdict = evaluateSemanticProviderSelection(
    reports.map((report) => report.value as SemanticProviderReport),
    policy.value as SemanticSelectionPolicy,
  );
  if (verdict._tag === 'Err') {
    throw new Error(`semantic selection source evaluator rejected evidence: ${verdict.error.message}`);
  }
  if (!sameJson(verdict.value, selection.verdict)) {
    throw new Error('semantic selection verdict does not match retained source reports');
  }
  return {
    policy: { path: policy.path, sha256: policy.sha256 },
    reports: reports.map((report) => ({ path: report.path, sha256: report.sha256 })),
  };
};

export const validateReleaseSelectionSources = async (
  embeddingSelection: unknown,
  semanticSelection: unknown,
  readJson: ReadRetainedJson,
): Promise<SelectionSourceEvidence> => {
  const embedding = record(embeddingSelection);
  const semantic = record(semanticSelection);
  const embeddingSources = embedding === undefined ? undefined : await validateEmbeddingSources(embedding, readJson);
  const semanticSources = semantic === undefined ? undefined : await validateSemanticSources(semantic, readJson);
  return {
    ...(embeddingSources === undefined ? {} : { embedding: embeddingSources }),
    ...(semanticSources === undefined ? {} : { semantic: semanticSources }),
  };
};
