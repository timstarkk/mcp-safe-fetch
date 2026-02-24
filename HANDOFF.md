# claude-sanitize v0.1 — Implementation Handoff

## What is this?

A deterministic content sanitization MCP server. `npx claude-sanitize` starts an MCP server that exposes a `safe_fetch` tool — fetches URLs, strips prompt injection vectors (hidden HTML, zero-width unicode, fake LLM delimiters), returns clean markdown. Replaces the built-in `WebFetch` tool.

## Project location

`~/code/claude-sanitize` — greenfield, nothing built yet.

## The plan

`~/.claude/thoughts/plans/2026-02-24-claude-sanitize-v0.1.md`

Read this file. It contains the full implementation plan with concrete code for every file. 7 phases, build bottom-up:

1. **Scaffold** — package.json, tsconfig, deps
2. **Sanitization modules** — `src/sanitize/html.ts`, `unicode.ts`, `delimiters.ts`
3. **Pipeline + infra** — `pipeline.ts`, `fetch.ts`, `config.ts`, `logger.ts`
4. **MCP server** — `server.ts` with `safe_fetch` + `sanitize_stats` tools, `index.ts` entry point
5. **CLI** — `init`, `init --dry-run`, `test <url>`
6. **Tests** — 6 HTML fixtures + unit tests + integration tests
7. **Publish prep** — verify everything works end-to-end

## Key technical decisions already made

- **MCP server, not hooks** — PostToolUse can't modify built-in tool output
- **`@modelcontextprotocol/sdk`** v1.27.0 — use `server.registerTool()` (not `server.tool()`), flat Zod input schemas `{ key: z.type() }`, returns `{ content: [{ type: "text", text }] }`
- **`cheerio/slim`** import — uses htmlparser2 backend, no parse5
- **`turndown`** v7.2.2 — needs `@types/turndown`, use `preformattedCode: true`
- **ESM** — `"type": "module"`, `"module": "NodeNext"` in tsconfig, `.js` extensions on all imports
- **`console.error()` only** in MCP server — `console.log()` corrupts stdio JSON-RPC
- **Shebang** `#!/usr/bin/env node` on `src/index.ts`

## Background docs

- Idea doc: `/Users/tim/Documents/Obsidian/MacVault/~/ideas/claude-sanitize.md`
- Research doc: `~/.claude/thoughts/research/claude-sanitize-v0.1.md`

## What to do

Run `/implement_plan ~/.claude/thoughts/plans/2026-02-24-claude-sanitize-v0.1.md` and execute all 7 phases in order. Each phase has success criteria — verify before moving to the next.
