import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PipelineStats } from './sanitize/pipeline.js';

export interface LogEntry {
  timestamp: string;
  url: string;
  stripped: PipelineStats;
  inputSize: number;
  outputSize: number;
  reductionPercent: number;
  durationMs: number;
}

export function logSanitization(logFile: string, entry: LogEntry): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    console.error(`[safe-fetch] Failed to write log to ${logFile}`);
  }
}
