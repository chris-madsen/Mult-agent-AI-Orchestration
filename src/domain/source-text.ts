import { TextDecoder } from 'node:util';

export type SourceTextFailureKind = 'binary_source' | 'invalid_utf8';

export type StrictSourceText =
  | { readonly _tag: 'Ok'; readonly text: string }
  | { readonly _tag: 'Err'; readonly kind: SourceTextFailureKind };

/**
 * Source files may reach parsers/embedders only as strict UTF-8 text.
 *
 * Node's Buffer.toString('utf8') replaces malformed sequences with U+FFFD,
 * which can silently turn binary/corrupt input into apparently valid source.
 * High-confidence binary control bytes are rejected before decoding, then a
 * fatal UTF-8 decoder rejects malformed byte sequences.
 */
export const decodeStrictSourceText = (bytes: Uint8Array): StrictSourceText => {
  for (const byte of bytes) {
    const allowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d;
    if ((byte < 0x20 && !allowedWhitespace) || byte === 0x7f) {
      return { _tag: 'Err', kind: 'binary_source' };
    }
  }
  try {
    return {
      _tag: 'Ok',
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    };
  } catch {
    return { _tag: 'Err', kind: 'invalid_utf8' };
  }
};
