import { describe, it, expect } from 'vitest';
import { sanitizeUnicode } from '../src/sanitize/unicode.js';

describe('sanitizeUnicode', () => {
  it('strips zero-width characters', () => {
    const input = 'Hello\u200BWorld\u200C!\u200D';
    const result = sanitizeUnicode(input);
    expect(result.text).toBe('HelloWorld!');
    expect(result.stats.zeroWidthChars).toBe(3);
  });

  it('strips soft hyphens and BOM', () => {
    const input = 'te\u00ADst\uFEFF';
    const result = sanitizeUnicode(input);
    expect(result.text).toBe('test');
  });

  it('strips bidi overrides', () => {
    const input = 'normal\u202Areversed\u202Ctext';
    const result = sanitizeUnicode(input);
    expect(result.text).toBe('normalreversedtext');
    expect(result.stats.bidiOverrides).toBe(2);
  });

  it('strips control characters but preserves newlines and tabs', () => {
    const input = 'line1\nline2\ttab\x00null\x07bell';
    const result = sanitizeUnicode(input);
    expect(result.text).toBe('line1\nline2\ttabnullbell');
    expect(result.stats.controlChars).toBe(2);
  });

  it('applies NFKC normalization', () => {
    // Fullwidth 'A' (U+FF21) normalizes to regular 'A'
    const input = '\uFF21\uFF22\uFF23';
    const result = sanitizeUnicode(input);
    expect(result.text).toBe('ABC');
  });

  it('returns zero stats for clean text', () => {
    const input = 'Just normal text with no issues.';
    const result = sanitizeUnicode(input);
    expect(result.text).toBe(input);
    expect(result.stats.zeroWidthChars).toBe(0);
  });
});
