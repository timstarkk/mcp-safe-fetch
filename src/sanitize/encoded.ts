import type { SanitizeConfig } from '../config.js';

export interface EncodedSanitizeResult {
  text: string;
  stats: {
    base64Payloads: number;
    hexPayloads: number;
    dataUris: number;
  };
}

// Instruction-like content pattern for decoded strings
const INSTRUCTION_PATTERN = /\b(ignore|forget|disregard|override|you are now|new instruction|system prompt|execute|eval\s*\(|import\s*\(|require\s*\(|api.?key|password|secret|curl\s|wget\s|rm\s+-|sudo\s)/i;

// Base64 strings (40+ chars to avoid short legitimate values)
const BASE64_PATTERN = /[A-Za-z0-9+\/]{40,}={0,2}/g;

// Hex-encoded sequences (20+ byte pairs)
const HEX_PATTERN = /(?:0x|\\x)?([0-9a-f]{2}[\s,;]?){20,}/gi;

// Text data URIs
const DATA_URI_PATTERN = /data:text\/[^;]*;base64,([A-Za-z0-9+\/=]+)/gi;

function decodeBase64Safe(str: string): string | null {
  try {
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function decodeHexSafe(str: string): string | null {
  try {
    const hex = str.replace(/[^0-9a-f]/gi, '');
    const bytes = Buffer.from(hex, 'hex');
    return bytes.toString('utf-8');
  } catch {
    return null;
  }
}

export function sanitizeEncoded(
  text: string,
  config?: SanitizeConfig,
): EncodedSanitizeResult {
  const stats = { base64Payloads: 0, hexPayloads: 0, dataUris: 0 };
  let result = text;
  const maxLen = config?.maxBase64DecodeLength ?? 500;

  // Strip text/* data URIs
  if (!config?.allowDataUris) {
    result = result.replace(DATA_URI_PATTERN, () => {
      stats.dataUris++;
      return '[data-uri-removed]';
    });
  }

  // Check base64 strings for instruction content
  result = result.replace(BASE64_PATTERN, (match) => {
    if (match.length > maxLen * 1.4) return match; // Too long to be targeted injection
    const decoded = decodeBase64Safe(match);
    if (decoded && INSTRUCTION_PATTERN.test(decoded)) {
      stats.base64Payloads++;
      return '[encoded-removed]';
    }
    return match;
  });

  // Check hex sequences for instruction content
  result = result.replace(HEX_PATTERN, (match) => {
    const decoded = decodeHexSafe(match);
    if (decoded && INSTRUCTION_PATTERN.test(decoded)) {
      stats.hexPayloads++;
      return '[encoded-removed]';
    }
    return match;
  });

  return { text: result, stats };
}
