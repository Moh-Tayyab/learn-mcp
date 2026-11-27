# Step 01: Hello World Remote MCP Server

**Live `/mcp` URL:** `https://learn-mcp-step-01.moh-tayyab.workers.dev/mcp`

## What Was Built

A stateless remote MCP server (`learn-mcp-step-01`) on Cloudflare Workers serving Streamable HTTP at `/mcp` (plus a `GET /` health probe).

- `src/index.ts` creates `createMcpHandler` (`agents/mcp/server`) once at module level and passes a `createServer` factory that builds a fresh `McpServer` (`@modelcontextprotocol/server@2.4.0`) for every incoming request.
- `src/tools.ts` registers two read-only tools (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`) with Zod 4 input/output schemas and structured content:
  - `greet`: requires a trimmed non-empty `name` string (`1..100` chars) and returns a greeting.
  - `get_time`: accepts an optional IANA `timezone` (defaults to `UTC`) and returns a recoverable MCP error (`isError: true`) when an invalid timezone is supplied.
- `wrangler.jsonc` targets `compatibility_date: "2026-11-27"` (Node.js compatibility enabled by default since `2026-08-04`, so no `nodejs_compat` flag is needed) with structured Workers logs enabled.
- `tsconfig.json` pins TypeScript 7 (`7.0.2`) for `noEmit` type-checking with `moduleResolution: "bundler"`, `isolatedModules: true`, `./worker-configuration.d.ts`, and `node` (`@types/node`).
- `test/mcp.test.ts` runs inside the Workers runtime (`@cloudflare/vitest-plugin` + Vitest 4) and sends 20 concurrent `tools/call` requests to `greet` alongside `tools/list` and `get_time` checks.

### Why `McpServer` Must Be Created Per Request (Not at Module Scope)

`createMcpHandler` binds each incoming request to a fresh single-use transport (`PerRequestHTTPServerTransport` / `WebStandardStreamableHTTPServerTransport`). If a single `McpServer` instance were created once at module level:

1. Connecting a second concurrent request to the same `McpServer` fails (`assertNotServing` rejects reuse of a server whose transport is already attached, or throws `"Already connected to a transport"`).
2. Request-scoped auth context, capabilities (`2026-07-28` `_meta` envelope), and any per-request state or tool filtering (starting in Step 04) would leak or collide across simultaneous callers.

## Commands

Run from `step-01-hello-world/`:

```bash
npm install
npm run typecheck   # wrangler types && tsc && tsc -p test/tsconfig.json
npm test            # Vitest in the Cloudflare Workers runtime
npm run dev         # Local Worker at http://localhost:8787/mcp
npm run deploy      # Deploy learn-mcp-step-01 to *.workers.dev
```

### Local Inspection with MCP Inspector

Start the local Worker in one terminal:

```bash
npm run dev
```

Then start the MCP Inspector in another terminal and connect to `http://localhost:8787/mcp` (Streamable HTTP transport):

```bash
npx @modelcontextprotocol/inspector
```

## Connecting Clients

### Claude (`claude.ai` or Claude Desktop)

1. Open **Settings → Connectors** and click **+ Add custom connector**.
2. Name: `Stockroom Hello World`, URL: `https://learn-mcp-step-01.moh-tayyab.workers.dev/mcp`, Authentication: **No sign-in**.
3. Enable the connector in a new chat, test `greet` and `get_time`, and save the screenshot as `step-01-hello-world/claude.png`.

### ChatGPT

1. Open **Plugins → + → Add custom MCP server**.
2. Name: `Stockroom Hello World`, Connection URL: `https://learn-mcp-step-01.moh-tayyab.workers.dev/mcp`, Authentication: **No authentication** (Step 01 does not expose OAuth discovery yet; OAuth is added in Step 04).
3. Check **I understand and want to continue**, create and install the plugin, test with `@Stockroom Hello World`, and save the screenshot as `step-01-hello-world/chatgpt.png`.
