import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { registerTools } from "./tools.js";

/** Build a fresh, stateless MCP server instance for each incoming request. */
function createServer(): McpServer {
  const server = new McpServer({
    name: "learn-mcp-step-02",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

// Created once at module scope; createServer runs fresh per request with no shared mutable state.
// Bindings (such as env.NOTES) are read inside tool handlers via `import { env } from "cloudflare:workers"`.
const mcpHandler = createMcpHandler(createServer, {
  onerror(error) {
    console.error(
      JSON.stringify({
        event: "mcp_handler_error",
        message: error.message,
      }),
    );
  },
});

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    // Expose a simple non-MCP health probe for quick deployment smoke checks.
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "learn-mcp-step-02",
        status: "ok",
        mcpEndpoint: "/mcp",
        storage: "Workers KV (NOTES)",
      });
    }

    return mcpHandler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
