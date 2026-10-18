import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Harbor result gate: never infer causal savings from zero ACE calls. Invoke with
 * two real Harbor job directories and a report path after paired runs complete. */
interface Trial {
  readonly agent_result?: { readonly n_input_tokens?: number; readonly n_output_tokens?: number; readonly n_cache_tokens?: number; readonly cost_usd?: number };
  readonly verifier_result?: { readonly rewards?: { readonly reward?: number } };
  readonly exception_info?: unknown;
}
interface Stats {
  readonly count: number;
  readonly successes: number;
  readonly tokens: number;
  readonly costs: number;
  readonly aceCalls: number;
  readonly evidenceSha: string;
}
const fromJob = async (directory: string): Promise<Stats> => {
  const dirs = (await readdir(directory, { withFileTypes: true })).filter((x) => x.isDirectory());
  if (dirs.length === 0) throw new Error('No real Harbor trial directories in ' + directory);
  let successes = 0;
  let tokens = 0;
  let costs = 0;
  let aceCalls = 0;
  const fingerprints: string[] = [];
  for (const dir of dirs) {
    const base = join(directory, dir.name);
    const original = await readFile(join(base, 'result.json'), 'utf8');
    const trial = JSON.parse(original) as Trial;
    fingerprints.push(createHash('sha256').update(original).digest('hex'));
    const reward = trial.verifier_result?.rewards?.reward;
    if (trial.exception_info === undefined || trial.exception_info === null) {
      if (reward === 1) successes += 1;
    }
    const usage = trial.agent_result;
    if (typeof usage?.n_input_tokens !== 'number' || typeof usage.n_output_tokens !== 'number') {
      throw new Error('Harbor trial missing native token usage: ' + base);
    }
    tokens += usage.n_input_tokens + usage.n_output_tokens;
    costs += usage.cost_usd ?? 0;
    let log = '';
    try { log = await readFile(join(base, 'agent', 'codex.txt'), 'utf8'); } catch { throw new Error('Missing Codex agent trace: ' + base); }
    for (const line of log.split('\n')) {
      try {
        const event = JSON.parse(line) as { item?: { type?: string; server?: string; tool?: string; error?: unknown } };
        const item = event.item;
        if (item?.type === 'mcp_tool_call' && item.server === 'ace' && item.tool === 'ace_context' && !item.error) aceCalls += 1;
      } catch { /* Preserve raw traces; Codex may emit non-JSON diagnostics. */ }
    }
  }
  return {
    count: dirs.length, successes, tokens, costs, aceCalls,
    evidenceSha: createHash('sha256').update(fingerprints.sort().join(':')).digest('hex'),
  };
};

const [native, ace, report] = process.argv.slice(2);
if (!native || !ace || !report) throw new Error('Usage: tsx scripts/harbor-retrieval-gate.ts <native-job-dir> <ace-job-dir> <report.json>');
const a = await fromJob(native);
const b = await fromJob(ace);
const quality = a.successes / a.count <= b.successes / b.count;
const paired = a.count === b.count && a.count >= 3;
const attributed = b.aceCalls > 0 && a.aceCalls === 0;
const ratio = b.tokens === 0 ? 0 : a.tokens / b.tokens;
const result = {
  evidence: 'real-harbor-trials', native: a, ace: b, paired, qualityNonInferior: quality,
  aceInvocationsObserved: attributed,
  measuredTokenRatio: ratio,
  target5xReached: paired && quality && attributed && ratio >= 5,
  acceptance: paired && quality && attributed ? 'measured-not-necessarily-5x' : 'rejected',
};
await writeFile(report, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
if (result.acceptance === 'rejected') process.exitCode = 2;
