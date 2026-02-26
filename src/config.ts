import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SanitizeConfig {
  logStripped: boolean;
  logFile: string;
  logMaxBytes: number;
  allowDataUris: boolean;
  maxBase64DecodeLength: number;
  customPatterns: string[];
}

const DEFAULT_CONFIG: SanitizeConfig = {
  logStripped: false,
  logFile: '.claude/sanitize.log',
  logMaxBytes: 10 * 1024 * 1024, // 10MB
  allowDataUris: false,
  maxBase64DecodeLength: 500,
  customPatterns: [],
};

export function loadConfig(): SanitizeConfig {
  const paths = [
    join(process.cwd(), '.mcp-safe-fetch.json'),
    join(process.env.HOME || '', '.mcp-safe-fetch.json'),
  ];

  for (const configPath of paths) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_CONFIG, ...parsed };
      } catch {
        // Invalid config, use defaults
      }
    }
  }

  return DEFAULT_CONFIG;
}
