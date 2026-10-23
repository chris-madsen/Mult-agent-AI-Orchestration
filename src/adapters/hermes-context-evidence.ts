import { readFile } from 'node:fs/promises';
import { validateHermesContextEvidence, type HermesContextEvidence } from '../domain/hermes-context-evidence.js';

export const readHermesContextEvidenceJsonl = async (
  path: string,
): Promise<readonly HermesContextEvidence[]> => {
  const evidence: HermesContextEvidence[] = [];
  for (const [index, line] of (await readFile(path, 'utf8')).split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`BLOCKED: malformed Hermes context evidence at ${path}:${index + 1}`);
    }
    const checked = validateHermesContextEvidence(value);
    if (checked._tag === 'Err') {
      throw new Error(`BLOCKED: ${path}:${index + 1}: ${checked.error.path}: ${checked.error.message}`);
    }
    evidence.push(checked.value);
  }
  return evidence;
};
