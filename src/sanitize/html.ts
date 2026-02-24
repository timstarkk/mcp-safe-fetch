import type { CheerioAPI } from 'cheerio';

export interface HtmlSanitizeResult {
  html: string;
  stats: {
    hiddenElements: number;
    htmlComments: number;
    scriptTags: number;
    styleTags: number;
    noscriptTags: number;
    metaTags: number;
  };
}

const HIDDEN_SELECTORS = [
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
  '[style*="opacity:0"]',
  '[style*="opacity: 0"]',
  '[hidden]',
].join(', ');

const STRIP_TAGS = ['script', 'style', 'noscript', 'meta', 'link'];

export function sanitizeHtml($: CheerioAPI): HtmlSanitizeResult {
  const stats = {
    hiddenElements: 0,
    htmlComments: 0,
    scriptTags: 0,
    styleTags: 0,
    noscriptTags: 0,
    metaTags: 0,
  };

  // Remove hidden elements by inline style / hidden attribute
  const hidden = $(HIDDEN_SELECTORS);
  stats.hiddenElements = hidden.length;
  hidden.remove();

  // Remove script, style, noscript, meta, link tags
  for (const tag of STRIP_TAGS) {
    const elements = $(tag);
    const count = elements.length;
    if (tag === 'script') stats.scriptTags = count;
    else if (tag === 'style') stats.styleTags = count;
    else if (tag === 'noscript') stats.noscriptTags = count;
    else if (tag === 'meta' || tag === 'link') stats.metaTags += count;
    elements.remove();
  }

  // Count and remove HTML comments
  const comments = $('*').contents().filter(function () {
    return this.type === 'comment';
  });
  stats.htmlComments = comments.length;
  comments.remove();

  return {
    html: $.html(),
    stats,
  };
}
