import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'benchmarks/semantic/provider-comparison-v1');
const output = resolve(process.argv[3] ?? 'benchmarks/reports/serena-semantic-provider-comparison-v1.json');
const rawOutput = resolve(process.argv[4] ?? output.replace(/\.json$/u, '.raw.json'));
const serenaBin = process.env.SERENA_BIN?.trim() || 'serena-agent';

const listFiles = async (directory) => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result.sort();
};

const digestFiles = (files) => {
  const digest = createHash('sha256');
  for (const [path, source] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const bytes = Buffer.from(source, 'utf8');
    digest.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  return digest.digest('hex');
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const p95 = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const markerPosition = (files, marker) => {
  const source = files[marker.file];
  if (source === undefined) throw new Error(`missing fixture file ${marker.file}`);
  let markerOffset = -1;
  for (let index = 0; index < (marker.markerOccurrence ?? 1); index += 1) {
    markerOffset = source.indexOf(marker.marker, markerOffset + 1);
    if (markerOffset < 0) throw new Error(`marker not found for ${marker.file}`);
  }
  let tokenOffset = -1;
  for (let index = 0; index < (marker.tokenOccurrence ?? 1); index += 1) {
    tokenOffset = marker.marker.indexOf(marker.token, tokenOffset + 1);
    if (tokenOffset < 0) throw new Error(`token not found inside marker for ${marker.file}`);
  }
  const absolute = markerOffset + tokenOffset;
  const before = source.slice(0, absolute);
  return {
    line: before.split('\n').length,
    column: absolute - before.lastIndexOf('\n'),
  };
};

const py = (value) => JSON.stringify(value);

const definitionQueries = {
  'same-name-user-definition': ['src/repositories.ts', String.raw`repo\.(save)\(value\)`, 'persistUser'],
  'same-name-audit-definition': ['src/repositories.ts', String.raw`repo\.(save)\(value\)`, 'persistAudit'],
  'derived-override-definition': ['src/services.ts', String.raw`service\.(run)\(value\)`, 'invokeDerived'],
  'base-definition': ['src/services.ts', String.raw`service\.(run)\(value\)`, 'invokeBase'],
  'unicode-definition': ['src/unicode.ts', String.raw`return (сохранить)\(`, 'вызвать'],
  'large-tail-definition': ['src/large.ts', String.raw`return (tailSemanticTarget)\(`, 'callTailSemanticTarget'],
};

const definitionCode = ([file, regex, containing]) => `
import json
result = s.lsp.find_declaration(${py(file)}, ${py(regex)}, containing_symbol_name_path=${py(containing)})
symbol = result.symbol
json.dumps({
    "name": symbol.name,
    "namePath": symbol.get_name_path(),
    "relativePath": symbol.relative_path,
    "line": symbol.line,
    "column": symbol.column,
    "kind": symbol.symbol_kind_name,
})
`;

const referenceCode = (namePath, file) => `
import json
result = s.lsp.find_referencing_symbols(${py(namePath)}, ${py(file)})
json.dumps([
    {
        "name": ref.symbol.name,
        "namePath": ref.symbol.get_name_path(),
        "relativePath": ref.symbol.relative_path,
        "symbolLine": ref.symbol.line,
        "symbolColumn": ref.symbol.column,
        "referenceLine": ref.line,
        "referenceColumn": ref.character,
        "kind": ref.symbol.symbol_kind_name,
    }
    for ref in result.references
])
`;

const diagnosticsCode = (file) => `
import json
result = s.lsp.get_diagnostics_for_file(${py(file)})
data = result.grouped.get_dict()
errors = sum(len(items) for items in data.get(${py(file)}, {}).get("Error", {}).values())
json.dumps({"errorCount": errors, "grouped": data})
`;

const pythonVersionCode = `
import json
import platform
json.dumps({"python": platform.python_version()})
`;

class SerenaMcpClient {
  constructor(child) {
    this.child = child;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.receive(chunk));
  }

  receive(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.pending.forEach(({ reject }) => reject(new Error(`invalid Serena JSON: ${error}`)));
        this.pending.clear();
        return;
      }
      const pending = this.pending.get(message.id);
      if (pending === undefined) continue;
      this.pending.delete(message.id);
      pending.resolve(message);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout waiting for Serena ${method}`));
      }, 180_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async tool(name, argumentsValue) {
    const response = await this.request('tools/call', { name, arguments: argumentsValue });
    if (response.error !== undefined) throw new Error(JSON.stringify(response.error));
    if (response.result?.isError) throw new Error(JSON.stringify(response.result));
    return response.result?.structuredContent?.result
      ?? response.result?.content?.find((item) => item.type === 'text')?.text
      ?? '';
  }
}

const readVmRssBytes = async (pid) => {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);
    return match === null ? 0 : Number(match[1]) * 1024;
  } catch {
    return 0;
  }
};

const files = {};
for (const absolute of await listFiles(join(root, 'src'))) {
  files[relative(root, absolute).split('\\').join('/')] = await readFile(absolute, 'utf8');
}
if (Object.keys(files).length === 0) throw new Error('semantic fixture contains no source files');
const oracleBytes = await readFile(join(root, 'oracle.json'));
const oracle = JSON.parse(oracleBytes.toString('utf8'));
const fixtureSha256 = digestFiles(files);
const oracleSha256 = sha256(oracleBytes);

const started = performance.now();
const child = spawn(serenaBin, [
  'start-mcp-server', '--project', root,
  '--transport', 'stdio', '--agent-interface', 'repl',
  '--enable-web-dashboard', 'false', '--open-web-dashboard', 'false', '--log-level', 'ERROR',
], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] });
const client = new SerenaMcpClient(child);
try {
  const initialize = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'ace-semantic-comparison', version: '1.0' },
  });
  if (initialize.error !== undefined) throw new Error(JSON.stringify(initialize.error));
  client.notify('notifications/initialized', {});
  const instructions = await client.tool('initial_instructions', {});
  const sessionId = /session id is `([^`]+)`/u.exec(instructions)?.[1];
  if (sessionId === undefined) throw new Error('Serena session id missing from initial instructions');

  const repl = async (code) => {
    const value = await client.tool('serena_repl', { session_id: sessionId, code });
    return JSON.parse(value);
  };
  const pythonVersion = await repl(pythonVersionCode);
  await repl(diagnosticsCode('src/repositories.ts'));
  const coldStartMs = Math.max(0, performance.now() - started);

  const runCase = async (item) => {
    const startedCase = performance.now();
    try {
      let observation;
      if (item.operation === 'definition') {
        observation = await repl(definitionCode(definitionQueries[item.id]));
      } else if (item.operation === 'references') {
        const target = item.id === 'alias-source-references'
          ? ['persistRecord', 'src/alias-source.ts']
          : ['updateCounter/count', 'src/writes.ts'];
        observation = await repl(referenceCode(...target));
      } else {
        observation = await repl(diagnosticsCode(item.query.file));
      }
      return { item, observation, durationMs: Math.max(0, performance.now() - startedCase) };
    } catch (error) {
      return { item, error: String(error), durationMs: Math.max(0, performance.now() - startedCase) };
    }
  };

  const firstPass = [];
  const warmPass = [];
  for (const item of oracle.cases) firstPass.push(await runCase(item));
  for (const item of oracle.cases) warmPass.push(await runCase(item));

  const evaluate = (run) => run.map(({ item, observation, error }) => {
    if (error !== undefined) return { caseId: item.id, status: 'error', observation: error };
    if (item.operation === 'definition') {
      const expected = markerPosition(files, item.expected);
      const matched = observation.relativePath === item.expected.file
        && observation.line + 1 === expected.line
        && observation.column + 1 === expected.column;
      return {
        caseId: item.id,
        status: matched ? 'pass' : 'fail',
        observation: `${observation.relativePath}:${observation.line + 1}:${observation.column + 1}`,
      };
    }
    if (item.operation === 'references') {
      const expected = item.expectedReferenceMarkers.map((marker) => ({ file: marker.file, ...markerPosition(files, marker) }));
      const missing = expected.filter((location) => !observation.some((reference) =>
        reference.relativePath === location.file
        && reference.referenceLine + 1 === location.line
        && reference.referenceColumn + 1 === location.column));
      return {
        caseId: item.id,
        status: missing.length === 0 ? 'pass' : 'fail',
        observation: missing.length === 0
          ? `references=${observation.length}`
          : `missing=${missing.map((value) => `${value.file}:${value.line}:${value.column}`).join(',')};observed=${observation.length}`,
      };
    }
    const errorCount = Number(observation.errorCount ?? 0);
    return {
      caseId: item.id,
      status: errorCount >= item.expected.minErrors ? 'pass' : 'fail',
      observation: `errors=${errorCount}`,
    };
  });

  const caseResults = evaluate(warmPass);
  const failed = caseResults.filter((item) => item.status !== 'pass');
  const report = {
    schemaVersion: 1,
    status: failed.length === 0 ? 'provider-pass' : 'partial-provider-comparison',
    fixture: relative(process.cwd(), root).split('\\').join('/'),
    provider: 'serena',
    providerVersion: `serena-agent/${execFileSync(serenaBin, ['--version'], { encoding: 'utf8' }).trim().replace(/^Serena\s+/u, '')}`,
    fixtureSha256,
    oracleSha256,
    firstPassQueryP95Ms: p95(firstPass.map((item) => item.durationMs)),
    caseResults,
    coldStartMs,
    warmQueryP95Ms: p95(warmPass.map((item) => item.durationMs)),
    maxRssBytes: await readVmRssBytes(child.pid),
    runtime: { node: process.version, python: pythonVersion.python, adapter: 'serena-agent-mcp-repl/lsp/v1' },
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    command: `node scripts/serena-semantic-comparison.mjs ${relative(process.cwd(), root)} ${relative(process.cwd(), output)}`,
    rawEvidence: relative(process.cwd(), rawOutput).split('\\').join('/'),
  };
  const raw = {
    schemaVersion: 1,
    provider: report.provider,
    providerVersion: report.providerVersion,
    fixtureSha256,
    oracleSha256,
    sourceCommit: report.sourceCommit,
    firstPass,
    warmPass,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await writeFile(rawOutput, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    output: relative(process.cwd(), output).split('\\').join('/'),
    rawOutput: relative(process.cwd(), rawOutput).split('\\').join('/'),
    fixtureSha256,
    oracleSha256,
    cases: caseResults.length,
    failures: failed.map((item) => item.caseId),
    coldStartMs,
    warmQueryP95Ms: report.warmQueryP95Ms,
  }) + '\n');
  if (failed.length > 0) process.exitCode = 2;
} finally {
  child.kill('SIGTERM');
}
