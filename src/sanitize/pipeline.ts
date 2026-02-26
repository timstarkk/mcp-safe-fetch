import * as cheerio from 'cheerio/slim';
import TurndownService from 'turndown';
import { sanitizeHtml, type HtmlSanitizeResult } from './html.js';
import { sanitizeUnicode, type UnicodeSanitizeResult } from './unicode.js';
import { sanitizeDelimiters, type DelimiterSanitizeResult } from './delimiters.js';
import { sanitizeEncoded, type EncodedSanitizeResult } from './encoded.js';
import { sanitizeExfiltration, type ExfiltrationSanitizeResult } from './exfiltration.js';
import type { SanitizeConfig } from '../config.js';

export interface PipelineStats {
  hiddenElements: number;
  htmlComments: number;
  scriptTags: number;
  styleTags: number;
  noscriptTags: number;
  metaTags: number;
  offScreenElements: number;
  sameColorText: number;
  zeroWidthChars: number;
  controlChars: number;
  bidiOverrides: number;
  unicodeTags: number;
  variationSelectors: number;
  base64Payloads: number;
  hexPayloads: number;
  dataUris: number;
  exfiltrationUrls: number;
  llmDelimiters: number;
  customPatterns: number;
}

export interface PipelineResult {
  content: string;
  stats: PipelineStats;
  inputSize: number;
  outputSize: number;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  fence: '```',
  hr: '---',
  bulletListMarker: '-',
  preformattedCode: true,
});

export function sanitize(html: string, config?: SanitizeConfig): PipelineResult {
  const inputSize = html.length;

  // Step 1: Parse HTML with cheerio (htmlparser2 backend via /slim)
  const $ = cheerio.load(html);

  // Step 2: Strip hidden HTML elements
  const htmlResult = sanitizeHtml($);

  // Step 3: Convert cleaned HTML to markdown
  let content = turndown.turndown(htmlResult.html);

  // Step 4: Unicode sanitization
  const unicodeResult = sanitizeUnicode(content);
  content = unicodeResult.text;

  // Step 5: Detect encoded payloads
  const encodedResult = sanitizeEncoded(content, config);
  content = encodedResult.text;

  // Step 6: Detect exfiltration URLs in markdown
  const exfilResult = sanitizeExfiltration(content);
  content = exfilResult.text;

  // Step 7: Strip fake LLM delimiters
  const delimiterResult = sanitizeDelimiters(content, config?.customPatterns);
  content = delimiterResult.text;

  const outputSize = content.length;

  return {
    content,
    stats: {
      ...htmlResult.stats,
      ...unicodeResult.stats,
      ...encodedResult.stats,
      ...exfilResult.stats,
      ...delimiterResult.stats,
    },
    inputSize,
    outputSize,
  };
}
