export function permitExternal(request) {
  return request.secretDetected || request.kind === 'public-documentation';
}
