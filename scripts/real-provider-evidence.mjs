import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const stopAndRetainProviderTraces = async (providers, outputDirectory) => {
  await Promise.all(providers.map(async (provider) => provider.stop?.()));
  if (outputDirectory !== undefined) await mkdir(outputDirectory, { recursive: true });

  const digests = {};
  for (const provider of providers) {
    if (!/^[a-z0-9-]+$/u.test(provider.label)) {
      throw new Error(`invalid provider trace label: ${provider.label}`);
    }
    try {
      const bytes = await readFile(provider.traceFile);
      digests[provider.label] = createHash('sha256').update(bytes).digest('hex');
      if (outputDirectory !== undefined) {
        await copyFile(provider.traceFile, join(outputDirectory, `${provider.label}-provider-trace.jsonl`));
      }
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
      digests[provider.label] = undefined;
    }
  }
  return digests;
};
