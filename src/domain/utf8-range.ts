export interface Utf8ByteRange {
  readonly startLine: number;
  readonly endLine: number;
  /** One-based UTF-8 byte columns; endColumn is exclusive. */
  readonly startColumn?: number;
  readonly endColumn?: number;
}

interface LineBounds {
  readonly start: number;
  /** Exclusive content end; CR/LF terminators are not part of the line. */
  readonly end: number;
}

const validPoint = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 1;

const lineBounds = (bytes: Uint8Array, line: number): LineBounds | undefined => {
  if (!Number.isSafeInteger(line) || line < 1) return undefined;
  let currentLine = 1;
  let start = 0;
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] !== 0x0a) continue;
    const end = offset > start && bytes[offset - 1] === 0x0d ? offset - 1 : offset;
    if (currentLine === line) return { start, end };
    currentLine += 1;
    start = offset + 1;
  }
  return currentLine === line
    ? { start, end: bytes.length > start && bytes[bytes.length - 1] === 0x0d ? bytes.length - 1 : bytes.length }
    : undefined;
};

/** Resolve a validated one-based UTF-8 byte range against authoritative bytes. */
export const exactUtf8ByteRange = (
  bytes: Uint8Array,
  range: Utf8ByteRange,
): { readonly offset: number; readonly length: number } | undefined => {
  if (range.startLine > range.endLine || !validPoint(range.startColumn) || !validPoint(range.endColumn)) return undefined;
  const startLine = lineBounds(bytes, range.startLine);
  const endLine = lineBounds(bytes, range.endLine);
  if (startLine === undefined || endLine === undefined) return undefined;
  const from = startLine.start + (range.startColumn - 1);
  const until = endLine.start + (range.endColumn - 1);
  if (from < startLine.start || from >= startLine.end || until < endLine.start || until > endLine.end || until <= from) {
    return undefined;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(from, until));
  } catch {
    return undefined;
  }
  return { offset: from, length: until - from };
};

/** Convert a UTF-8 byte column to the one-based UTF-16 column expected by LSP. */
export const utf16ColumnAtUtf8Byte = (
  bytes: Uint8Array,
  line: number,
  byteColumn: number,
): number | undefined => {
  if (!validPoint(byteColumn)) return undefined;
  const bounds = lineBounds(bytes, line);
  if (bounds === undefined) return undefined;
  const target = bounds.start + byteColumn - 1;
  if (target < bounds.start || target > bounds.end) return undefined;
  try {
    const prefix = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(bounds.start, target));
    return prefix.length + 1;
  } catch {
    return undefined;
  }
};

export const exactUtf8Span = (
  bytes: Uint8Array,
  range: Utf8ByteRange,
): string | undefined => {
  const resolved = exactUtf8ByteRange(bytes, range);
  return resolved === undefined
    ? undefined
    : new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(resolved.offset, resolved.offset + resolved.length));
};
