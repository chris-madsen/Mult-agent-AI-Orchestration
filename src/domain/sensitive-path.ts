const privateKeyNames = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

const sensitiveBasenames = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
]);

const sensitiveDirectories = new Set([
  '.git',
  '.ssh',
  'secrets',
  '.secrets',
  'credentials',
  '.credentials',
]);

const credentialDocument = /^(?:service[-_.]?account(?:[-_.].*)?|credentials?)(?:\.json|\.ya?ml|\.toml)$/iu;

export const isSensitiveSourcePath = (repoPath: string): boolean => {
  const normalized = repoPath.replaceAll('\\', '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.some((part) => sensitiveDirectories.has(part.toLocaleLowerCase()))) return true;
  const basename = parts.at(-1)?.toLocaleLowerCase() ?? '';
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (sensitiveBasenames.has(basename) || privateKeyNames.has(basename)) return true;
  if (basename.endsWith('.secret')
    || basename.endsWith('.pem')
    || basename.endsWith('.key')
    || basename.endsWith('.p12')
    || basename.endsWith('.pfx')) return true;
  return credentialDocument.test(basename);
};
