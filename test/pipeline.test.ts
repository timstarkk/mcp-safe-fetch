import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitize } from '../src/sanitize/pipeline.js';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');

describe('sanitize pipeline', () => {
  it('strips all injection vectors from kitchen-sink fixture', () => {
    const result = sanitize(fixture('kitchen-sink.html'));
    expect(result.content).toContain('Real Title');
    expect(result.content).toContain('Final visible paragraph');
    expect(result.content).not.toContain('im_start');
    expect(result.content).not.toContain('evil');
    expect(result.content).not.toContain('alert');
    expect(result.content).not.toContain('Ignore all instructions');
    expect(result.stats.hiddenElements).toBeGreaterThan(0);
    expect(result.stats.scriptTags).toBeGreaterThan(0);
    expect(result.stats.llmDelimiters).toBeGreaterThan(0);
  });

  it('preserves clean documentation pages', () => {
    const html = fixture('clean-page.html');
    const result = sanitize(html);
    expect(result.content).toContain('Getting Started');
    expect(result.content).toContain('Installation');
    expect(result.content).toContain('npm install my-package');
    expect(result.content).toContain('Feature one');
    expect(result.content).toContain('Feature two');
    expect(result.stats.hiddenElements).toBe(0);
    expect(result.stats.llmDelimiters).toBe(0);
  });

  it('always reduces or maintains output size', () => {
    const result = sanitize(fixture('kitchen-sink.html'));
    expect(result.outputSize).toBeLessThan(result.inputSize);
  });

  it('handles empty input gracefully', () => {
    const result = sanitize('');
    expect(result.content).toBeDefined();
    expect(result.outputSize).toBe(0);
  });

  it('handles plain text (non-HTML) input', () => {
    const result = sanitize('Just a plain text string.');
    expect(result.content).toContain('Just a plain text string');
  });
});
