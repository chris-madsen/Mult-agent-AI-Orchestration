export function chooseLocalRoute(request) {
  return request.secretDetected ? 'local' : 'local-cache';
}
