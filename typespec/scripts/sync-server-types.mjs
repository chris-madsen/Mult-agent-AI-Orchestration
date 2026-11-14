import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No custom DTO generator: track a byte-for-byte copy of the maintained
// Hey API OpenAPI→TS generated boundary types for the ACE server compile.
// Generation/diff checks verify both outputs against TypeSpec on every change.
const dir = dirname(fileURLToPath(import.meta.url));
const from = resolve(dir, '../generated/sdk/types.gen.ts');
const to = resolve(dir, '../../src/generated/ace-gateway/v1/types.gen.ts');
mkdirSync(dirname(to), { recursive: true });
writeFileSync(to, readFileSync(from));
