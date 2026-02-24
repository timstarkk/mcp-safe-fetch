export interface DelimiterSanitizeResult {
  text: string;
  stats: {
    llmDelimiters: number;
  };
}

const LLM_DELIMITER_PATTERNS: RegExp[] = [
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  /<\|endoftext\|>/gi,
  /<\|pad\|>/gi,
  /\\?\[INST\\?\]/gi,
  /\\?\[\\?\/INST\\?\]/gi,
  /<<SYS>>/gi,
  /<<\\?\/SYS>>/gi,
  /\n\nHuman:/g,
  /\n\nAssistant:/g,
];

export function sanitizeDelimiters(text: string): DelimiterSanitizeResult {
  let count = 0;
  let result = text;

  for (const pattern of LLM_DELIMITER_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      count += matches.length;
      result = result.replace(pattern, '');
    }
  }

  return {
    text: result,
    stats: { llmDelimiters: count },
  };
}
