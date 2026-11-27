/**
 * tools-bad.ts — deliberately bad tool design for comparison purposes.
 *
 * This file is NOT registered on the MCP server. It exists only to illustrate
 * the mistakes the good design in tools.ts avoids.
 *
 * See: TOOL-DESIGN-COMPARISON.md for the full before/after analysis.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// ❌ BAD: a single vague "do anything with notes" tool.
//    The model cannot tell from the name, description or schema when to use
//    it, what inputs are valid, or whether the action is safe.
export function registerBadTools(server: McpServer): void {
  server.registerTool(
    // ❌ Generic name — model can't distinguish read from write.
    "manage_data",
    {
      // ❌ No description — the model has zero context.
      description: "",

      // ❌ Loose schema: 'action' is a free string — any value is accepted,
      //    so the model must guess the vocabulary ("delete"? "remove"? "erase"?).
      //    'payload' is completely unconstrained — anything goes in.
      inputSchema: z.object({
        action: z.string(),
        payload: z.any(),  // any = no guardrails at all
      }),

      // ❌ No annotations — the host assumes it may write data and may refuse
      //    to call it, or may call it without confirmation when it shouldn't.
    },
    async ({ action, payload }) => {
      // ❌ No input validation — if 'action' is unknown, error is opaque.
      // ❌ No structured output — model must parse free-form text.
      return {
        content: [{ type: "text" as const, text: `did ${action} with ${JSON.stringify(payload)}` }],
      };
    },
  );
}
