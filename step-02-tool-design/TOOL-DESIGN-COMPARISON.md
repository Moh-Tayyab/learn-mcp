# Tool Design Comparison: Bad vs. Good (`manage_data` vs. Stockroom Notes Toolset)

This comparison contrasts [`src/tools-bad.ts`](src/tools-bad.ts) (an intentionally flawed single-tool design) against [`src/tools.ts`](src/tools.ts) (the deployed Stockroom notes toolset) to explain why tool design determines whether Claude and ChatGPT call the right tool on the first try.

## Side-by-side summary

| Dimension | Bad design (`tools-bad.ts`) | Good design (`tools.ts`) |
| --- | --- | --- |
| **Tool surface** | One overloaded tool (`manage_data`) | Four intent-specific tools (`list_notes`, `get_note`, `create_note`, `delete_note`) |
| **Descriptions** | Empty string (`""`) | Explains what the tool does, what it returns, when to use sibling tools, and avoids prompt-injection phrasing |
| **Input schemas** | Free string `action` + unconstrained `z.any()` `payload` | Strict `z.object(...)` with `.trim().min().max()`, ID regex (`/^[A-Za-z0-9_-]+$/`), pagination bounds (`1–50`), and `z.enum(["call", "follow_up", "order", "general"])` |
| **Annotations** | None (host assumes worst-case side effects) | Explicit `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` on every tool |
| **Outputs** | Untyped prose string (`"did delete with ..."`) | Concise human-readable `content[].text` paired with `outputSchema` + `structuredContent` |
| **Errors** | No existence/format checks; opaque response or throw | Clear, recoverable `{ isError: true }` messages pointing to the next tool (`list_notes`, `create_note`) |
| **Persistence** | None / unsafe in-memory assumptions | Shared Workers KV (`env.NOTES`) so any Worker isolate serves consistent note state |

## Why the good version gets called correctly more often

1. **Models choose from names, descriptions, and schemas alone.** The LLM never reads TypeScript implementation code. In `manage_data`, the model has to guess valid `action` strings (`"delete"` vs `"remove"` vs `"erase"`) and the keys inside `payload`. With `create_note`, `list_notes`, `get_note`, and `delete_note`, each schema spells out exact field names, lengths, and valid `category` enum values.
2. **Read/write separation enables safe host UX.** Marking `list_notes` and `get_note` as `readOnlyHint: true, destructiveHint: false` allows hosts like Claude to inspect notes with minimal friction, while `delete_note` (`destructiveHint: true`) signals that host clients should ask the user for confirmation before deleting data. Mixing read and write into a single tool also violates connector review criteria.
3. **Structured output prevents fragile parsing.** Returning `structuredContent` validated by `outputSchema` alongside `text` gives both models and future MCP Apps widgets typed fields (`id`, `category`, `nextCursor`, `hasMore`) without regex-parsing prose.
4. **Recoverable errors keep multi-step tasks moving.** When `get_note` or `delete_note` receives an unknown ID, it returns `isError: true` with a hint to call `list_notes` rather than throwing a transport-level 500 error.
5. **Workers KV replaces brittle in-memory variables.** Cloudflare Workers runs statelessly across isolates. Any `Map` in module memory disappears between isolates or restarts, whereas `env.NOTES` in Workers KV shares notes across every request (with KV's eventual-consistency tradeoff of up to ~60s across regions, acceptable for demo notes before moving business records to Neon Postgres in Step 05).
