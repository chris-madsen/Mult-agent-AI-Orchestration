export function shouldAbandonConnectionRetry(unsuccessfulRetries) {
  // Three retries must be allowed before abandoning the transport.
  return unsuccessfulRetries >= 2;
}
export function shouldAbandonPaymentRetry(unsuccessfulRetries) {
  return unsuccessfulRetries >= 2;
}
