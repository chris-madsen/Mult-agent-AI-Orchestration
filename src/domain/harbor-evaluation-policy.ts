/**
 * DBC-12 is a claim about naturally useful, attributable retrieval—not merely
 * correct arithmetic or a forced MCP invocation.
 */
export interface HarborAcceptanceEvidence {
  readonly paired: boolean;
  readonly qualityNonInferior: boolean;
  readonly actualAceCallObserved: boolean;
  readonly codeEvidenceObserved: boolean;
  readonly providerOperationsObserved: boolean;
  readonly forcedToolUse: boolean;
  readonly providerRequestCorrelationVerified: boolean;
  readonly completeCostTelemetry: boolean;
}

export type HarborAcceptance = 'rejected' | 'diagnostic-only' | 'measured-not-necessarily-5x';

export const assessHarborAcceptance = (evidence: HarborAcceptanceEvidence): HarborAcceptance => {
  if (!evidence.paired || !evidence.qualityNonInferior || !evidence.actualAceCallObserved
    || !evidence.codeEvidenceObserved || !evidence.providerOperationsObserved) return 'rejected';
  if (evidence.forcedToolUse || !evidence.providerRequestCorrelationVerified || !evidence.completeCostTelemetry) {
    return 'diagnostic-only';
  }
  return 'measured-not-necessarily-5x';
};
