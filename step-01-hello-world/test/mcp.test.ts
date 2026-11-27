import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function callMcp(
  method: string,
  params: Record<string, unknown>,
  id: number | string,
): Promise<{ status: number; body: JsonRpcResponse }> {
  const headers: Record<string, string> = {
    Host: "localhost",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
  };
  if (typeof params.name === "string") {
    headers["Mcp-Name"] = params.name;
  }

  const response = await exports.default.fetch("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "step-01-vitest",
            version: "0.1.0",
          },
        },
      },
    }),
  });

  const body = (await response.json()) as JsonRpcResponse;
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return { status: response.status, body };
}

describe("learn-mcp-step-01 remote MCP server", () => {
  it("responds on GET / health route and returns 404 on unknown paths", async () => {
    const health = await exports.default.fetch("http://localhost/");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      name: "learn-mcp-step-01",
      status: "ok",
      mcpEndpoint: "/mcp",
    });

    const missing = await exports.default.fetch("http://localhost/unknown");
    expect(missing.status).toBe(404);
  });

  it("lists greet and get_time tools with read-only annotations", async () => {
    const { status, body } = await callMcp("tools/list", {}, 1);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();

    const tools = body.result?.tools as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }>;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_time", "greet"]);

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });

  it("handles 20 concurrent greet calls without leaking state between requests", async () => {
    const names = Array.from({ length: 20 }, (_, idx) => `StockroomUser-${idx + 1}`);

    const responses = await Promise.all(
      names.map((name, idx) =>
        callMcp("tools/call", { name: "greet", arguments: { name } }, idx + 100),
      ),
    );

    responses.forEach(({ status, body }, idx) => {
      const expectedName = names[idx]!;
      expect(status).toBe(200);
      expect(body.error).toBeUndefined();

      const result = body.result as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
        structuredContent?: { greeting: string; name: string };
      };

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.name).toBe(expectedName);
      expect(result.content[0]?.text).toContain(expectedName);
    });
  });

  it("formats time for valid timezones and returns a recoverable error for invalid ones", async () => {
    const utcCall = await callMcp("tools/call", { name: "get_time", arguments: {} }, 201);
    expect(utcCall.status).toBe(200);
    const utcResult = utcCall.body.result as {
      isError?: boolean;
      structuredContent?: { timezone: string; iso: string; formatted: string };
    };
    expect(utcResult.isError).not.toBe(true);
    expect(utcResult.structuredContent?.timezone).toBe("UTC");
    expect(Number.isNaN(Date.parse(utcResult.structuredContent?.iso ?? ""))).toBe(false);

    const khiCall = await callMcp(
      "tools/call",
      { name: "get_time", arguments: { timezone: "Asia/Karachi" } },
      202,
    );
    expect(khiCall.status).toBe(200);
    const khiResult = khiCall.body.result as {
      isError?: boolean;
      structuredContent?: { timezone: string };
    };
    expect(khiResult.isError).not.toBe(true);
    expect(khiResult.structuredContent?.timezone).toBe("Asia/Karachi");

    const badCall = await callMcp(
      "tools/call",
      { name: "get_time", arguments: { timezone: "Mars/Olympus" } },
      203,
    );
    expect(badCall.status).toBe(200);
    const badResult = badCall.body.result as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(badResult.isError).toBe(true);
    expect(badResult.content[0]?.text).toContain("Invalid IANA timezone");
  });
});
