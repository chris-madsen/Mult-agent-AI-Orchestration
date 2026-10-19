export function beforeBroken(value: string): string {
  return value.trim();
}

export function broken(value: string): string {
  if (value.length > 0) {
    return value;
// deliberately incomplete frozen syntax fixture
