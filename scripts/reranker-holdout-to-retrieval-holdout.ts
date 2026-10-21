import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { RetrievalHoldout } from '../src/domain/retrieval-quality-evaluation.js';
import type { RerankerFixture } from '../src/domain/reranker-evaluation.js';

const [fixtureArg, outputArg] = process.argv.slice(2);
if (fixtureArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/reranker-holdout-to-retrieval-holdout.ts <frozen-reranker-holdout.json> <external-retrieval-holdout.json>');
}
const aceRoot = resolve(process.cwd());
const outputPath = resolve(outputArg);
const outputRelative = relative(aceRoot, outputPath);
if (outputRelative === '' || (!isAbsolute(outputRelative) && !outputRelative.startsWith(`..${sep}`) && outputRelative !== '..')) {
  throw new Error('retrieval holdout output must be outside the ACE checkout');
}
if (existsSync(outputPath)) throw new Error(`refusing to overwrite retrieval holdout ${outputPath}`);

const fixtureBytes = await readFile(resolve(fixtureArg));
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as RerankerFixture;
if (fixture.status !== 'frozen_reranker_holdout' || fixture.repositories === undefined) {
  throw new Error('input must be a frozen reranker holdout with repositories');
}
if (fixture.cases.some((item) => item.repositoryId === undefined || item.documentCandidateIds === undefined)) {
  throw new Error('frozen reranker cases must contain repository and canonical document identities');
}
const holdout: RetrievalHoldout = {
  schemaVersion: 1,
  status: 'frozen_multi_repository_holdout',
  repositories: fixture.repositories,
  cases: fixture.cases.map((item) => ({
    id: item.id,
    repositoryId: item.repositoryId,
    query: item.query,
    relevantCandidateIds: item.relevantDocumentIndexes.map((index) => item.documentCandidateIds?.[index] as string),
    ...(item.critical === undefined ? {} : { critical: item.critical }),
  })),
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const outputBytes = Buffer.from(JSON.stringify(holdout, null, 2) + '\n', 'utf8');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, outputBytes);
await writeFile(`${outputPath}.sha256`, `${sha256(outputBytes)}  ${basename(outputPath)}\n`);
process.stdout.write(JSON.stringify({ output: outputPath, holdoutSha256: sha256(outputBytes), cases: holdout.cases.length }) + '\n');
