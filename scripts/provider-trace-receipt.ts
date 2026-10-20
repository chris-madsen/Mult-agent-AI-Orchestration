import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  evaluateProviderTraceReceipt,
} from '../src/domain/provider-trace-receipt.js';
import type { SourceCoverage } from '../src/domain/source-coverage.js';

const containedPath = (input: string): string => {
  const absolute = resolve(input);
  const rel = relative(process.cwd(), absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.length === 0) {
    throw new Error(`trace receipt path must be repository-contained: ${input}`);
  }
  return rel.split('\\').join('/');
};

const [bundleArg, traceArg, outputArg] = process.argv.slice(2);
if (bundleArg === undefined || traceArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/provider-trace-receipt.ts <context-bundle.json> <provider-trace.jsonl> <output.json>');
}

const bundlePath = containedPath(bundleArg);
const tracePath = containedPath(traceArg);
const [bundleBytes, traceBytes] = await Promise.all([
  readFile(bundlePath),
  readFile(tracePath),
]);

const bundleRaw = JSON.parse(bundleBytes.toString('utf8')) as unknown;
if (typeof bundleRaw !== 'object' || bundleRaw === null || Array.isArray(bundleRaw)) {
  throw new Error('ContextBundle evidence input must be an object');
}
const bundle = bundleRaw as Record<string, unknown>;
if (typeof bundle.requestId !== 'string' || !Array.isArray(bundle.sourceCoverage)) {
  throw new Error('ContextBundle evidence input requires requestId and sourceCoverage');
}

const events: unknown[] = [];
for (const [index, line] of traceBytes.toString('utf8').split('\n').entries()) {
  if (line.trim().length === 0) continue;
  try {
    events.push(JSON.parse(line) as unknown);
  } catch {
    throw new Error(`provider trace line ${index + 1} is invalid JSON`);
  }
}

const receipt = evaluateProviderTraceReceipt(
  bundle.requestId,
  bundle.sourceCoverage as SourceCoverage[],
  events,
);
if (receipt._tag === 'Err') {
  throw new Error(`${receipt.error.code}: ${receipt.error.path}: ${receipt.error.message}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  bundle: {
    path: bundlePath,
    sha256: createHash('sha256').update(bundleBytes).digest('hex'),
  },
  trace: {
    path: tracePath,
    sha256: createHash('sha256').update(traceBytes).digest('hex'),
  },
  receipt: receipt.value,
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputArg,
  requestId: receipt.value.requestId,
  receipt: receipt.value.receipt,
  failures: receipt.value.failures,
}) + '\n');

if (process.env.ACE_REQUIRE_TRACE_RECEIPT_COMPLETE === 'true'
  && receipt.value.receipt !== 'provider-trace-complete') {
  process.exitCode = 2;
}
