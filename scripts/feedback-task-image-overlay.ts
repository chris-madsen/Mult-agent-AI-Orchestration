import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface PinnedTaskImageOverlay {
  readonly taskPath: string;
  readonly sourceTaskTomlSha256: string;
  readonly effectiveTaskTomlSha256: string;
  readonly image: string;
}

/**
 * Harbor reads docker_image from [environment] in task.toml. Inspecting a
 * local image does NOT select it for a Harbor trial. Stage a derivative,
 * digest-pinned task outside the authoritative checkout instead of editing
 * any original benchmark task files.
 */
export const stagePinnedTaskImageOverlay = async (
  source: string,
  target: string,
  reference: string,
  digest: string,
  pinnedImageReference: string = `${reference}@${digest}`,
): Promise<PinnedTaskImageOverlay> => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u.test(reference) || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error('BLOCKED: pinned task image reference or digest is invalid');
  }
  if (pinnedImageReference !== `${reference}@${digest}` && pinnedImageReference !== digest) {
    throw new Error('BLOCKED: runtime image locator does not match its verified immutable digest');
  }
  if (existsSync(target)) throw new Error('BLOCKED: runtime task overlay already exists');
  const sourceToml = await readFile(join(source, 'task.toml'));
  const lines = sourceToml.toString('utf8').split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\[environment\]\s*$/u.test(line));
  if (start < 0) throw new Error('BLOCKED: task lacks [environment] for pinned image selection');
  const endOffset = lines.slice(start + 1).findIndex((line) => /^\s*\[/u.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  const before = lines.slice(0, start + 1);
  const inside = lines.slice(start + 1, end)
    .filter((line) => !/^\s*docker_image\s*=/u.test(line));
  const after = lines.slice(end);
  const effectiveToml = [...before, `docker_image = "${pinnedImageReference}"`, ...inside, ...after].join('\n');
  await mkdir(join(target, '..'), { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true, dereference: false });
  // An existing Dockerfile would otherwise permit fallback to a build path.
  const dockerfile = join(target, 'environment', 'Dockerfile');
  if (existsSync(dockerfile)) await rm(dockerfile);
  await writeFile(join(target, 'task.toml'), effectiveToml, 'utf8');
  return {
    taskPath: target,
    sourceTaskTomlSha256: sha256(sourceToml),
    effectiveTaskTomlSha256: sha256(Buffer.from(effectiveToml, 'utf8')),
    image: pinnedImageReference,
  };
};
