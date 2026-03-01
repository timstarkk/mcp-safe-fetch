import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer, formatCatN } from '../src/server.js';
import type { FetchResult } from '../src/fetch.js';

const TMP_DIR = join(tmpdir(), 'safe-fetch-test-' + Date.now());

let client: Client;
let server: McpServer;

const mockFetchFn = async (url: string): Promise<FetchResult> => ({
  html: `<html><body><p>Mock content for ${url}</p></body></html>`,
  url,
  status: 200,
  contentType: 'text/html',
});

beforeAll(async () => {
  mkdirSync(TMP_DIR, { recursive: true });

  server = createServer({ fetchFn: mockFetchFn });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: 'test-client', version: '1.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ── formatCatN unit tests ─────────────────────────────────────

describe('formatCatN', () => {
  it('formats lines with right-justified 6-char line numbers', () => {
    const result = formatCatN(['hello', 'world'], 1);
    expect(result).toBe('     1\thello\n     2\tworld');
  });

  it('starts from the given line number', () => {
    const result = formatCatN(['line a', 'line b'], 42);
    expect(result).toBe('    42\tline a\n    43\tline b');
  });

  it('truncates lines longer than 2000 chars', () => {
    const longLine = 'x'.repeat(2500);
    const result = formatCatN([longLine], 1);
    const output = result.split('\t')[1];
    expect(output).toHaveLength(2003); // 2000 + '...'
    expect(output.endsWith('...')).toBe(true);
  });

  it('does not truncate lines at exactly 2000 chars', () => {
    const exactLine = 'y'.repeat(2000);
    const result = formatCatN([exactLine], 1);
    const output = result.split('\t')[1];
    expect(output).toBe(exactLine);
  });

  it('handles empty lines array', () => {
    expect(formatCatN([], 1)).toBe('');
  });

  it('handles single empty string line', () => {
    expect(formatCatN([''], 1)).toBe('     1\t');
  });
});

// ── safe_read integration tests ───────────────────────────────

describe('safe_read', () => {
  it('reads a file and returns cat-n formatted output', async () => {
    const file = join(TMP_DIR, 'test.txt');
    writeFileSync(file, 'line one\nline two\nline three\n');

    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: file } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('[safe-read]');
    expect(text).toContain('     1\tline one');
    expect(text).toContain('     2\tline two');
    expect(text).toContain('     3\tline three');
  });

  it('respects offset parameter', async () => {
    const file = join(TMP_DIR, 'offset.txt');
    writeFileSync(file, 'a\nb\nc\nd\ne\n');

    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: file, offset: 3 } });
    const text = (result.content as any)[0].text as string;

    expect(text).not.toContain('     1\t');
    expect(text).toContain('     3\tc');
    expect(text).toContain('     4\td');
  });

  it('respects limit parameter', async () => {
    const file = join(TMP_DIR, 'limit.txt');
    writeFileSync(file, 'a\nb\nc\nd\ne\n');

    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: file, limit: 2 } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('     1\ta');
    expect(text).toContain('     2\tb');
    expect(text).not.toContain('     3\t');
  });

  it('combines offset and limit', async () => {
    const file = join(TMP_DIR, 'both.txt');
    writeFileSync(file, 'a\nb\nc\nd\ne\n');

    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: file, offset: 2, limit: 2 } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('     2\tb');
    expect(text).toContain('     3\tc');
    expect(text).not.toContain('     1\t');
    expect(text).not.toContain('     4\t');
  });

  it('rejects binary files', async () => {
    const file = join(TMP_DIR, 'binary.bin');
    writeFileSync(file, Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]));

    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: file } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('Skipped binary file');
    expect(result.isError).toBe(true);
  });

  it('routes HTML files through full sanitize pipeline', async () => {
    const file = join(TMP_DIR, 'page.html');
    writeFileSync(file, '<!DOCTYPE html><html><body><div style="display:none">hidden</div><p>visible</p></body></html>');

    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: file } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('visible');
    // The hidden div content was stripped — only "hidden" in the header stats is OK
    expect(text).toContain('hidden elements');
    expect(text).not.toContain('>hidden<');
    expect(text).not.toContain('\thidden');
  });

  it('returns error for nonexistent file', async () => {
    const result = await client.callTool({ name: 'safe_read', arguments: { file_path: '/tmp/does-not-exist-xyz.txt' } });
    expect(result.isError).toBe(true);
  });
});

// ── safe_exec integration tests ───────────────────────────────

describe('safe_exec', () => {
  it('executes a command and returns sanitized output', async () => {
    const result = await client.callTool({ name: 'safe_exec', arguments: { command: 'echo hello world' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('[safe-exec]');
    expect(text).toContain('hello world');
  });

  it('includes description in header', async () => {
    const result = await client.callTool({ name: 'safe_exec', arguments: { command: 'echo test', description: 'Run echo' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('Run echo |');
  });

  it('reports nonzero exit code', async () => {
    const result = await client.callTool({ name: 'safe_exec', arguments: { command: 'exit 42' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('exit=42');
  });

  it('caps timeout at 600000ms', async () => {
    const result = await client.callTool({ name: 'safe_exec', arguments: { command: 'echo ok', timeout: 999999 } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('ok');
  });

  it('accepts deprecated timeout_ms', async () => {
    const result = await client.callTool({ name: 'safe_exec', arguments: { command: 'echo compat', timeout_ms: 5000 } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('compat');
  });
});

// ── safe_fetch integration tests ──────────────────────────────

describe('safe_fetch', () => {
  it('returns sanitized content from fetched HTML', async () => {
    const result = await client.callTool({ name: 'safe_fetch', arguments: { url: 'https://example.com' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('[safe-fetch]');
    expect(text).toContain('Mock content for https://example.com');
  });

  it('echoes prompt in response header', async () => {
    const result = await client.callTool({ name: 'safe_fetch', arguments: { url: 'https://example.com', prompt: 'Extract the main heading' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('Prompt: Extract the main heading');
  });

  it('works without prompt', async () => {
    const result = await client.callTool({ name: 'safe_fetch', arguments: { url: 'https://example.com' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('[safe-fetch]');
    expect(text).not.toContain('Prompt:');
  });

  it('runs fetched HTML through full sanitize pipeline', async () => {
    const maliciousFetch = async (url: string): Promise<FetchResult> => ({
      html: '<html><body><div style="display:none">injected</div><p>legit</p></body></html>',
      url,
      status: 200,
      contentType: 'text/html',
    });

    const maliciousServer = createServer({ fetchFn: maliciousFetch });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await maliciousServer.connect(st);
    const c = new Client({ name: 'test-malicious', version: '1.0' });
    await c.connect(ct);

    const result = await c.callTool({ name: 'safe_fetch', arguments: { url: 'https://evil.com' } });
    const text = (result.content as any)[0].text as string;

    expect(text).toContain('legit');
    expect(text).not.toContain('injected');
    expect(text).toContain('hidden elements');

    await c.close();
    await maliciousServer.close();
  });
});
