import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fetchUrl } from './fetch.js';
import { sanitize, type PipelineStats } from './sanitize/pipeline.js';
import { loadConfig } from './config.js';
import { logSanitization, type LogEntry } from './logger.js';

interface SessionStats {
  totalRequests: number;
  totalStripped: PipelineStats;
  urls: string[];
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
  };

  const server = new McpServer({
    name: 'safe-fetch',
    version: '0.2.0',
  });

  server.registerTool(
    'safe_fetch',
    {
      description: 'Fetch a URL and return sanitized content with prompt injection vectors removed. Strips hidden HTML elements, invisible unicode characters, and fake LLM delimiters.',
      inputSchema: {
        url: z.string().url().describe('URL to fetch'),
      },
    },
    async ({ url }) => {
      try {
        const startTime = Date.now();

        const fetched = await fetchUrl(url);
        const result = sanitize(fetched.html, config);
        const durationMs = Date.now() - startTime;

        // Update session stats
        session.totalRequests++;
        session.urls.push(url);
        for (const key of Object.keys(session.totalStripped) as (keyof PipelineStats)[]) {
          session.totalStripped[key] += result.stats[key];
        }

        // Log if configured
        if (config.logStripped) {
          const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            url,
            stripped: result.stats,
            inputSize: result.inputSize,
            outputSize: result.outputSize,
            reductionPercent: Math.round((1 - result.outputSize / result.inputSize) * 1000) / 10,
            durationMs,
          };
          logSanitization(config.logFile, entry);
        }

        // Build summary of what was stripped
        const strippedItems: string[] = [];
        if (result.stats.hiddenElements > 0) strippedItems.push(`${result.stats.hiddenElements} hidden elements`);
        if (result.stats.scriptTags > 0) strippedItems.push(`${result.stats.scriptTags} script tags`);
        if (result.stats.styleTags > 0) strippedItems.push(`${result.stats.styleTags} style tags`);
        if (result.stats.zeroWidthChars > 0) strippedItems.push(`${result.stats.zeroWidthChars} zero-width chars`);
        if (result.stats.base64Payloads > 0) strippedItems.push(`${result.stats.base64Payloads} base64 payloads`);
        if (result.stats.dataUris > 0) strippedItems.push(`${result.stats.dataUris} data URIs`);
        if (result.stats.exfiltrationUrls > 0) strippedItems.push(`${result.stats.exfiltrationUrls} exfiltration URLs`);
        if (result.stats.offScreenElements > 0) strippedItems.push(`${result.stats.offScreenElements} off-screen elements`);
        if (result.stats.sameColorText > 0) strippedItems.push(`${result.stats.sameColorText} same-color text`);
        if (result.stats.llmDelimiters > 0) strippedItems.push(`${result.stats.llmDelimiters} LLM delimiters`);

        const header = strippedItems.length > 0
          ? `[safe-fetch] Stripped: ${strippedItems.join(', ')} | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n`
          : `[safe-fetch] Clean page | ${result.inputSize} → ${result.outputSize} bytes (${durationMs}ms)\n\n`;

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

  server.registerTool(
    'sanitize_stats',
    {
      description: 'Show sanitization statistics for the current session',
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
        '',
        `URLs fetched:`,
        ...session.urls.map(u => `  - ${u}`),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[safe-fetch] MCP server running on stdio');
}
