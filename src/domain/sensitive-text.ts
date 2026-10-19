const patterns: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/iu,
];

/**
 * Conservative outbound-query guard. It is intentionally biased toward
 * fail-closed false positives: project-document retrieval can be retried with
 * a redacted query, while leaked credentials cannot be recalled.
 */
export const containsLikelySecret = (text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));
