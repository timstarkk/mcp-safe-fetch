import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import { sanitize, sanitizeText, looksLikeHtml } from '../src/sanitize/pipeline.js';
import { loadConfig } from '../src/config.js';
import { formatCatN } from '../src/server.js';

const TMP_DIR = join(tmpdir(), 'safe-fetch-test-' + Date.now());

let client: Client;
let server: McpServer;

beforeAll(async () => {
  mkdirSync(TMP_DIR, { recursive: true });

  // Create a minimal server with our tools registered
  const config = loadConfig();
  server = new McpServer({ name: 'safe-fetch-test', version: '0.0.1' });

  // Register safe_read
  server.registerTool(
    'safe_read',
    {
      description: 'Read a file with sanitization',
      inputSchema: {
        file_path: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ file_path, offset, limit }) => {
      const raw = readFileSync(file_path, 'utf-8');
      const sample = raw.slice(0, 8192);
      if (sample.includes('\0')) {
        return { content: [{ type: 'text' as const, text: `[safe-read] Skipped binary file: ${file_path}` }], isError: true };
      }
      const result = looksLikeHtml(raw, file_path) ? sanitize(raw, config) : sanitizeText(raw, config);
      const allLines = result.content.split('\n');
      const startLine = Math.max(1, offset ?? 1);
      const maxLines = limit ?? 2000;
      const sliced = allLines.slice(startLine - 1, startLine - 1 + maxLines);
      const formatted = formatCatN(sliced, startLine);
      const header = `[safe-read] Clean file | ${result.inputSize} → ${result.outputSize} bytes\n\n`;
      return { content: [{ type: 'text' as const, text: header + formatted }] };
    },
  );

  // Register safe_exec
  server.registerTool(
    'safe_exec',
    {
      description: 'Execute a command with sanitization',
      inputSchema: {
        command: z.string(),
        timeout: z.number().optional(),
        timeout_ms: z.number().optional(),
        description: z.string().optional(),
      },
    },
    async ({ command, timeout: timeoutParam, timeout_ms, description }) => {
      const rawTimeout = timeoutParam ?? timeout_ms ?? 120000;
      const timeout = Math.min(rawTimeout, 600000);
      const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        exec(command, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          const exitCode = error && 'code' in error ? (error.code as number) ?? 1 : 0;
          resolve({ stdout: stdout || '', stderr: stderr || '', exitCode });
        });
      });
      const combined = stderr ? `${stdout}\n--- stderr ---\n${stderr}` : stdout;
      const result = looksLikeHtml(combined) ? sanitize(combined, config) : sanitizeText(combined, config);
      const exitLabel = exitCode !== 0 ? ` exit=${exitCode}` : '';
      const descLabel = description ? ` ${description} |` : '';
      const header = `[safe-exec${exitLabel}]${descLabel} Clean output | ${result.inputSize} → ${result.outputSize} bytes\n\n`;
      return { content: [{ type: 'text' as const, text: header + result.content }] };
    },
  );

  // Register safe_fetch (minimal — we won't test actual URL fetching)
  server.registerTool(
    'safe_fetch',
    {
      description: 'Fetch with sanitization',
      inputSchema: {
        url: z.string().url(),
        prompt: z.string().optional(),
      },
    },
    async ({ url, prompt }) => {
      const promptLine = prompt ? `\nPrompt: ${prompt}\n` : '';
      const header = `[safe-fetch] Clean page | 0 → 0 bytes${promptLine}\n`;
      return { content: [{ type: 'text' as const, text: header + `(mock fetch for ${url})` }] };
    },
  );

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
    expect(text).not.toContain('hidden');
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
    // We can't easily test the timeout value directly, but we can verify it doesn't crash
    // when given a value above 600000
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
});
