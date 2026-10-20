import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const clientImage = 'docker.io/curlimages/curl@sha256:94e9e444bcba979c2ea12e27ae39bee4cd10bc7041a472c4727a558e213744e6';
const requiredIds = ['K3S-01', 'K3S-02', 'K3S-03', 'K3S-04', 'K3S-05', 'K3S-06', 'K3S-07', 'K3S-08', 'K3S-09', 'K3S-10'];
const [rawArg = 'artifacts/k3s-worktree/raw-run.json'] = process.argv.slice(2);
const rawPath = resolve(rawArg);
const artifactDir = resolve(repoRoot, 'artifacts/k3s-worktree');

const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileDigest = async (path) => digest(await readFile(path));
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const command = async (file, args, options = {}) => {
  try {
    const result = await execFileAsync(file, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (cause) {
    return {
      ok: false,
      stdout: typeof cause?.stdout === 'string' ? cause.stdout : '',
      stderr: typeof cause?.stderr === 'string' ? cause.stderr : '',
    };
  }
};

const must = async (file, args, options = {}) => {
  const result = await command(file, args, options);
  if (!result.ok) throw new Error(`${file} ${args.join(' ')} failed`);
  return result;
};

const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const safeResponse = (result) => {
  const body = json(result.stdout);
  if (body === undefined) return { transportOk: result.ok, responseShape: 'invalid' };
  const value = body.value ?? {};
  return {
    transportOk: result.ok,
    ok: body.ok === true,
    ...(body.ok === false && typeof body.error?.code === 'string' ? { errorCode: body.error.code } : {}),
    ...(body.ok === true && typeof value.digest === 'string' ? { digest: value.digest } : {}),
    ...(body.ok === true && Array.isArray(value.snapshot?.files)
      ? { snapshotFiles: value.snapshot.files.length }
      : {}),
  };
};

const workspaceManifest = async (root) => {
  const entries = [];
  const names = (await readdir(root)).filter((name) => name !== '.git').sort();
  for (const name of names) {
    const path = resolve(root, name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      entries.push({ name, kind: 'symlink', target: await readlink(path) });
    } else if (stats.isFile()) {
      entries.push({ name, kind: 'file', sha256: await fileDigest(path), size: stats.size });
    }
  }
  return digest(JSON.stringify(entries));
};

const startHelper = async ({ workspaceId, workspace, tlsDir, port }) => {
  const child = spawn('node', ['dist/bin/ace-worktree-helper.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ACE_WORKTREE_HELPER_WORKSPACES_JSON: JSON.stringify({ [workspaceId]: workspace }),
      ACE_WORKTREE_HELPER_TLS_CERT: resolve(tlsDir, 'server.crt'),
      ACE_WORKTREE_HELPER_TLS_KEY: resolve(tlsDir, 'server.key'),
      ACE_WORKTREE_HELPER_TLS_CA: resolve(tlsDir, 'ca.crt'),
      ACE_WORKTREE_HELPER_HOST: '0.0.0.0',
      ACE_WORKTREE_HELPER_PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (stderr.includes('ready port=')) return child;
    if (child.exitCode !== null) throw new Error('host helper exited before readiness');
    await sleep(100);
  }
  child.kill('SIGTERM');
  throw new Error('host helper readiness timed out');
};

const stopHelper = async (child) => {
  if (child === undefined || child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    child.once('exit', resolveStop);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolveStop();
    }, 2_000).unref();
  });
};

const kubectl = (args) => command('kubectl', args);
const kubectlMust = (args) => must('kubectl', args);

const createClientPod = async ({ pod, secret, yamlPath }) => {
  const yaml = `apiVersion: v1
kind: Pod
metadata:
  name: ${pod}
  namespace: ace
spec:
  restartPolicy: Never
  containers:
  - name: curl
    image: ${clientImage}
    command: ["sleep", "3600"]
    volumeMounts:
    - name: tls
      mountPath: /tls
      readOnly: true
  volumes:
  - name: tls
    secret:
      secretName: ${secret}
`;
  await writeFile(yamlPath, yaml, 'utf8');
  await kubectlMust(['apply', '-f', yamlPath]);
  await kubectlMust(['-n', 'ace', 'wait', '--for=condition=Ready', `pod/${pod}`, '--timeout=120s']);
};

