import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio/slim';
import { sanitizeHtml } from '../src/sanitize/html.js';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');

describe('sanitizeHtml', () => {
  it('strips display:none elements', () => {
    const $ = cheerio.load(fixture('hidden-div.html'));
    const result = sanitizeHtml($);
    expect(result.html).not.toContain('DAN');
    expect(result.html).toContain('real content');
    expect(result.stats.hiddenElements).toBeGreaterThan(0);
  });

  it('strips visibility:hidden and opacity:0', () => {
    const $ = cheerio.load(fixture('hidden-div.html'));
    const result = sanitizeHtml($);
    expect(result.html).not.toContain('rm -rf');
    expect(result.html).not.toContain('system prompt');
  });

  it('strips hidden attribute', () => {
    const $ = cheerio.load(fixture('hidden-div.html'));
    const result = sanitizeHtml($);
    expect(result.html).not.toContain('stripped too');
  });

  it('strips script, style, noscript tags', () => {
    const $ = cheerio.load(fixture('kitchen-sink.html'));
    const result = sanitizeHtml($);
    expect(result.html).not.toContain('alert');
    expect(result.html).not.toContain('.hidden');
    expect(result.stats.scriptTags).toBeGreaterThan(0);
    expect(result.stats.styleTags).toBeGreaterThan(0);
  });

  it('strips HTML comments', () => {
    const $ = cheerio.load(fixture('comment-injection.html'));
    const result = sanitizeHtml($);
    expect(result.html).not.toContain('API keys');
    expect(result.html).toContain('visible content');
  });

  it('preserves clean content unchanged', () => {
    const $ = cheerio.load(fixture('clean-page.html'));
    const result = sanitizeHtml($);
    expect(result.html).toContain('Getting Started');
    expect(result.html).toContain('npm install');
    expect(result.html).toContain('Feature one');
    expect(result.stats.hiddenElements).toBe(0);
    expect(result.stats.scriptTags).toBe(0);
  });
});
