import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateMemoryAdmissionHoldout,
  type MemoryAdmissionHoldoutSample,
} from '../src/domain/memory-admission-evaluation.js';
import { evaluateMemoryEconomics, type MemoryUsageObservation } from '../src/domain/memory-economics.js';

interface FixtureFile {
  readonly schema_version: number;
  readonly status: string;
  readonly description: string;
  readonly samples: readonly MemoryAdmissionHoldoutSample[];
}

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be a number between 0 and 1`);
  return value;
};

const parseUsage = (): MemoryUsageObservation => {
  const raw = process.env.ACE_MEMORY_USAGE_JSON?.trim();
  if (raw === undefined || raw.length === 0) return { reuseCount: 0 };
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('ACE_MEMORY_USAGE_JSON must be an object');
  const value = parsed as Record<string, unknown>;
  const optionalInteger = (key: string): number | undefined => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
      throw new Error(`ACE_MEMORY_USAGE_JSON.${key} must be a non-negative safe integer`);
    }
    return candidate;
  };
  const reuseCount = optionalInteger('reuseCount') ?? 0;
  return {
    reuseCount,
    ...(optionalInteger('ingestionInputTokens') === undefined ? {} : { ingestionInputTokens: optionalInteger('ingestionInputTokens') as number }),
    ...(optionalInteger('ingestionOutputTokens') === undefined ? {} : { ingestionOutputTokens: optionalInteger('ingestionOutputTokens') as number }),
    ...(optionalInteger('savedAgentTokensPerReuse') === undefined ? {} : { savedAgentTokensPerReuse: optionalInteger('savedAgentTokensPerReuse') as number }),
  };
};

const main = async (): Promise<void> => {
  const fixturePath = resolve(process.argv[2] ?? 'benchmarks/fixtures/memory-admission-holdout-v1.json');
  const parsed: unknown = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('memory admission fixture must be an object');
  const fixture = parsed as Partial<FixtureFile>;
  if (fixture.schema_version !== 1 || !Array.isArray(fixture.samples)) throw new Error('unsupported memory admission fixture schema');

  const evaluation = evaluateMemoryAdmissionHoldout(fixture.samples);
  if (evaluation._tag === 'Err') throw new Error(`${evaluation.error.code}: ${evaluation.error.message}`);
  const economics = evaluateMemoryEconomics(parseUsage());
  if (economics._tag === 'Err') throw new Error(`${economics.error.code}: ${economics.error.message}`);

  const thresholds = {
    minDurableRecall: numberFromEnv('ACE_MEMORY_MIN_DURABLE_RECALL', 0.90),
    minCriticalDurableRecall: numberFromEnv('ACE_MEMORY_MIN_CRITICAL_RECALL', 1.0),
    maxFalsePromotionRate: numberFromEnv('ACE_MEMORY_MAX_FALSE_PROMOTION_RATE', 0.10),
  };
  const passed = evaluation.value.durableRecall >= thresholds.minDurableRecall
    && evaluation.value.criticalDurableRecall >= thresholds.minCriticalDurableRecall
    && evaluation.value.falsePromotionRate <= thresholds.maxFalsePromotionRate;

  process.stdout.write(JSON.stringify({
    fixture: fixturePath,
    schema_version: fixture.schema_version,
    status: fixture.status,
    evaluation: evaluation.value,
    thresholds,
    economics: economics.value,
    token_cost_note: economics.value.status === 'unknown'
      ? 'Graphiti/provider token counters were not supplied; token ROI is unknown and was not inferred from characters.'
      : 'Economics uses only explicitly supplied provider/agent token counters.',
    gate: passed ? 'PASS' : 'FAIL',
  }, null, 2) + '\n');

  if (!passed) process.exitCode = 2;
};

await main();
