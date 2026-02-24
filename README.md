# mcp-safe-fetch

Deterministic content sanitization MCP server for agentic coding tools. Strips prompt injection vectors from web-fetched content before it enters the LLM context.

Drop-in replacement for Claude Code's built-in `WebFetch` — exposes a `safe_fetch` tool that fetches URLs, sanitizes the HTML, and returns clean markdown.

## What it strips

- **Hidden HTML** — `display:none`, `visibility:hidden`, `opacity:0`, `[hidden]` attribute
- **Dangerous tags** — `<script>`, `<style>`, `<noscript>`, `<meta>`, `<link>`
- **HTML comments** — often used to inject instructions invisible to readers
- **Invisible unicode** — zero-width chars, soft hyphens, BOM, bidi overrides, variation selectors, tag characters
- **Control characters** — preserves `\n`, `\t`, `\r`, strips everything else
- **Fake LLM delimiters** — `<|im_start|>`, `[INST]`, `<<SYS>>`, `\n\nHuman:`, etc.
- **NFKC normalization** — collapses fullwidth and homoglyph characters

## Install

```bash
npx -y mcp-safe-fetch init
```

This configures Claude Code to use `safe_fetch` and deny the built-in `WebFetch`. Restart Claude Code after running.

## Usage

### As MCP server (automatic)

After `init`, Claude Code uses `safe_fetch` whenever it needs to read a URL. The sanitization header shows what was stripped:

```
[safe-fetch] Stripped: 5 hidden elements, 68 script tags, 3 style tags | 284127 → 12720 bytes (219ms)
```

### CLI

Test sanitization on any URL:

```bash
npx -y mcp-safe-fetch test <url>
```

Stats print to stderr, sanitized markdown to stdout.

### MCP tools

| Tool | Description |
|------|-------------|
| `safe_fetch` | Fetch a URL and return sanitized markdown |
| `sanitize_stats` | Show session sanitization statistics |

## Configuration

Optional. Create `.mcp-safe-fetch.json` in your project root or home directory:

```json
{
  "logStripped": true,
  "logFile": ".claude/sanitize.log"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `logStripped` | `false` | Log sanitization stats to file |
| `logFile` | `.claude/sanitize.log` | Log file path |

## How it works

1. Fetch URL with native `fetch` (from your machine, not Anthropic's servers)
2. Parse HTML with [cheerio](https://cheerio.js.org/) (htmlparser2 backend)
3. Strip hidden elements, dangerous tags, and comments
4. Convert to markdown with [turndown](https://github.com/mixmark-io/turndown)
5. Strip invisible unicode characters and normalize with NFKC
6. Strip fake LLM delimiter tokens

## License

MIT
