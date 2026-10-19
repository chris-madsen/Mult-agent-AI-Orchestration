export function chooseExternalRoute(request) {
  if (request.kind === 'public-documentation') return 'vertex';
  return request.secretDetected ? 'vertex' : 'local';
}