const deletePod = async (pod) => {
  if (pod === undefined) return;
  await kubectl(['-n', 'ace', 'delete', 'pod', pod, '--ignore-not-found', '--wait=true']);
};

const invokeFromPod = async ({ pod, nodeIp, port, workspaceId, operation, repoPath, observedAtMs }) => {
  const payload = JSON.stringify({
    operation,
    workspaceId,
    ...(repoPath === undefined ? {} : { repoPath }),
    ...(observedAtMs === undefined ? {} : { observedAtMs }),
  });
  return command('kubectl', [
    '-n', 'ace', 'exec', pod, '--', 'curl', '--silent', '--show-error',
    '--cacert', '/tls/ca.crt', '--cert', '/tls/client.crt', '--key', '/tls/client.key',
    '--connect-timeout', '5', '--max-time', '30', '--header', 'content-type: application/json',
    '--data', payload, `https://${nodeIp}:${port}/v1/worktree`,
  ]);
};

const invokeWithoutClientCertificate = async ({ pod, nodeIp, port, workspaceId }) => command('kubectl', [
  '-n', 'ace', 'exec', pod, '--', 'curl', '--silent', '--show-error', '--cacert', '/tls/ca.crt',
  '--connect-timeout', '5', '--max-time', '10', '--header', 'content-type: application/json',
  '--data', JSON.stringify({ operation: 'canonicalize', workspaceId }),
  `https://${nodeIp}:${port}/v1/worktree`,
]);

