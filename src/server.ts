import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { fetchUrl } from './fetch.js';
import { sanitize, sanitizeText, looksLikeHtml, type PipelineStats, type PipelineResult } from './sanitize/pipeline.js';
import { loadConfig } from './config.js';
import { logSanitization, type LogEntry } from './logger.js';

interface SessionStats {
  totalRequests: number;
  totalStripped: PipelineStats;
  urls: string[];
  files: string[];
  commands: string[];
}

function buildStrippedSummary(stats: PipelineStats): string[] {
  const items: string[] = [];
  if (stats.hiddenElements > 0) items.push(`${stats.hiddenElements} hidden elements`);
  if (stats.scriptTags > 0) items.push(`${stats.scriptTags} script tags`);
  if (stats.styleTags > 0) items.push(`${stats.styleTags} style tags`);
  if (stats.zeroWidthChars > 0) items.push(`${stats.zeroWidthChars} zero-width chars`);
  if (stats.base64Payloads > 0) items.push(`${stats.base64Payloads} base64 payloads`);
  if (stats.dataUris > 0) items.push(`${stats.dataUris} data URIs`);
  if (stats.exfiltrationUrls > 0) items.push(`${stats.exfiltrationUrls} exfiltration URLs`);
  if (stats.offScreenElements > 0) items.push(`${stats.offScreenElements} off-screen elements`);
  if (stats.sameColorText > 0) items.push(`${stats.sameColorText} same-color text`);
  if (stats.llmDelimiters > 0) items.push(`${stats.llmDelimiters} LLM delimiters`);
  if (stats.bidiOverrides > 0) items.push(`${stats.bidiOverrides} bidi overrides`);
  if (stats.controlChars > 0) items.push(`${stats.controlChars} control chars`);
  if (stats.customPatterns > 0) items.push(`${stats.customPatterns} custom patterns`);
  return items;
}

function updateSessionStats(session: SessionStats, stats: PipelineStats): void {
  session.totalRequests++;
  for (const key of Object.keys(session.totalStripped) as (keyof PipelineStats)[]) {
    session.totalStripped[key] += stats[key];
  }
}

function buildLogEntry(
  tool: LogEntry['tool'],
  source: string,
  result: PipelineResult,
  durationMs: number,
  description?: string,
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    tool,
    source,
    stripped: result.stats,
    inputSize: result.inputSize,
    outputSize: result.outputSize,
    reductionPercent: result.inputSize > 0 ? Math.round((1 - result.outputSize / result.inputSize) * 1000) / 10 : 0,
    durationMs,
  };
  if (description) entry.description = description;
  return entry;
}

export function formatCatN(lines: string[], startLineNum: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const num = String(startLineNum + i).padStart(6, ' ');
    const line = lines[i].length > 2000 ? lines[i].slice(0, 2000) + '...' : lines[i];
    out.push(`${num}\t${line}`);
  }
  return out.join('\n');
}

