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
    offScreenElements: number;
    sameColorText: number;
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

const OFF_SCREEN_SELECTORS = [
  '[style*="text-indent"][style*="-999"]',
  '[style*="position:absolute"][style*="left:-"]',
  '[style*="position: absolute"][style*="left: -"]',
  '[style*="position:absolute"][style*="top:-"]',
  '[style*="position: absolute"][style*="top: -"]',
  '[style*="position:fixed"][style*="left:-"]',
  '[style*="position: fixed"][style*="left: -"]',
  '[style*="position:fixed"][style*="top:-"]',
  '[style*="position: fixed"][style*="top: -"]',
  '[style*="clip:rect(0"]',
  '[style*="clip: rect(0"]',
  '[style*="clip-path:inset(100"]',
  '[style*="clip-path: inset(100"]',
  '[style*="font-size:0"]',
  '[style*="font-size: 0"]',
].join(', ');

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ff0000',
  green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080',
  grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff',
  teal: '#008080', navy: '#000080', fuchsia: '#ff00ff',
  purple: '#800080', orange: '#ffa500',
};

function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  const hex3 = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const r = parseInt(rgb[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgb[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgb[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return null;
}

const STRIP_TAGS = ['script', 'style', 'noscript', 'meta', 'link'];

export function sanitizeHtml($: CheerioAPI): HtmlSanitizeResult {
  const stats = {
    hiddenElements: 0,
    htmlComments: 0,
    scriptTags: 0,
    styleTags: 0,
    noscriptTags: 0,
    metaTags: 0,
    offScreenElements: 0,
    sameColorText: 0,
  };

  // Remove hidden elements by inline style / hidden attribute
  const hidden = $(HIDDEN_SELECTORS);
  stats.hiddenElements = hidden.length;
  hidden.remove();

  // Remove off-screen positioned elements
  const offScreen = $(OFF_SCREEN_SELECTORS);
  stats.offScreenElements = offScreen.length;
  offScreen.remove();

  // Detect same-color text (foreground matches background in inline style)
  $('[style]').each(function () {
    const style = $(this).attr('style') || '';
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;!]+)/i);
    const bgMatch = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/i);
    if (colorMatch && bgMatch) {
      const fg = normalizeColor(colorMatch[1]);
      const bg = normalizeColor(bgMatch[1]);
      if (fg && bg && fg === bg) {
        stats.sameColorText++;
        $(this).remove();
      }
    }
  });

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
