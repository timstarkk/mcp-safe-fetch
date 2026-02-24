export interface UnicodeSanitizeResult {
  text: string;
  stats: {
    zeroWidthChars: number;
    controlChars: number;
    bidiOverrides: number;
    unicodeTags: number;
    variationSelectors: number;
  };
}

// Zero-width and invisible characters
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\u2060\u2063\uFEFF\u00AD]/g;

// Bidirectional overrides and isolates
const BIDI_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;

// Variation selectors
const VARIATION_SELECTORS = /[\uFE00-\uFE0F]/g;

// Unicode tag characters (U+E0001-U+E007F)
const UNICODE_TAGS = /[\u{E0001}-\u{E007F}]/gu;

// Control characters (except \n \t \r)
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

export function sanitizeUnicode(text: string): UnicodeSanitizeResult {
  const stats = {
    zeroWidthChars: 0,
    controlChars: 0,
    bidiOverrides: 0,
    unicodeTags: 0,
    variationSelectors: 0,
  };

  // Count before stripping
  stats.zeroWidthChars = (text.match(INVISIBLE_CHARS) || []).length;
  stats.bidiOverrides = (text.match(BIDI_CHARS) || []).length;
  stats.variationSelectors = (text.match(VARIATION_SELECTORS) || []).length;
  stats.unicodeTags = (text.match(UNICODE_TAGS) || []).length;
  stats.controlChars = (text.match(CONTROL_CHARS) || []).length;

  // Strip all
  let result = text
    .replace(INVISIBLE_CHARS, '')
    .replace(BIDI_CHARS, '')
    .replace(VARIATION_SELECTORS, '')
    .replace(UNICODE_TAGS, '')
    .replace(CONTROL_CHARS, '');

  // NFKC normalization (collapses homoglyphs)
  result = result.normalize('NFKC');

  return { text: result, stats };
}