function execCommand(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error && 'code' in error ? (error.code as number) ?? 1 : 0;
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode });
    });
  });
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const session: SessionStats = {
    totalRequests: 0,
    totalStripped: {
      hiddenElements: 0, htmlComments: 0, scriptTags: 0,
      styleTags: 0, noscriptTags: 0, metaTags: 0,
      offScreenElements: 0, sameColorText: 0,
      zeroWidthChars: 0, controlChars: 0, bidiOverrides: 0,
      unicodeTags: 0, variationSelectors: 0,
      base64Payloads: 0, hexPayloads: 0, dataUris: 0,
      exfiltrationUrls: 0,
      llmDelimiters: 0,
      customPatterns: 0,
    },
    urls: [],
    files: [],
    commands: [],
  };

  const server = new McpServer({
    name: 'safe-fetch',
    version: '0.3.0',
  });

  // ── safe_fetch ──────────────────────────────────────────────

  server.registerTool(
    'safe_fetch',
    {
      description: 'Fetch a URL and return sanitized content with prompt injection vectors removed. Strips hidden HTML elements, invisible unicode characters, encoded payloads, exfiltration URLs, and fake LLM delimiters.',
      inputSchema: {
        url: z.string().url().describe('URL to fetch'),
        prompt: z.string().optional().describe('What information to extract from the page'),
      },
    },
    async ({ url, prompt }) => {
      try {
        const startTime = Date.now();

        const fetched = await fetchUrl(url);
        const result = sanitize(fetched.html, config);
        const durationMs = Date.now() - startTime;

        updateSessionStats(session, result.stats);
        session.urls.push(url);

        if (config.logStripped) {
          logSanitization(config.logFile, config.logMaxBytes, buildLogEntry('safe_fetch', url, result, durationMs));
        }

        const strippedItems = buildStrippedSummary(result.stats);
        const promptLine = prompt ? `Prompt: ${prompt}\n\n` : '';
        const header = strippedItems.length > 0
          ? `[safe-fetch] Stripped: ${strippedItems.join(', ')} | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n${promptLine}`
          : `[safe-fetch] Clean page | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n${promptLine}`;

        return {
          content: [{ type: 'text' as const, text: header + result.content }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `[safe-fetch] Error fetching ${url}: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ── safe_read ───────────────────────────────────────────────

  server.registerTool(
    'safe_read',
    {
      description: 'Read a file and return sanitized content with prompt injection vectors removed. Strips invisible unicode characters, encoded payloads, exfiltration URLs, and fake LLM delimiters. Use instead of the Read tool for untrusted files (cloned repos, downloaded files, etc).',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the file to read'),
        offset: z.number().optional().describe('Line number to start reading from (1-based)'),
        limit: z.number().optional().describe('Number of lines to read (default: 2000)'),
      },
    },
    async ({ file_path, offset, limit }) => {
      try {
        const startTime = Date.now();

        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        const fileSize = statSync(file_path).size;
        if (fileSize > MAX_FILE_SIZE) {
          return {
            content: [{ type: 'text' as const, text: `[safe-read] File too large (${Math.round(fileSize / 1024 / 1024)}MB, max 50MB): ${file_path}` }],
            isError: true,
          };
        }

        const raw = readFileSync(file_path, 'utf-8');

        // Detect binary files (null bytes in first 8KB)
        const sample = raw.slice(0, 8192);
        if (sample.includes('\0')) {
          return {
            content: [{ type: 'text' as const, text: `[safe-read] Skipped binary file: ${file_path}` }],
            isError: true,
          };
        }

        // Route HTML files through full sanitize pipeline
        const result = looksLikeHtml(raw, file_path)
          ? sanitize(raw, config)
          : sanitizeText(raw, config);
        const durationMs = Date.now() - startTime;

        // Apply offset/limit and format as cat -n
        const allLines = result.content.split('\n');
        const startLine = Math.max(1, offset ?? 1);
        const maxLines = limit ?? 2000;
        const sliced = allLines.slice(startLine - 1, startLine - 1 + maxLines);
        const formatted = formatCatN(sliced, startLine);

        updateSessionStats(session, result.stats);
        session.files.push(file_path);

        if (config.logStripped) {
          logSanitization(config.logFile, config.logMaxBytes, buildLogEntry('safe_read', file_path, result, durationMs));
        }

        const strippedItems = buildStrippedSummary(result.stats);
        const header = strippedItems.length > 0
          ? `[safe-read] Stripped: ${strippedItems.join(', ')} | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n`
          : `[safe-read] Clean file | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n`;

        return {
          content: [{ type: 'text' as const, text: header + formatted }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `[safe-read] Error reading ${file_path}: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ── safe_exec ───────────────────────────────────────────────

  server.registerTool(
    'safe_exec',
    {
      description: 'Execute a shell command and return sanitized stdout/stderr with prompt injection vectors removed. Strips invisible unicode characters, encoded payloads, exfiltration URLs, and fake LLM delimiters. Use instead of Bash when the command output may contain untrusted content (gh pr view, curl, git log from external repos, etc).',
      inputSchema: {
        command: z.string().describe('Shell command to execute'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000, max: 600000)'),
        timeout_ms: z.number().optional().describe('Deprecated: use timeout instead'),
        description: z.string().optional().describe('Description of what the command does'),
      },
    },
    async ({ command, timeout: timeoutParam, timeout_ms, description }) => {
      try {
        const startTime = Date.now();
        const rawTimeout = timeoutParam ?? timeout_ms ?? 120000;
        const timeout = Math.min(rawTimeout, 600000);

        const { stdout, stderr, exitCode } = await execCommand(command, timeout);
        const combined = stderr ? `${stdout}\n--- stderr ---\n${stderr}` : stdout;

        // Route HTML-like output through full sanitize pipeline
        const result = looksLikeHtml(combined)
          ? sanitize(combined, config)
          : sanitizeText(combined, config);
        const durationMs = Date.now() - startTime;

        updateSessionStats(session, result.stats);
        session.commands.push(command);

        if (config.logStripped) {
          logSanitization(config.logFile, config.logMaxBytes, buildLogEntry('safe_exec', command, result, durationMs, description));
        }

        const strippedItems = buildStrippedSummary(result.stats);
        const exitLabel = exitCode !== 0 ? ` exit=${exitCode}` : '';
        const descLabel = description ? ` ${description} |` : '';
        const header = strippedItems.length > 0
          ? `[safe-exec${exitLabel}]${descLabel} Stripped: ${strippedItems.join(', ')} | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n`
          : `[safe-exec${exitLabel}]${descLabel} Clean output | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n`;

        return {
          content: [{ type: 'text' as const, text: header + result.content }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `[safe-exec] Error executing command: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ── sanitize_stats ──────────────────────────────────────────

  server.registerTool(
    'sanitize_stats',
    {
      description: 'Show sanitization statistics for the current session across all tools (safe_fetch, safe_read, safe_exec)',
      inputSchema: {},
    },
    async () => {
      const lines = [
        `Session stats (${session.totalRequests} requests):`,
        `  Hidden elements stripped: ${session.totalStripped.hiddenElements}`,
        `  Script tags stripped: ${session.totalStripped.scriptTags}`,
        `  Style tags stripped: ${session.totalStripped.styleTags}`,
        `  Zero-width chars stripped: ${session.totalStripped.zeroWidthChars}`,
        `  LLM delimiters stripped: ${session.totalStripped.llmDelimiters}`,
        `  Bidi overrides stripped: ${session.totalStripped.bidiOverrides}`,
        `  Base64 payloads stripped: ${session.totalStripped.base64Payloads}`,
        `  Exfiltration URLs stripped: ${session.totalStripped.exfiltrationUrls}`,
        `  Control chars stripped: ${session.totalStripped.controlChars}`,
      ];

      if (session.urls.length > 0) {
        lines.push('', 'URLs fetched:', ...session.urls.map(u => `  - ${u}`));
      }
      if (session.files.length > 0) {
        lines.push('', 'Files read:', ...session.files.map(f => `  - ${f}`));
      }
      if (session.commands.length > 0) {
        lines.push('', 'Commands executed:', ...session.commands.map(c => `  - ${c}`));
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[safe-fetch] MCP server running on stdio');
}
