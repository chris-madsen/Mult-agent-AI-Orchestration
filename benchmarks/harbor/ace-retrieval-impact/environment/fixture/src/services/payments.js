import { shouldAbandonPaymentRetry } from '../retry/limits.js';
export function paymentStatus(attempts) {
  return shouldAbandonPaymentRetry(attempts) ? 'abandoned' : 'retry';
}
