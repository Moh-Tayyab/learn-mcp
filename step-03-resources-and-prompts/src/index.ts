import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

/** Build a fresh, stateless MCP server instance for each incoming request. */
function createServer(onResourceListChanged: () => void): McpServer {
  const server = new McpServer({
    name: "learn-mcp-step-03",
    version: "0.1.0",
  });
  registerTools(server, onResourceListChanged);
  registerResources(server);
  registerPrompts(server);
  return server;
}

// Created once at module scope so `mcpHandler.notify` is shared across requests on this isolate,
// while `createServer` builds a fresh McpServer per request with no shared mutable state.
const mcpHandler: ReturnType<typeof createMcpHandler> = createMcpHandler(
  () => createServer(() => mcpHandler.notify.resourcesChanged()),
  {
    onerror(error) {
      console.error(
        JSON.stringify({
          event: "mcp_handler_error",
          message: error.message,
        }),
      );
    },
  },
);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    // Expose a simple non-MCP health probe for quick deployment smoke checks.
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "learn-mcp-step-03",
        status: "ok",
        mcpEndpoint: "/mcp",
        storage: "Workers KV (NOTES)",
        primitives: ["tools", "resources", "prompts"],
      });
    }

    return mcpHandler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
