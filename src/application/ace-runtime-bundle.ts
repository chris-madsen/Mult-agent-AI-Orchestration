import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requiredAceRuntimeBundlePaths } from '../domain/ace-runtime-bundle.js';

export const missingAceRuntimeBundlePaths = (runtimeRoot: string): readonly string[] =>
  requiredAceRuntimeBundlePaths.filter((path) => !existsSync(join(runtimeRoot, path)));
