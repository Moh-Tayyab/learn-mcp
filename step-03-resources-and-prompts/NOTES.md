# Step 03: Resources and Prompts

**Live `/mcp` URL:** `https://learn-mcp-step-03.moh-tayyab.workers.dev/mcp`

## What Was Built

Extended the Stockroom notes server (`learn-mcp-step-03`, backed by Workers KV namespace `270dfb54a7374a6e99b430e72cc98077` bound as `NOTES`) to expose all three MCP server primitives cleanly on one stateless `createMcpHandler` endpoint:

- **Tools (`src/tools.ts`):** kept `list_notes`, `get_note`, `create_note`, and `delete_note` backed by shared storage helpers in [`src/notes-store.ts`](src/notes-store.ts). Mutations notify the module-scope handler via `mcpHandler.notify.resourcesChanged()`.
- **Resources (`src/resources.ts`):** registered dynamic `ResourceTemplate("note://{id}")` so `resources/templates/list` advertises `note://{id}`, `resources/list` enumerates all stored notes, `completion/complete` autocompletes note IDs, and `resources/read` returns markdown note contents (or `-32002` `ResourceNotFoundError` when missing).
- **Prompts (`src/prompts.ts`):** registered `summarize_notes` with an optional `tag` argument (matching Stockroom categories `call`, `follow_up`, `order`, `general` or any free-text topic) instructing the model to combine attached `note://{id}` resources with `list_notes` and `get_note`.

## The Three MCP Primitives & Who Controls Each

| Primitive | Who chooses / triggers it | Role in Stockroom Notes |
| --- | --- | --- |
| **Tools** (`list_notes`, `get_note`, `create_note`, `delete_note`) | **The model** (at runtime) | Model-driven search, reads, and writes with Zod validation and safety annotations |
| **Resources** (`note://{id}`) | **The host application or user** | Read-only reference records that a user or host UI can browse and attach directly to context |
| **Prompts** (`summarize_notes`) | **The user** (slash menu / picker) | Explicit, user-initiated template for a repeatable weekly briefing |

## Why `handler.notify.resourcesChanged()` Is Isolate-Local

In `src/index.ts`, `mcpHandler` uses the default `InMemoryServerEventBus` from `@modelcontextprotocol/server`. When `create_note` or `delete_note` calls `mcpHandler.notify.resourcesChanged()`, the SDK publishes `notifications/resources/list_changed` only to active `subscriptions/listen` streams connected to that exact Worker isolate instance. Requests routed to other Cloudflare edge colos or isolates do not receive in-memory notifications. For Step 03's account-notes demo this is fine because clients still fetch fresh state on the next `resources/list` call; cross-isolate event delivery is addressed when moving to Durable Objects / shared pub-sub later in the bootcamp.

## Why MCP Prompts Are Rarely Used Today (vs. Skills over MCP in Step 10)

Prompts still exist in MCP `2026-07-28`, but in practice most servers replace them with **Skills (`skill://` resources, Step 10)**:

1. **Who picks it:** Prompts wait for a **person** to manually select a command from a menu; Skills let **the model** discover concise summaries upfront and load the exact procedural SOP on demand when the user's intent matches.
2. **When it loads:** Prompts inject an entire rigid user message before work starts; Skills use progressive disclosure — tiny metadata in discovery, full workflow loaded from a `skill://` resource only when needed.
3. **Cross-client portability:** Many host UIs (including several web/custom connector surfaces) focus primarily on **tools** (and selectively resources), leaving prompts hidden or inconsistent, whereas Skills built over standard tools/resources work uniformly across Claude, ChatGPT, and agent runtimes.

## Server Architecture Audit: Tool, Resource, or Prompt?

| Feature | Current Primitive | Right choice? | Notes / Future move |
| --- | --- | --- | --- |
| Save / delete a note (`create_note`, `delete_note`) | **Tool** | Yes | Mutates state in KV; requires Zod validation + `destructiveHint` |
| Filtered paginated lookup (`list_notes`, `get_note`) | **Tool** | Yes | Model passes filters/cursors dynamically; cannot be replaced cleanly by a static URI list |
| Direct account note lookup (`note://{id}`) | **Resource template** | Yes | Clean read-only URI addressing; lets users/hosts attach a specific note explicitly |
| Weekly briefing template (`summarize_notes`) | **Prompt** | For Step 03 only | Moves to a reusable **Skill over MCP (`skill://`)** in Step 10 so the model invokes it automatically without menu hunting |

## Commands & Client Testing

Run from `step-03-resources-and-prompts/`:

```bash
npm ci
npm run typecheck     # wrangler types && tsc && tsc -p test/tsconfig.json
npm test              # Vitest inside Cloudflare workerd runtime
npm run dev           # Local Worker at http://localhost:8787/mcp
npm run deploy        # Deploy learn-mcp-step-03 to *.workers.dev
```

### Testing in Claude, ChatGPT, and MCP Inspector

- **MCP Inspector** (guaranteed full visibility for `resources/list`, `resources/templates/list`, `resources/read`, and `prompts/get`):
  ```bash
  npx @modelcontextprotocol/inspector
  ```
  Connect via **Streamable HTTP** to `https://learn-mcp-step-03.moh-tayyab.workers.dev/mcp` (or `http://localhost:8787/mcp`), create a note in **Tools**, list/read `note://<id>` in **Resources**, and expand `summarize_notes` in **Prompts**.
- **Claude (`claude.ai` / Claude Desktop):** Connect **`Stockroom Resources`** (`https://learn-mcp-step-03.moh-tayyab.workers.dev/mcp`, No sign-in). Use the chat `+` attachment menu to inspect/attach `note://<id>` resources and trigger `summarize_notes` if exposed by your client build, or test via tools (`create_note`, then ask Claude to summarize notes).
- **ChatGPT (custom MCP server):** Add **`Stockroom Resources`** (`https://learn-mcp-step-03.moh-tayyab.workers.dev/mcp`, No authentication). Note: ChatGPT's custom MCP connector surface currently exposes **Tools** natively in chat and does not surface MCP Prompts or clickable Resource pickers in its web UI — verify Tools (`create_note` returning `note://{id}`) in ChatGPT and capture MCP Inspector for Resources/Prompts if the web client hides them.
