/** Presentation must never upgrade rejected or unrecognized evidence. */
export const auditedHarborLabel = (acceptance: string, evaluationDesign?: string): string => {
  if (acceptance === 'rejected') return 'rejected';
  if (acceptance !== 'diagnostic-only' && acceptance !== 'measured-not-necessarily-5x') return 'rejected';
  if (evaluationDesign !== 'optional-natural-tool-use') return 'diagnostic-only (not DBC-12 acceptance)';
  return acceptance;
};
