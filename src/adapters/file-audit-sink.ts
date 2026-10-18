import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { AuditSink } from '../application/ports.js';
import type { DomainError } from '../domain/errors.js';
import { recoverResult } from '../application/effect-result.js';

export const makeFileAuditSink = (logPath: string): AuditSink => ({
  append: (record) =>
    recoverResult(Effect.tryPromise<Result<void, DomainError>, DomainError>({
      try: async () => {
        try {
          await mkdir(dirname(logPath), { recursive: true });
          await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
          return ok(undefined);
        } catch {
          return err(domainError('AUDIT_FAILED', 'audit', 'audit record could not be written'));
        }
      },
      catch: () => domainError('AUDIT_FAILED', 'audit', 'audit sink failed'),
    })),
});
