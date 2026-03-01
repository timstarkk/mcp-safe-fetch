import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PipelineStats } from './sanitize/pipeline.js';

export interface LogEntry {
  timestamp: string;
  tool: 'safe_fetch' | 'safe_read' | 'safe_exec';
  source: string;
  description?: string;
  stripped: PipelineStats;
  inputSize: number;
  outputSize: number;
  reductionPercent: number;
  durationMs: number;
}

function rotateIfNeeded(logFile: string, maxBytes: number): void {
  try {
    const size = statSync(logFile).size;
    if (size >= maxBytes) {
      renameSync(logFile, logFile + '.old');
    }
  } catch {
    // File doesn't exist yet, nothing to rotate
  }
}

export function logSanitization(logFile: string, maxBytes: number, entry: LogEntry): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    rotateIfNeeded(logFile, maxBytes);
    appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    console.error(`[safe-fetch] Failed to write log to ${logFile}`);
  }
}
