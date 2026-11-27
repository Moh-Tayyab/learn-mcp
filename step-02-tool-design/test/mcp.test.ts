/**
 * Step 02 integration tests — Stockroom notes toolset over Workers KV.
 *
 * Runs inside workerd via @cloudflare/vitest-plugin with an isolated KV binding.
 * Tests follow the MCP 2026-07-28 HTTP envelope and verify CRUD, validation,
 * annotations, recoverable errors, and category filtering.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

async function mcpPost<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: JsonRpcResponse<T> }> {
  const headers: Record<string, string> = {
    Host: "localhost",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
  };

  if (
    (method === "tools/call" ||
      method === "prompts/get" ||
      method === "resources/read") &&
    typeof params.name === "string"
  ) {
    headers["Mcp-Name"] = params.name;
  }

  const response = await SELF.fetch("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });

  const body = (await response.json()) as JsonRpcResponse<T>;
  return { status: response.status, body };
}

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const { status, body } = await mcpPost<ToolCallResult>("tools/call", {
    name,
    arguments: args,
  });
  expect(status).toBe(200);
  expect(body.error).toBeUndefined();
  expect(body.result).toBeDefined();
  return body.result!;
}

describe("Step 02: Stockroom Notes MCP server", () => {
  it("exposes health status on GET /", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { name: string; status: string };
    expect(json.name).toBe("learn-mcp-step-02");
    expect(json.status).toBe("ok");
  });

  it("lists all four notes tools with output schemas and complete annotations", async () => {
    const { status, body } = await mcpPost<{ tools: ListedTool[] }>(
      "tools/list",
    );
    expect(status).toBe(200);
    const tools = body.result?.tools ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_note",
      "delete_note",
      "get_note",
      "list_notes",
    ]);

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.title).toBeTruthy();
      expect(tool.annotations?.openWorldHint).toBe(false);
    }

    expect(byName.list_notes.annotations?.readOnlyHint).toBe(true);
    expect(byName.list_notes.annotations?.destructiveHint).toBe(false);
    expect(byName.get_note.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_note.annotations?.destructiveHint).toBe(false);
    expect(byName.create_note.annotations?.readOnlyHint).toBe(false);
    expect(byName.create_note.annotations?.destructiveHint).toBe(false);
    expect(byName.delete_note.annotations?.readOnlyHint).toBe(false);
    expect(byName.delete_note.annotations?.destructiveHint).toBe(true);
  });

  it("creates, lists, reads, filters by category, and deletes notes via Workers KV", async () => {
    const createdCall = await callTool("create_note", {
      title: "Karachi Foods call",
      body: "Spoke with Ali at Karachi Foods; send updated Friday price list.",
      category: "call",
    });
    expect(createdCall.isError).toBeFalsy();
    const callData = createdCall.structuredContent as {
      id: string;
      title: string;
      category: string;
    };
    expect(callData.category).toBe("call");

    const createdOrder = await callTool("create_note", {
      title: "Lahore Mart order",
      body: "Confirmed 40 cases of cooking oil for Monday dispatch.",
      category: "order",
    });
    expect(createdOrder.isError).toBeFalsy();
    const orderData = createdOrder.structuredContent as { id: string };

    // Read full note
    const fetched = await callTool("get_note", { id: callData.id });
    expect(fetched.isError).toBeFalsy();
    expect(fetched.structuredContent).toMatchObject({
      id: callData.id,
      title: "Karachi Foods call",
      category: "call",
    });

    // Category filter returns only matching notes
    const callsOnly = await callTool("list_notes", { category: "call" });
    const filteredNotes = (
      callsOnly.structuredContent as {
        notes: Array<{ id: string; category: string }>;
      }
    ).notes;
    expect(filteredNotes.some((n) => n.id === callData.id)).toBe(true);
    expect(filteredNotes.some((n) => n.id === orderData.id)).toBe(false);

    // Delete note and confirm subsequent lookup gives a recoverable error
    const deleted = await callTool("delete_note", { id: callData.id });
    expect(deleted.isError).toBeFalsy();
    expect(deleted.structuredContent).toEqual({
      deleted: true,
      id: callData.id,
    });

    const missingAfterDelete = await callTool("get_note", { id: callData.id });
    expect(missingAfterDelete.isError).toBe(true);
    expect(missingAfterDelete.content[0]?.text).toContain("list_notes");
  });

  it("returns recoverable errors for missing notes and rejects invalid note IDs", async () => {
    const missingGet = await callTool("get_note", { id: "missing-note-123" });
    expect(missingGet.isError).toBe(true);
    expect(missingGet.content[0]?.text).toMatch(/not found/i);

    const missingDelete = await callTool("delete_note", {
      id: "missing-note-123",
    });
    expect(missingDelete.isError).toBe(true);
    expect(missingDelete.content[0]?.text).toContain("list_notes");

    // Path traversal / key-injection characters are rejected by Zod schema
    const invalidId = await callTool("get_note", { id: "../secret:key" });
    expect(invalidId.isError).toBe(true);
  });

  it("supports cursor pagination on list_notes and legacy 2025 stateless initialize/tools calls", async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await callTool("create_note", {
        title: `Account follow-up ${i}`,
        body: `Details for account ${i}`,
        category: "follow_up",
      });
      expect(res.isError).toBeFalsy();
    }

    const page1 = await callTool("list_notes", { limit: 2 });
    const p1 = page1.structuredContent as {
      notes: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(p1.notes).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).toBeTruthy();

    const page2 = await callTool("list_notes", {
      limit: 2,
      cursor: p1.nextCursor!,
    });
    const p2 = page2.structuredContent as {
      notes: Array<{ id: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    };
    expect(p2.notes.length).toBeGreaterThanOrEqual(1);
    const seen = new Set([
      ...p1.notes.map((n) => n.id),
      ...p2.notes.map((n) => n.id),
    ]);
    expect(seen.size).toBe(p1.notes.length + p2.notes.length);

    // Legacy 2025 stateless client (no MCP-Protocol-Version header / no _meta envelope)
    const initRes = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: {
        Host: "localhost",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "legacy-client", version: "1.0.0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initText = await initRes.text();
    expect(initText).toContain("learn-mcp-step-02");
  });
});
