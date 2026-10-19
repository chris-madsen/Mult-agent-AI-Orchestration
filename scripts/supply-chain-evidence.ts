import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  evaluateSupplyChainEvidence,
  type ImageProvenanceRecord,
  type LicenseReviewRecord,
} from '../src/domain/supply-chain-evidence.js';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const [sbomArg, provenanceArg, licenseArg, auditOutputArg, evidenceOutputArg] = process.argv.slice(2);
if ([sbomArg, provenanceArg, licenseArg, auditOutputArg, evidenceOutputArg].some((value) => value === undefined)) {
  throw new Error('Usage: tsx scripts/supply-chain-evidence.ts <sbom.json> <image-provenance.json> <license-review.json> <audit-output.json> <evidence-output.json>');
}

const [packageLock, sbomBytes, provenanceBytes, licenseBytes] = await Promise.all([
  readFile('package-lock.json'),
  readFile(resolve(sbomArg as string)),
  readFile(resolve(provenanceArg as string)),
  readFile(resolve(licenseArg as string)),
]);

const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 32 * 1024 * 1024,
});
if (audit.error !== undefined) throw audit.error;
if (audit.stdout.trim().length === 0) {
  throw new Error('npm audit returned no JSON output' + (audit.stderr.trim().length === 0 ? '' : ': ' + audit.stderr.trim().slice(0, 240)));
}
let auditReport: unknown;
try {
  auditReport = JSON.parse(audit.stdout) as unknown;
} catch {
  throw new Error('npm audit output is not valid JSON');
}
await writeFile(resolve(auditOutputArg as string), JSON.stringify(auditReport, null, 2) + '\n', 'utf8');

const git = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (git.status !== 0 || git.stdout.trim().length === 0) throw new Error('could not resolve current Git commit');
const currentCommit = git.stdout.trim().toLowerCase();

const sbom = JSON.parse(sbomBytes.toString('utf8')) as unknown;
const imageProvenance = JSON.parse(provenanceBytes.toString('utf8')) as ImageProvenanceRecord;
const licenseReview = JSON.parse(licenseBytes.toString('utf8')) as LicenseReviewRecord;
const verdict = evaluateSupplyChainEvidence({
  currentCommit,
  packageLockSha256: hash(packageLock),
  sbomSha256: hash(sbomBytes),
  sbom,
  productionAudit: auditReport,
  auditCommand: 'npm audit --omit=dev --json',
  imageProvenance,
  licenseReview,
});
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}

const output = {
  schemaVersion: 1,
  ...(verdict.value.evidence === undefined ? {} : { evidence: verdict.value.evidence }),
  currentCommit,
  inputs: {
    packageLock: { path: 'package-lock.json', sha256: hash(packageLock) },
    sbom: { path: relative(process.cwd(), resolve(sbomArg as string)), sha256: hash(sbomBytes) },
    imageProvenance: { path: relative(process.cwd(), resolve(provenanceArg as string)), sha256: hash(provenanceBytes) },
    licenseReview: { path: relative(process.cwd(), resolve(licenseArg as string)), sha256: hash(licenseBytes) },
    productionAudit: {
      path: relative(process.cwd(), resolve(auditOutputArg as string)),
      sha256: hash(Buffer.from(JSON.stringify(auditReport, null, 2) + '\n', 'utf8')),
      command: 'npm audit --omit=dev --json',
      exitCode: audit.status,
    },
  },
  verdict: verdict.value,
};
await writeFile(resolve(evidenceOutputArg as string), JSON.stringify(output, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: evidenceOutputArg,
  status: verdict.value.status,
  evidence: verdict.value.evidence ?? null,
  failures: verdict.value.failures,
}) + '\n');
if (verdict.value.status !== 'PASS') process.exitCode = 2;
