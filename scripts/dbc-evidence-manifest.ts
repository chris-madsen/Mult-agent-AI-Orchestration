import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  dbcAcceptanceSummary,
  makeDbcEvidenceManifest,
  type DbcEvidenceRecord,
  type DbcId,
  type DbcVerdict,
} from '../src/domain/dbc-evidence.js';

interface DraftArtifact {
  readonly path: string;
  readonly kind: string;
}

interface DraftRecord {
  readonly dbcId: DbcId;
  readonly verdict: DbcVerdict;
  readonly fixturePath?: string;
  readonly command?: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly credentialScope: string;
  readonly requestIds?: readonly string[];
  readonly artifacts?: readonly DraftArtifact[];
  readonly observed?: readonly string[];
  readonly limitation?: string;
}

interface DraftManifest {
  readonly records: readonly DraftRecord[];
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const containedPath = (path: string): string => {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.length === 0) {
    throw new Error(`evidence path must be a contained repository-relative file: ${path}`);
  }
  return rel.split('\\').join('/');
};

const main = async (): Promise<void> => {
  const [draftPath, outputPath] = process.argv.slice(2);
  if (draftPath === undefined || outputPath === undefined) {
    throw new Error('Usage: tsx scripts/dbc-evidence-manifest.ts <draft.json> <output.json>');
  }
  const draft = JSON.parse(await readFile(resolve(draftPath), 'utf8')) as DraftManifest;
  if (!Array.isArray(draft.records)) throw new Error('draft.records must be an array');

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  const records: DbcEvidenceRecord[] = [];
  for (const draftRecord of draft.records) {
    let fixtureSha256: string | undefined;
    if (draftRecord.fixturePath !== undefined) {
      const path = containedPath(draftRecord.fixturePath);
      fixtureSha256 = sha256(await readFile(path));
    }
    const artifacts = await Promise.all((draftRecord.artifacts ?? []).map(async (artifact) => {
      const path = containedPath(artifact.path);
      return {
        path,
        kind: artifact.kind,
        sha256: sha256(await readFile(path)),
      };
    }));
    records.push({
      dbcId: draftRecord.dbcId,
      verdict: draftRecord.verdict,
      sourceCommit,
      ...(fixtureSha256 === undefined ? {} : { fixtureSha256 }),
      ...(draftRecord.command === undefined ? {} : { command: draftRecord.command }),
      toolVersions: draftRecord.toolVersions,
      credentialScope: draftRecord.credentialScope,
      requestIds: draftRecord.requestIds ?? [],
      artifacts,
      observed: draftRecord.observed ?? [],
      ...(draftRecord.limitation === undefined ? {} : { limitation: draftRecord.limitation }),
    });
  }

  const manifest = makeDbcEvidenceManifest(records, new Date().toISOString());
  if (manifest._tag === 'Err') {
    throw new Error(`${manifest.error.code}: ${manifest.error.path}: ${manifest.error.message}`);
  }
  const summary = dbcAcceptanceSummary(manifest.value);
  await writeFile(resolve(outputPath), JSON.stringify({ ...manifest.value, summary }, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ output: outputPath, sourceCommit, ...summary }) + '\n');
  if (process.env.ACE_REQUIRE_ALL_DBC_PASS === 'true' && !summary.allPassed) process.exitCode = 2;
};

await main();
