import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { NOTE_CATEGORIES } from "./notes-store.js";

const SummarizeNotesArgsSchema = z.object({
  tag: z
    .string()
    .trim()
    .max(64)
    .optional()
    .describe(
      `Optional category or keyword tag (${NOTE_CATEGORIES.join(", ")}, or customer/topic name) to focus the summary.`,
    ),
});

/**
 * Register the Step 03 user-triggered prompt template.
 * Reusable procedures will migrate to Skills over MCP in Step 10.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "summarize_notes",
    {
      title: "Summarize Stockroom Notes",
      description:
        "Prepare a structured weekly briefing of Stockroom account notes, optionally filtered by a category tag or keyword.",
      argsSchema: SummarizeNotesArgsSchema,
    },
    ({ tag }) => {
      const normalizedTag = tag?.trim();
      const isCategory = normalizedTag
        ? (NOTE_CATEGORIES as readonly string[]).includes(normalizedTag)
        : false;

      const scopeLine = normalizedTag
        ? isCategory
          ? `Focus specifically on notes in the "${normalizedTag}" category (pass category="${normalizedTag}" when calling list_notes).`
          : `Focus specifically on notes related to "${normalizedTag}" (check note titles/bodies matching that tag).`
        : "Include notes across all Stockroom categories (call, follow_up, order, general).";

      return {
        description: normalizedTag
          ? `Summarize Stockroom account notes for "${normalizedTag}".`
          : "Summarize all Stockroom account notes.",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "Prepare a concise sales briefing from Stockroom's account notes.",
                scopeLine,
                "",
                "How to gather the data:",
                "1. Inspect any `note://{id}` resources already attached to this chat.",
                "2. Call `list_notes` (and `get_note` or `resources/read` on `note://{id}`) to load full details for every relevant note.",
                "",
                "Structure the summary under three headings: **Action Items & Follow-Ups**, **Orders & Quotes**, and **Recent Customer Calls**, citing each note's title and ID.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
