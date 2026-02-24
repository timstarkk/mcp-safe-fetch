import * as cheerio from 'cheerio/slim';
import TurndownService from 'turndown';
import { sanitizeHtml, type HtmlSanitizeResult } from './html.js';
import { sanitizeUnicode, type UnicodeSanitizeResult } from './unicode.js';
import { sanitizeDelimiters, type DelimiterSanitizeResult } from './delimiters.js';

export interface PipelineStats {
  hiddenElements: number;
  htmlComments: number;
  scriptTags: number;
  styleTags: number;
  noscriptTags: number;
  metaTags: number;
  zeroWidthChars: number;
  controlChars: number;
  bidiOverrides: number;
  unicodeTags: number;
  variationSelectors: number;
  llmDelimiters: number;
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

export function sanitize(html: string): PipelineResult {
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

  // Step 5: Strip fake LLM delimiters
  const delimiterResult = sanitizeDelimiters(content);
  content = delimiterResult.text;

  const outputSize = content.length;

  return {
    content,
    stats: {
      ...htmlResult.stats,
      ...unicodeResult.stats,
      ...delimiterResult.stats,
    },
    inputSize,
    outputSize,
  };
}
