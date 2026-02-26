#!/usr/bin/env node

import { startServer } from './server.js';
import { runCli } from './cli.js';

const command = process.argv[2];

if (command === 'init' || command === 'test' || command === 'stats') {
  runCli(command, process.argv.slice(3));
} else {
  // Default: start MCP server (this is what npx safe-fetch invokes)
  startServer().catch((error) => {
    console.error('[safe-fetch] Fatal error:', error);
    process.exit(1);
  });
}
