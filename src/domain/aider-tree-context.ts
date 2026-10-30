/**
 * Licensed narrow port of Aider-AI/grep-ast TreeContext.close_small_gaps()
 * and TreeContext.format(), plus Aider RepoMap.to_tree grouping:
 * https://github.com/Aider-AI/grep-ast/blob/main/grep_ast/grep_ast.py
 * https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py
 * Apache-2.0; notices in third_party/licenses.
 *
 * The NAPI parser emits actual AST scope ranges during its existing
 * structural def/ref traversal. CLI-only files retain declaration-range
 * fallback, without a second grammar parse. Full TreeContext header
 * truncation/child-context modes are intentionally not claimed here.
 */
export interface VerifiedScope {
  readonly startLine: number;
  readonly endLine: number;
}

export const renderAiderTreeContext = (
  source: string,
  scopes: readonly VerifiedScope[],
  linesOfInterest: readonly number[],
): string => {
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  const numLines = lines.length;
  const showing = new Set<number>();
  for (const line of linesOfInterest) {
    const index = line - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= numLines) continue;
    showing.add(index);
    // grep-ast TreeContext.add_parent_scopes() selects ancestor headers.
    // Source scopes are captured from the exact same NAPI AST traversal.
    for (const scope of scopes) {
      if (scope.startLine > 1 && scope.startLine <= line && line <= scope.endLine) {
        showing.add(scope.startLine - 1);
      }
    }
  }
  if (showing.size === 0) return '';

  // Direct translation of TreeContext.close_small_gaps().
  const closed = new Set(showing);
  const ordered = [...showing].sort((a, b) => a - b);
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    if (ordered[i + 1]! - ordered[i]! === 2) closed.add(ordered[i]! + 1);
  }
  for (const index of [...closed]) {
    if (index >= numLines - 1) continue;
    if (lines[index]?.trim() && !lines[index + 1]?.trim()) closed.add(index + 1);
  }
  // Direct translation of TreeContext.format() for Aider's plain output
  // (no colors, line numbers, marks, padding, or child context).
  let output = '';
  let dots = !closed.has(0);
  for (const [index, line] of lines.entries()) {
    if (!closed.has(index)) {
      if (dots) {
        output += '⋮\n';
        dots = false;
      }
      continue;
    }
    output += '│' + line + '\n';
    dots = true;
  }
  return output;
};
