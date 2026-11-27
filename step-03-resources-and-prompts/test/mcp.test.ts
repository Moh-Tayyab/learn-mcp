/**
 * Step 03 integration tests — Tools, Resources (note://{id}), Prompts (summarize_notes),
 * and resource list-changed notifications inside workerd via @cloudflare/vitest-plugin.
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
    (method === "tools/call" || method === "prompts/get") &&
    typeof params.name === "string"
  ) {
    headers["Mcp-Name"] = params.name;
  } else if (method === "resources/read" && typeof params.uri === "string") {
    headers["Mcp-Name"] = params.uri;
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

describe("Step 03: Stockroom Notes — Tools, Resources & Prompts", () => {
  it("exposes health status and advertises tools, resources, and prompts capabilities", async () => {
    const res = await SELF.fetch("http://localhost/");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      name: string;
      status: string;
      primitives: string[];
    };
    expect(json.name).toBe("learn-mcp-step-03");
    expect(json.status).toBe("ok");
    expect(json.primitives).toEqual(["tools", "resources", "prompts"]);

    const { status, body } = await mcpPost<{
      capabilities: {
        resources?: { listChanged?: boolean };
        prompts?: { listChanged?: boolean };
        tools?: Record<string, unknown>;
      };
    }>("server/discover");
    expect(status).toBe(200);
    expect(body.result?.capabilities.resources?.listChanged).toBe(true);
    expect(body.result?.capabilities.prompts?.listChanged).toBe(true);
  });

  it("publishes created notes in resources/list, resources/templates/list, completion/complete, and resources/read", async () => {
    // Template advertised
    const templatesRes = await mcpPost<{
      resourceTemplates: Array<{ name: string; uriTemplate: string }>;
    }>("resources/templates/list");
    expect(templatesRes.status).toBe(200);
    expect(
      templatesRes.body.result?.resourceTemplates.some(
        (t) => t.uriTemplate === "note://{id}",
      ),
    ).toBe(true);

    // Create note via tool (also invokes handler.notify.resourcesChanged())
    const created = await callTool("create_note", {
      title: "Karachi Foods price list",
      body: "Ali requested updated bulk cooking oil pricing by Friday.",
      category: "call",
    });
    expect(created.isError).toBeFalsy();
    const { id, uri } = created.structuredContent as { id: string; uri: string };
    expect(uri).toBe(`note://${id}`);

    // Note appears in resources/list
    const listRes = await mcpPost<{
      resources: Array<{ uri: string; name: string; mimeType?: string }>;
    }>("resources/list");
    expect(listRes.status).toBe(200);
    const listed = listRes.body.result?.resources.find((r) => r.uri === uri);
    expect(listed).toBeDefined();
    expect(listed?.name).toBe("Karachi Foods price list");
    expect(listed?.mimeType).toBe("text/markdown");

    // Autocomplete {id} prefix
    const completeRes = await mcpPost<{
      completion: { values: string[] };
    }>("completion/complete", {
      ref: { type: "ref/resource", uri: "note://{id}" },
      argument: { name: "id", value: id.slice(0, 6) },
    });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.result?.completion.values).toContain(id);

    // Read resource markdown
    const readRes = await mcpPost<{
      contents: Array<{ uri: string; mimeType?: string; text?: string }>;
    }>("resources/read", { uri });
    expect(readRes.status).toBe(200);
    expect(readRes.body.result?.contents[0]?.uri).toBe(uri);
    expect(readRes.body.result?.contents[0]?.text).toContain(
      "Ali requested updated bulk cooking oil pricing by Friday.",
    );

    // Delete via tool, then confirm resource is removed from list & read throws not-found
    const deleted = await callTool("delete_note", { id });
    expect(deleted.isError).toBeFalsy();
    expect(deleted.structuredContent).toEqual({ deleted: true, id });

    const missingRead = await mcpPost("resources/read", { uri });
    expect(missingRead.body.error).toBeDefined();
    expect(missingRead.body.error?.code).toBe(-32602);
    expect(missingRead.body.error?.message).toContain("Resource not found");
    expect(missingRead.body.error?.data).toEqual({ uri });
  });

  it("lists and expands summarize_notes prompt with and without optional tag", async () => {
    const promptsRes = await mcpPost<{
      prompts: Array<{
        name: string;
        arguments?: Array<{ name: string; required?: boolean }>;
      }>;
    }>("prompts/list");
    expect(promptsRes.status).toBe(200);
    const prompt = promptsRes.body.result?.prompts.find(
      (p) => p.name === "summarize_notes",
    );
    expect(prompt).toBeDefined();
    expect(prompt?.arguments?.some((a) => a.name === "tag" && !a.required)).toBe(
      true,
    );

    const unscoped = await mcpPost<{
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    }>("prompts/get", { name: "summarize_notes", arguments: {} });
    expect(unscoped.status).toBe(200);
    expect(unscoped.body.result?.messages[0]?.content.text).toContain("list_notes");
    expect(unscoped.body.result?.messages[0]?.content.text).toContain("note://{id}");

    const categoryScoped = await mcpPost<{
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    }>("prompts/get", {
      name: "summarize_notes",
      arguments: { tag: "order" },
    });
    expect(categoryScoped.status).toBe(200);
    expect(categoryScoped.body.result?.messages[0]?.content.text).toContain(
      'category="order"',
    );
  });

  it("supports legacy 2025 stateless initialize + tools/list + prompts/list", async () => {
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
    const bodyText = await initRes.text();
    expect(bodyText).toContain("learn-mcp-step-03");
    expect(bodyText).toContain("resources");
    expect(bodyText).toContain("prompts");
  });
});