const createArtifact = async ({ id, verdict, observed, limitation, commandText, command: requestedCommand }) => {
  const path = resolve(artifactDir, `${id.toLowerCase()}.json`);
  const content = {
    schemaVersion: 1,
    checkId: id,
    verdict,
    observed,
    ...(limitation === undefined ? {} : { limitation }),
  };
  await writeFile(path, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  return {
    id,
    verdict,
    command: commandText ?? requestedCommand,
    observed,
    artifacts: [{
      path: relative(repoRoot, path).split('\\').join('/'),
      sha256: await fileDigest(path),
      kind: 'safe-k3s-observation',
    }],
    ...(limitation === undefined ? {} : { limitation }),
  };
};

const getVersions = async () => {
  const [server, node] = await Promise.all([
    kubectl(['version', '-o', 'json']),
    kubectl(['get', 'node', '-o', 'json']),
  ]);
  const serverJson = json(server.stdout);
  const nodeJson = json(node.stdout);
  return {
    k3sVersion: serverJson?.serverVersion?.gitVersion ?? 'k3s-version-unavailable',
    nodeVersion: nodeJson?.items?.[0]?.status?.nodeInfo?.kubeletVersion ?? 'node-version-unavailable',
  };
};

const main = async () => {
  await mkdir(artifactDir, { recursive: true });
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'ace-k3s-w11-real-'));
  const workspace = resolve(tempRoot, 'workspace');
  const tlsDir = resolve(tempRoot, 'tls');
  await mkdir(workspace, { recursive: true });
  await mkdir(tlsDir, { recursive: true });
  const workspaceId = `ace-k3s-w11-${randomUUID().slice(0, 8)}`;
  const port = 17_443;
  const sourceCommit = (await must('git', ['rev-parse', 'HEAD'])).stdout.trim().toLowerCase();
  const nodeIp = (await kubectlMust(['get', 'node', '-o', 'jsonpath={.items[0].status.addresses[?(@.type=="InternalIP")].address}'])).stdout.trim();
  const secret = `ace-w11-mtls-${randomUUID().slice(0, 8)}`;
  const pod = `ace-w11-client-${randomUUID().slice(0, 8)}`;
  const unrelatedPod = `ace-w11-unrelated-${randomUUID().slice(0, 8)}`;
  let helper;
  let currentPod;
  let unrelatedReady = false;
  const commandText = 'npm run test:real-k3s-worktree -- artifacts/k3s-worktree/raw-run.json';
  const checks = [];
  try {
    await must('git', ['init', '-q'], { cwd: workspace });
    await must('git', ['config', 'user.email', 'ace-w11@example.invalid'], { cwd: workspace });
    await must('git', ['config', 'user.name', 'ace-w11'], { cwd: workspace });
    await writeFile(resolve(workspace, 'tracked.txt'), 'tracked-v1\n', 'utf8');
    await must('git', ['add', 'tracked.txt'], { cwd: workspace });
    await must('git', ['commit', '-qm', 'initial'], { cwd: workspace });
    await writeFile(resolve(workspace, 'tracked.txt'), 'tracked-v2\n', 'utf8');
    await writeFile(resolve(workspace, 'untracked.txt'), 'untracked-v1\n', 'utf8');
    await writeFile(resolve(workspace, 'race.bin'), Buffer.alloc(8 * 1024 * 1024, 65));
    await (await import('node:fs/promises')).symlink('/etc/passwd', resolve(workspace, 'escape.txt'));

    await must('openssl', ['genrsa', '-out', resolve(tlsDir, 'ca.key'), '2048']);
    await must('openssl', ['req', '-x509', '-new', '-nodes', '-key', resolve(tlsDir, 'ca.key'), '-sha256', '-days', '1', '-out', resolve(tlsDir, 'ca.crt'), '-subj', '/CN=ace-w11-ca']);
    await writeFile(resolve(tlsDir, 'server.ext'), `subjectAltName=IP:${nodeIp}\nextendedKeyUsage=serverAuth\n`, 'utf8');
    await must('openssl', ['genrsa', '-out', resolve(tlsDir, 'server.key'), '2048']);
    await must('openssl', ['req', '-new', '-key', resolve(tlsDir, 'server.key'), '-out', resolve(tlsDir, 'server.csr'), '-subj', '/CN=ace-w11-server']);
    await must('openssl', ['x509', '-req', '-in', resolve(tlsDir, 'server.csr'), '-CA', resolve(tlsDir, 'ca.crt'), '-CAkey', resolve(tlsDir, 'ca.key'), '-CAcreateserial', '-out', resolve(tlsDir, 'server.crt'), '-days', '1', '-sha256', '-extfile', resolve(tlsDir, 'server.ext')]);
    await writeFile(resolve(tlsDir, 'client.ext'), 'extendedKeyUsage=clientAuth\n', 'utf8');
    await must('openssl', ['genrsa', '-out', resolve(tlsDir, 'client.key'), '2048']);
    await must('openssl', ['req', '-new', '-key', resolve(tlsDir, 'client.key'), '-out', resolve(tlsDir, 'client.csr'), '-subj', '/CN=ace-w11-client']);
    await must('openssl', ['x509', '-req', '-in', resolve(tlsDir, 'client.csr'), '-CA', resolve(tlsDir, 'ca.crt'), '-CAkey', resolve(tlsDir, 'ca.key'), '-CAcreateserial', '-out', resolve(tlsDir, 'client.crt'), '-days', '1', '-sha256', '-extfile', resolve(tlsDir, 'client.ext')]);

    const beforeManifest = await workspaceManifest(workspace);
    await kubectlMust(['-n', 'ace', 'create', 'secret', 'generic', secret, '--from-file=ca.crt=' + resolve(tlsDir, 'ca.crt'), '--from-file=client.crt=' + resolve(tlsDir, 'client.crt'), '--from-file=client.key=' + resolve(tlsDir, 'client.key')]);
    currentPod = pod;
    await createClientPod({ pod, secret, yamlPath: resolve(tempRoot, 'client-pod.yaml') });
    helper = await startHelper({ workspaceId, workspace, tlsDir, port });

    const canonical = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'canonicalize' }));
    const snapshot = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'snapshot', observedAtMs: Date.now() }));
    const tracked = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'read_exact', repoPath: 'tracked.txt' }));
    const untracked = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'read_exact', repoPath: 'untracked.txt' }));
    const trackedDigest = await fileDigest(resolve(workspace, 'tracked.txt'));
    const untrackedDigest = await fileDigest(resolve(workspace, 'untracked.txt'));
    checks.push(await createArtifact({
      id: 'K3S-01',
      verdict: canonical.ok && snapshot.ok && snapshot.snapshotFiles >= 3 && tracked.ok && tracked.digest === trackedDigest && untracked.ok && untracked.digest === untrackedDigest ? 'PASS' : 'FAIL',
      observed: [`mTLS canonicalize=${canonical.ok}`, `snapshot_files=${snapshot.snapshotFiles ?? 0}`, `tracked_digest=${tracked.digest ?? 'missing'}`, `untracked_digest=${untracked.digest ?? 'missing'}`],
      limitation: canonical.ok && snapshot.ok && tracked.ok && tracked.digest === trackedDigest && untracked.ok && untracked.digest === untrackedDigest ? undefined : 'pod-to-helper snapshot or exact-read assertion failed',
      command: commandText,
    }));

    const unknown = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId: `${workspaceId}-missing`, operation: 'canonicalize' }));
    checks.push(await createArtifact({ id: 'K3S-02', verdict: unknown.errorCode === 'WORKSPACE_NOT_FOUND' ? 'PASS' : 'FAIL', observed: [`unknown_workspace_error=${unknown.errorCode ?? 'missing'}`], limitation: unknown.errorCode === 'WORKSPACE_NOT_FOUND' ? undefined : 'unknown workspace was not rejected by the host map', command: commandText }));

    const invalidPaths = ['../tracked.txt', '/etc/passwd', 'a\\b', 'a//b', ''];
    const invalidResults = await Promise.all(invalidPaths.map(async (repoPath) => safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'read_exact', repoPath }))));
    const invalidCodes = invalidResults.map((result) => result.errorCode ?? 'missing');
    const invalidPassed = invalidCodes.every((code) => code === 'PATH_ESCAPE' || code === 'INVALID_INPUT');
    checks.push(await createArtifact({ id: 'K3S-03', verdict: invalidPassed ? 'PASS' : 'FAIL', observed: [`path_rejection_codes=${invalidCodes.join(',')}`], limitation: invalidPassed ? undefined : 'one or more invalid paths reached an exact read', command: commandText }));

    const symlink = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'read_exact', repoPath: 'escape.txt' }));
    checks.push(await createArtifact({ id: 'K3S-04', verdict: symlink.errorCode === 'PATH_ESCAPE' ? 'PASS' : 'FAIL', observed: [`symlink_error=${symlink.errorCode ?? 'missing'}`], limitation: symlink.errorCode === 'PATH_ESCAPE' ? undefined : 'symlink escape was not rejected before bytes were returned', command: commandText }));

    const raceFile = resolve(workspace, 'race.bin');
    const raceMutator = spawn(process.execPath, ['-e', "const fs=require('node:fs'); const p=process.argv[1]; const a=Buffer.alloc(8*1024*1024,65); const b=Buffer.alloc(8*1024*1024,66); let i=0; setInterval(()=>fs.writeFileSync(p, i++%2?a:b), 2);", raceFile], { stdio: 'ignore' });
    const raceResults = [];
    for (let index = 0; index < 8; index += 1) {
      raceResults.push(safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'read_exact', repoPath: 'race.bin' })));
    }
    raceMutator.kill('SIGTERM');
    await sleep(100);
    await writeFile(raceFile, Buffer.alloc(8 * 1024 * 1024, 65));
    const raceErrors = raceResults.filter((result) => result.errorCode === 'WORKTREE_RACED' || result.errorCode === 'DIGEST_MISMATCH').length;
    checks.push(await createArtifact({ id: 'K3S-05', verdict: raceErrors > 0 ? 'PASS' : 'NOT_RUN', observed: [`race_errors=${raceErrors}`, `race_attempts=${raceResults.length}`], limitation: raceErrors > 0 ? undefined : 'bounded concurrent writer run did not observe an explicit race result; no false-current claim is made', command: commandText }));

    const invalidCertificate = await invokeWithoutClientCertificate({ pod, nodeIp, port, workspaceId });
    const rejected = !invalidCertificate.ok && /(certificate|required|handshake|alert|reset)/iu.test(invalidCertificate.stderr);
    checks.push(await createArtifact({ id: 'K3S-06', verdict: rejected ? 'PASS' : 'FAIL', observed: [`untrusted_client_rejected=${rejected}`], limitation: rejected ? undefined : 'helper did not expose a TLS rejection for the certificate-less request', command: commandText }));

    const bypass = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId: `${workspaceId}-not-mapped`, operation: 'snapshot', observedAtMs: Date.now() }));
    checks.push(await createArtifact({ id: 'K3S-07', verdict: bypass.errorCode === 'WORKSPACE_NOT_FOUND' ? 'PASS' : 'FAIL', observed: [`mapped_workspace_bypass_error=${bypass.errorCode ?? 'missing'}`], limitation: bypass.errorCode === 'WORKSPACE_NOT_FOUND' ? undefined : 'valid client certificate bypassed the host workspace map', command: commandText }));

    await stopHelper(helper);
    helper = await startHelper({ workspaceId, workspace, tlsDir, port });
    await deletePod(currentPod);
    currentPod = pod;
    await createClientPod({ pod, secret, yamlPath: resolve(tempRoot, 'client-pod-restarted.yaml') });
    const restarted = safeResponse(await invokeFromPod({ pod, nodeIp, port, workspaceId, operation: 'canonicalize' }));
    checks.push(await createArtifact({ id: 'K3S-08', verdict: restarted.ok ? 'PASS' : 'FAIL', observed: [`helper_restart=${restarted.ok}`, 'client_pod_restart=completed'], limitation: restarted.ok ? undefined : 'helper or client pod did not recover', command: commandText }));

    const afterManifest = await workspaceManifest(workspace);
    checks.push(await createArtifact({ id: 'K3S-09', verdict: beforeManifest === afterManifest ? 'PASS' : 'FAIL', observed: [`source_manifest_before=${beforeManifest}`, `source_manifest_after=${afterManifest}`], limitation: beforeManifest === afterManifest ? undefined : 'source manifest changed during acceptance run', command: commandText }));

    const unrelatedYaml = resolve(tempRoot, 'unrelated-pod.yaml');
    await writeFile(unrelatedYaml, `apiVersion: v1\nkind: Pod\nmetadata:\n  name: ${unrelatedPod}\n  namespace: default\nspec:\n  restartPolicy: Never\n  containers:\n  - name: curl\n    image: ${clientImage}\n    command: ["sleep", "3600"]\n`, 'utf8');
    await kubectlMust(['apply', '-f', unrelatedYaml]);
    unrelatedReady = true;
    await kubectlMust(['-n', 'default', 'wait', '--for=condition=Ready', `pod/${unrelatedPod}`, '--timeout=120s']);
    const unrelated = await command('kubectl', ['-n', 'default', 'exec', unrelatedPod, '--', 'curl', '--silent', '--show-error', '--insecure', '--connect-timeout', '5', '--max-time', '10', '--output', '/dev/null', `https://${nodeIp}:${port}/v1/worktree`]);
    const reachedBoundary = unrelated.ok || !/(timed out|could not resolve|no route|network is unreachable|connection refused)/iu.test(unrelated.stderr);
    checks.push(await createArtifact({ id: 'K3S-10', verdict: reachedBoundary ? 'FAIL' : 'PASS', observed: [`unrelated_reachability=${reachedBoundary ? 'reachable_tls_boundary' : 'blocked'}`], limitation: reachedBoundary ? 'environment-specific host firewall/network policy is absent; unrelated workload reached the helper TLS boundary' : undefined, command: commandText }));
  } finally {
    await stopHelper(helper);
    await deletePod(currentPod);
    if (unrelatedReady) await kubectl(['-n', 'default', 'delete', 'pod', unrelatedPod, '--ignore-not-found', '--wait=false']);
    await kubectl(['-n', 'ace', 'delete', 'secret', secret, '--ignore-not-found']);
    await rm(tempRoot, { recursive: true, force: true });
  }

  const versions = await getVersions();
  const raw = {
    schemaVersion: 1,
    sourceCommit,
    generatedAt: new Date().toISOString(),
    environment: {
      ...versions,
      helperVersion: `ace-worktree-helper/${sourceCommit}`,
      workspaceIdHash: digest(workspaceId),
    },
    checks: requiredIds.map((id) => checks.find((check) => check.id === id)).filter(Boolean),
  };
  await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify({ output: rawArg, sourceCommit, verdicts: Object.fromEntries(raw.checks.map((check) => [check.id, check.verdict])) }) + '\n');
};

await main();
