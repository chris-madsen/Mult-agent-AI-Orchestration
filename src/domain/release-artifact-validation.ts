const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalFinite = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const stringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => nonEmpty(item));

const verdictFailures = (root: Record<string, unknown>, path: string, failures: string[]): void => {
  const verdict = record(root.verdict);
  if (verdict === undefined || typeof verdict.selectedProvider !== 'string'
    || !boolean(verdict.measurementAccepted) || !boolean(verdict.productionApproved)
    || !nonEmpty(verdict.status) || !stringArray(verdict.failures)) {
    failures.push(`${path}_verdict_invalid`);
    return;
  }
  const approvedStatus = verdict.status === 'PRODUCTION_APPROVED';
  if (approvedStatus !== (verdict.productionApproved === true && verdict.measurementAccepted === true)) {
    failures.push(`${path}_verdict_inconsistent`);
  }
  if (verdict.productionApproved === true && verdict.failures.length > 0) {
    failures.push(`${path}_approved_with_failures`);
  }
};

export const validateReleaseAcceptanceArtifacts = (
  input: {
    readonly embeddingSelection: unknown;
    readonly semanticSelection: unknown;
    readonly retrievalQuality: unknown;
    readonly harborThreeArm: unknown;
  },
  currentCommit: string,
): readonly string[] => {
  const failures: string[] = [];
  const embedding = record(input.embeddingSelection);
  if (embedding === undefined || embedding.schemaVersion !== 1 || embedding.sourceCommit !== currentCommit
    || !sha256(embedding.reportSha256) || !sha256(embedding.policySha256)
    || !nonEmpty(embedding.reportPath) || !nonEmpty(embedding.policyPath)
    || embedding.evidenceStage !== 'frozen_holdout' || !sha256(embedding.datasetSha256) || !nonEmpty(embedding.dataset)) {
    failures.push('embedding_evidence_identity_invalid');
  } else {
    verdictFailures(embedding, 'embedding', failures);
  }

  const semantic = record(input.semanticSelection);
  const semanticVerdict = record(semantic?.verdict);
  const semanticReports = semantic?.reports;
  if (semantic === undefined || semantic.schemaVersion !== 1 || semantic.sourceCommit !== currentCommit
    || !sha256(semantic.policySha256) || !sha256(semantic.fixtureSha256) || !sha256(semantic.oracleSha256)
    || !nonEmpty(semantic.policyPath)
    || !Array.isArray(semanticReports) || semanticReports.length < 2
    || !semanticReports.every((item) => {
      const report = record(item);
      return report !== undefined && nonEmpty(report.path) && sha256(report.sha256);
    })) {
    failures.push('semantic_evidence_identity_invalid');
  } else {
    verdictFailures(semantic, 'semantic', failures);
    if (semanticVerdict?.matchedComparison !== true) failures.push('semantic_comparison_not_matched');
    if (Array.isArray(semantic.providerIds)
      && (!stringArray(semantic.providerIds) || !semantic.providerIds.includes(String(semanticVerdict?.selectedProvider)))) {
      failures.push('semantic_selected_provider_not_in_reports');
    }
  }

  const retrieval = record(input.retrievalQuality);
  const retrievalVerdict = record(retrieval?.verdict);
  const retrievalMetrics = record(retrievalVerdict?.metrics);
  if (retrieval === undefined || retrieval.schemaVersion !== 1 || retrieval.sourceCommit !== currentCommit
    || !sha256(retrieval.holdoutSha256) || !sha256(retrieval.runSha256) || !sha256(retrieval.policySha256)
    || retrievalVerdict === undefined || !nonEmpty(retrievalVerdict.selectedStrategy)
    || !boolean(retrievalVerdict.measurementAccepted) || !stringArray(retrievalVerdict.failures)
    || retrievalMetrics === undefined || retrievalMetrics.holdoutStatus !== 'frozen_holdout'
    || !nonNegativeInteger(retrievalMetrics.cases) || retrievalMetrics.cases < 1
    || !optionalFinite(retrievalMetrics.recallAt1) || !optionalFinite(retrievalMetrics.recallAt3)
    || !optionalFinite(retrievalMetrics.recallAt5) || !optionalFinite(retrievalMetrics.mrr)
    || !optionalFinite(retrievalMetrics.ndcgAt5)) {
    failures.push('retrieval_evidence_identity_invalid');
  } else {
    if (retrievalMetrics.strategy !== retrievalVerdict.selectedStrategy) failures.push('retrieval_strategy_inconsistent');
    if (retrievalVerdict.measurementAccepted === true && retrievalVerdict.failures.length > 0) {
      failures.push('retrieval_approved_with_failures');
    }
  }

  const harbor = record(input.harborThreeArm);
  const harborOutcome = record(harbor?.outcome);
  const executionIdentity = record(harbor?.execution_identity);
  const sourceReports = record(harbor?.source_reports);
  const productionAcceptance = harborOutcome?.productionAcceptance;
  if (harbor === undefined || harbor.schemaVersion !== 1 || harbor.sourceCommit !== currentCommit
    || harborOutcome === undefined
    || !['rejected', 'diagnostic-only', 'measured-not-necessarily-5x'].includes(String(productionAcceptance))
    || !['not_observed', 'observed_partial_only', 'observed_complete'].includes(String(harborOutcome.naturalUse))
    || harborOutcome.forcedArm !== 'diagnostic-only'
    || !boolean(harborOutcome.naturalQualityNonInferior)
    || !boolean(harborOutcome.naturalProviderCorrelationVerified)
    || !boolean(harborOutcome.costTelemetryComplete)
    || !nonNegativeInteger(harborOutcome.nativeTrials) || !nonNegativeInteger(harborOutcome.naturalTrials)
    || !nonNegativeInteger(harborOutcome.forcedTrials)
    || !optionalFinite(harborOutcome.naturalRawTokenRatioAceOverNative)
    || !optionalFinite(harborOutcome.forcedRawTokenRatioAceOverNative)
    || executionIdentity === undefined || !sha256(executionIdentity.native_job_sha256)
    || !sha256(executionIdentity.natural_job_sha256) || !sha256(executionIdentity.forced_job_sha256)
    || !sha256(executionIdentity.design_fingerprint) || !stringArray(executionIdentity.task_paths)
    || sourceReports === undefined || !sha256(sourceReports.natural_sha256) || !sha256(sourceReports.forced_sha256)) {
    failures.push('harbor_evidence_identity_invalid');
  } else if (productionAcceptance === 'measured-not-necessarily-5x'
    && (harborOutcome.naturalUse !== 'observed_complete'
      || harborOutcome.naturalQualityNonInferior !== true
      || harborOutcome.naturalProviderCorrelationVerified !== true
      || harborOutcome.costTelemetryComplete !== true)) {
    failures.push('harbor_verdict_inconsistent');
  }
  return failures;
};
