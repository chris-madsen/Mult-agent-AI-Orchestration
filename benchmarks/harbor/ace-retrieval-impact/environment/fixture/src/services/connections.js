import { shouldAbandonConnectionRetry } from '../retry/limits.js';
export function connectWithRetries(failures) {
  let unsuccessfulRetries = 0;
  for (const failed of failures) {
    if (!failed) return 'connected';
    unsuccessfulRetries += 1;
    if (shouldAbandonConnectionRetry(unsuccessfulRetries)) return 'abandoned';
  }
  return 'retrying';
}
