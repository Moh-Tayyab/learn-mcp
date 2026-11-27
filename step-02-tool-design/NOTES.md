# Step 02: Designing Good Tools

**Live `/mcp` URL:** `https://learn-mcp-step-02.moh-tayyab.workers.dev/mcp`

## What Was Built

Refactored the Step 01 server into a Stockroom account-notes MCP server (`learn-mcp-step-02`) backed by Cloudflare Workers KV (`NOTES` binding, namespace `76dc3a0460524a9da34b6f5180c5767a`).

### Notes Toolset (`src/tools.ts`)

Each tool has a single clear responsibility, strict Zod 4 input/output schemas (`outputSchema` + `structuredContent` + concise `content[].text`), complete annotations (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), and recoverable `{ isError: true }` errors:

- `list_notes` (`readOnlyHint: true`, `destructiveHint: false`): paginated summary listing of note IDs, titles, categories, and creation timestamps from Workers KV metadata without pulling full note bodies. Supports optional `category` filter (`call`, `follow_up`, `order`, `general`), `limit` (`1..50`, default `20`), and `cursor`.
- `get_note` (`readOnlyHint: true`, `destructiveHint: false`): fetches the full note body by ID (validated against `/^[A-Za-z0-9_-]+$/`). Returns a recoverable error directing the model to `list_notes` when the ID does not exist.
- `create_note` (`readOnlyHint: false`, `destructiveHint: false`): validates `title` (`1..100`), `body` (`1..2000`), and `category` enum, generates a UUID, stores JSON in KV with summary metadata, and returns the created ID.
- `delete_note` (`readOnlyHint: false`, `destructiveHint: true`): verifies the note exists and permanently removes it from KV, returning a recoverable error when missing.

### Design Choices & Key Takeaways

1. **Why Workers KV instead of in-memory storage:** Cloudflare Workers may execute consecutive tool calls across different isolates or colos. An in-memory `Map` or array vanishes whenever Cloudflare routes the next call to another isolate or evicts an idle instance. Workers KV (`env.NOTES`, accessed inside handlers via `import { env } from "cloudflare:workers"` alongside module-level `createMcpHandler`) shares notes across all isolates. KV is eventually consistent (changes can take up to ~60 seconds across regions), which fits account notes here before moving business data to Neon Postgres in Step 05.
2. **How Claude and ChatGPT use annotations:** `readOnlyHint: true` lets clients like Claude and ChatGPT treat reads (`list_notes`, `get_note`) as low-risk lookups, whereas `destructiveHint: true` on `delete_note` signals hosts to require explicit user confirmation before permanently removing data.
3. **Bad vs. good comparison:** See [`TOOL-DESIGN-COMPARISON.md`](TOOL-DESIGN-COMPARISON.md) and [`src/tools-bad.ts`](src/tools-bad.ts) for a side-by-side comparison showing why focused single-intent tools with descriptions, enums, and output schemas outperform an overloaded `manage_data` tool.

## Verification

- `npm run typecheck` (`wrangler types && tsc && tsc -p test/tsconfig.json`): clean pass.
- `npm test` (`vitest run` via `@cloudflare/vitest-plugin` in `workerd`): 5/5 tests pass covering health check, tool schemas/annotations, CRUD + category filter lifecycle, invalid/missing ID recoverable errors, cursor pagination, and legacy 2025 client `initialize`.

## Commands

Run from `step-02-tool-design/`:

```bash
npm ci                # Install pinned dependencies
npm run typecheck     # wrangler types && tsc && tsc -p test/tsconfig.json
npm test              # Vitest in the Cloudflare Workers runtime
npm run dev           # Local Worker at http://localhost:8787/mcp
npm run deploy        # Deploy learn-mcp-step-02 to *.workers.dev
```

## Testing Prompts for Claude and ChatGPT

Connect `https://learn-mcp-step-02.moh-tayyab.workers.dev/mcp` (Authentication: **No sign-in** in Claude / **No authentication** in ChatGPT), then try these five prompts in order:

1. **Create a call note (`create_note`):**
   > `Save a Stockroom call note titled "Karachi Foods price list" under category "call": "Called Ali at Karachi Foods; send updated Friday cooking oil price list."`
2. **Create an order note (`create_note`):**
   > `Add an order note titled "Lahore Mart Q4 dispatch" with category "order": "Confirmed 40 cases of cooking oil for Monday delivery."`
3. **List and filter notes (`list_notes`):**
   > `List only my "call" notes in Stockroom.`
4. **Read a specific note (`get_note`) & test recoverable error (`get_note`):**
   > `Show the full body of the "Karachi Foods price list" note, and also try reading a note with ID "missing-note-check" to show how the server reports missing notes.`
5. **Delete a note (`delete_note`):**
   > `Delete the "Lahore Mart Q4 dispatch" note permanently, then list all remaining notes.`

Save screenshots showing the model picking the right tools as `step-02-tool-design/claude.png` and `step-02-tool-design/chatgpt.png`.
