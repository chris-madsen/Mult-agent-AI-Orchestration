import assert from 'node:assert/strict';
import test from 'node:test';
import { exactUtf8SourceSpan } from '../src/domain/utf8-range.js';

test('reranker freeze uses one-based UTF-8 byte columns for emoji and Cyrillic', () => {
  const source = Buffer.from('first 🐱\r\nпривет🙂 café\r\nend\n', 'utf8');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 2, endLine: 2, startColumn: 13, endColumn: 17,
  }), '🙂');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 2, endLine: 2,
  }), 'привет🙂 café');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 1, endLine: 2, startColumn: 7, endColumn: 17,
  }), '🐱\r\nпривет🙂');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 2, endLine: 2, startColumn: 14, endColumn: 17,
  }), undefined, 'columns cannot split the first UTF-8 codepoint byte');
});

test('reranker freeze keeps combining marks exact and excludes CRLF terminators by default', () => {
  const source = Buffer.from('a\r\ne\u0301!\r\n', 'utf8');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 2, endLine: 2, startColumn: 1, endColumn: 4,
  }), 'e\u0301');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 2, endLine: 2,
  }), 'e\u0301!');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 1, endLine: 5,
  }), undefined);
});

test('reranker freeze can capture multi-line text starting with a blank line', () => {
  const source = Buffer.from('\r\nhello\r\nworld', 'utf8');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 1, endLine: 2,
  }), '\r\nhello');
  assert.equal(exactUtf8SourceSpan(source, {
    startLine: 1, endLine: 1,
  }), undefined);
});
