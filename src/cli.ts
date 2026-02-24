import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchUrl } from './fetch.js';
import { sanitize } from './sanitize/pipeline.js';

const CLAUDE_JSON_PATH = join(process.env.HOME || '', '.claude.json');
const SETTINGS_PATH = join(process.env.HOME || '', '.claude', 'settings.json');

const MCP_CONFIG = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'mcp-safe-fetch'],
};

interface ClaudeJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Settings {
  allowedTools?: Record<string, string>;
  [key: string]: unknown;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    return {} as T;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {} as T;
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function runInit(args: string[]): void {
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('Would add to ~/.claude.json:');
    console.log(JSON.stringify({ mcpServers: { 'safe-fetch': MCP_CONFIG } }, null, 2));
    console.log('\nWould add to ~/.claude/settings.json:');
    console.log(JSON.stringify({ allowedTools: { WebFetch: 'deny', 'mcp__safe-fetch__safe_fetch': 'allow' } }, null, 2));
    return;
  }

  // Add MCP server to ~/.claude.json
  const claudeJson = readJson<ClaudeJson>(CLAUDE_JSON_PATH);
  if (!claudeJson.mcpServers) claudeJson.mcpServers = {};
  claudeJson.mcpServers['safe-fetch'] = MCP_CONFIG;
  writeJson(CLAUDE_JSON_PATH, claudeJson);

  // Add tool permissions to ~/.claude/settings.json
  const settings = readJson<Settings>(SETTINGS_PATH);
  if (!settings.allowedTools) settings.allowedTools = {};
  settings.allowedTools['WebFetch'] = 'deny';
  settings.allowedTools['mcp__safe-fetch__safe_fetch'] = 'allow';
  writeJson(SETTINGS_PATH, settings);

  console.log('Updated ~/.claude.json:');
  console.log('  + mcpServers.safe-fetch (mcp-safe-fetch MCP server)');
  console.log('\nUpdated ~/.claude/settings.json:');
  console.log('  + allowedTools.WebFetch: "deny"');
  console.log('  + allowedTools.mcp__safe-fetch__safe_fetch: "allow"');
  console.log('\nRestart Claude Code to activate.');
}

async function runTest(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    console.error('Usage: mcp-safe-fetch test <url>');
    process.exit(1);
  }

  console.error(`Fetching ${url}...`);
  const startTime = Date.now();

  const fetched = await fetchUrl(url);
  const result = sanitize(fetched.html);
  const durationMs = Date.now() - startTime;

  // Print stats to stderr
  console.error(`\nSanitization complete (${durationMs}ms):`);
  console.error(`  Input:  ${result.inputSize} bytes`);
  console.error(`  Output: ${result.outputSize} bytes`);
  console.error(`  Hidden elements: ${result.stats.hiddenElements}`);
  console.error(`  Script tags: ${result.stats.scriptTags}`);
  console.error(`  Style tags: ${result.stats.styleTags}`);
  console.error(`  Zero-width chars: ${result.stats.zeroWidthChars}`);
  console.error(`  LLM delimiters: ${result.stats.llmDelimiters}`);

  // Print sanitized content to stdout
  process.stdout.write(result.content);
}

export function runCli(command: string, args: string[]): void {
  if (command === 'init') {
    runInit(args);
  } else if (command === 'test') {
    runTest(args).catch((error) => {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
  }
}
