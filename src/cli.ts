import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchUrl } from './fetch.js';
import { sanitize } from './sanitize/pipeline.js';
import { loadConfig } from './config.js';
import { logSanitization, type LogEntry } from './logger.js';

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

const CLAUDE_DIR = join(process.env.HOME || '', '.claude');

function runInit(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const strict = args.includes('--strict');

  if (!dryRun && !existsSync(CLAUDE_DIR)) {
    console.error('Error: ~/.claude/ directory not found.');
    console.error('Install Claude Code first: https://docs.anthropic.com/en/docs/claude-code');
    process.exit(1);
  }

  const toolPerms: Record<string, string> = {
    WebFetch: 'deny',
    'mcp__safe-fetch__safe_fetch': 'allow',
    'mcp__safe-fetch__safe_read': 'allow',
    'mcp__safe-fetch__safe_exec': 'allow',
  };
  if (strict) {
    toolPerms['Read'] = 'deny';
    toolPerms['Bash'] = 'deny';
  }

  if (dryRun) {
    console.log('Would add to ~/.claude.json:');
    console.log(JSON.stringify({ mcpServers: { 'safe-fetch': MCP_CONFIG } }, null, 2));
    console.log('\nWould add to ~/.claude/settings.json:');
    console.log(JSON.stringify({ allowedTools: toolPerms }, null, 2));
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
  Object.assign(settings.allowedTools, toolPerms);
  writeJson(SETTINGS_PATH, settings);

  console.log('Updated ~/.claude.json:');
  console.log('  + mcpServers.safe-fetch (mcp-safe-fetch MCP server)');
  console.log('\nUpdated ~/.claude/settings.json:');
  for (const [tool, perm] of Object.entries(toolPerms)) {
    console.log(`  + allowedTools.${tool}: "${perm}"`);
  }
  console.log('\nRestart Claude Code to activate.');
}

async function runTest(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    console.error('Usage: mcp-safe-fetch test <url>');
    process.exit(1);
  }

  const config = loadConfig();

  console.error(`Fetching ${url}...`);
  const startTime = Date.now();

  const fetched = await fetchUrl(url);
  const result = sanitize(fetched.html, config);
  const durationMs = Date.now() - startTime;

  // Log if configured
  if (config.logStripped) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      tool: 'safe_fetch',
      source: url,
      stripped: result.stats,
      inputSize: result.inputSize,
      outputSize: result.outputSize,
      reductionPercent: Math.round((1 - result.outputSize / result.inputSize) * 1000) / 10,
      durationMs,
    };
    logSanitization(config.logFile, config.logMaxBytes, entry);
  }

  // Print stats to stderr
  console.error(`\nSanitization complete (${durationMs}ms):`);
  console.error(`  Input:  ${result.inputSize} bytes`);
  console.error(`  Output: ${result.outputSize} bytes`);
  console.error(`  Hidden elements: ${result.stats.hiddenElements}`);
  console.error(`  Script tags: ${result.stats.scriptTags}`);
  console.error(`  Style tags: ${result.stats.styleTags}`);
  console.error(`  Zero-width chars: ${result.stats.zeroWidthChars}`);
  console.error(`  Base64 payloads: ${result.stats.base64Payloads}`);
  console.error(`  Data URIs: ${result.stats.dataUris}`);
  console.error(`  Off-screen elements: ${result.stats.offScreenElements}`);
  console.error(`  Same-color text: ${result.stats.sameColorText}`);
  console.error(`  LLM delimiters: ${result.stats.llmDelimiters}`);

  // Print sanitized content to stdout
  process.stdout.write(result.content);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatStatKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function runStats(): void {
  const config = loadConfig();

  if (!existsSync(config.logFile)) {
    console.log('No sanitization logs found.');
    console.log(`Expected log file: ${config.logFile}`);
    console.log('Enable logging: set "logStripped": true in .mcp-safe-fetch.json');
    return;
  }

  const raw = readFileSync(config.logFile, 'utf-8').trim();
  if (!raw) {
    console.log('Log file is empty.');
    return;
  }

  const entries: LogEntry[] = raw.split('\n').map(l => JSON.parse(l));
  const total = entries.length;
  const totalInput = entries.reduce((s, e) => s + e.inputSize, 0);
  const totalOutput = entries.reduce((s, e) => s + e.outputSize, 0);
  const avgMs = Math.round(entries.reduce((s, e) => s + e.durationMs, 0) / total);

  // Aggregate stripped counts
  const stripped: Record<string, number> = {};
  for (const entry of entries) {
    for (const [key, val] of Object.entries(entry.stripped)) {
      stripped[key] = (stripped[key] || 0) + (val as number);
    }
  }

  console.log(`\n  mcp-safe-fetch stats (${total} requests)\n`);
  console.log(`  Total input:   ${formatBytes(totalInput)}`);
  console.log(`  Total output:  ${formatBytes(totalOutput)}`);
  console.log(`  Avg reduction: ${total > 0 ? Math.round((1 - totalOutput / totalInput) * 100) : 0}%`);
  console.log(`  Avg duration:  ${avgMs}ms\n`);

  const hasStripped = Object.values(stripped).some(v => v > 0);
  if (hasStripped) {
    console.log('  Stripped:');
    for (const [key, val] of Object.entries(stripped)) {
      if (val > 0) console.log(`    ${formatStatKey(key)}: ${val}`);
    }
    console.log();
  }

  console.log('  Recent:');
  for (const e of entries.slice(-5)) {
    const tool = e.tool || 'safe_fetch';
    const source = e.source || (e as any).url || '?';
    console.log(`    ${e.timestamp.slice(0, 19).replace('T', ' ')}  [${tool}] ${source}`);
  }
  console.log();
}

export function runCli(command: string, args: string[]): void {
  if (command === 'init') {
    runInit(args);
  } else if (command === 'test') {
    runTest(args).catch((error) => {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
  } else if (command === 'stats') {
    runStats();
  }
}
