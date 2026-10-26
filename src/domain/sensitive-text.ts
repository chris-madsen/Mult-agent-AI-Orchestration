const patterns: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/u,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat)_[A-Za-z0-9_-]{16,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9_-]{16,}\b/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret|aws_secret_access_key|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/iu,
  /\b(?:authorization\s*:\s*)?bearer\s+[A-Za-z0-9_.-]{20,}\b/iu,
];

/**
 * Conservative outbound-query guard. It is intentionally biased toward
 * fail-closed false positives: project-document retrieval can be retried with
 * a redacted query, while leaked credentials cannot be recalled.
 */
export const containsLikelySecret = (text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));
