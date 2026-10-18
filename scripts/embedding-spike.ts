import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { makeLocalHashEmbedding } from '../src/adapters/local-hash-embedding.js';

interface LabelCase {
  readonly query: string;
  readonly relevant_candidate: string;
  readonly candidates: Readonly<Record<string, string>>;
}

const cosine = (left: readonly number[], right: readonly number[]): number => left.reduce((sum, value, index) => sum + (value * (right[index] ?? 0)), 0);

const main = async (): Promise<void> => {
  const labels = JSON.parse(await readFile('benchmarks/retrieval/embedding-labels.json', 'utf8')) as readonly LabelCase[];
  const providerResult = makeLocalHashEmbedding({ dimensions: 64 });
  if (providerResult._tag === 'Err') throw new Error(providerResult.error.message);
  const cases = labels.map((label) => {
    const query = providerResult.value.embed(label.query);
    if (query._tag === 'Err') throw new Error(query.error.message);
    const scores = Object.entries(label.candidates).map(([id, text]) => {
      const candidate = providerResult.value.embed(text);
      if (candidate._tag === 'Err') throw new Error(candidate.error.message);
      return { id, score: cosine(query.value, candidate.value) };
    }).sort((left, right) => right.score - left.score);
    return { query: label.query, relevant: label.relevant_candidate, top1: scores[0]?.id, scores };
  });
  const report = {
    provider: providerResult.value.name,
    dimensions: providerResult.value.dimensions,
    labeledCases: cases,
    localTop1Accuracy: cases.filter((item) => item.top1 === item.relevant).length / cases.length,
    cloud: { status: 'blocked', reason: 'no approved project policy or cloud credentials; private code remains local' },
  };
  await mkdir('benchmarks/reports', { recursive: true });
  await writeFile('benchmarks/reports/embedding-spike.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ provider: report.provider, cases: cases.length, localTop1Accuracy: report.localTop1Accuracy, cloud: report.cloud.status })}\n`);
};

await main();
