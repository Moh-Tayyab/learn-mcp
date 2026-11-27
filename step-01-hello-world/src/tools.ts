import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const GreetInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name must not be empty.")
    .max(100, "Name must be 100 characters or fewer.")
    .describe("Name of the person to greet."),
});

const GreetOutputSchema = z.object({
  greeting: z.string(),
  name: z.string(),
});

const GetTimeInputSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone must not be empty when provided.")
    .max(64, "Timezone identifier must be 64 characters or fewer.")
    .optional()
    .describe(
      "Optional IANA timezone name (for example 'Asia/Karachi' or 'America/New_York'). Defaults to 'UTC'.",
    ),
});

const GetTimeOutputSchema = z.object({
  timezone: z.string(),
  iso: z.string(),
  formatted: z.string(),
});

/** Format a Date in an IANA timezone; returns null when the timezone is invalid. */
function formatInTimezone(now: Date, timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(now);
  } catch {
    return null;
  }
}

/** Register Step 01 tools on a fresh per-request McpServer instance. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "greet",
    {
      title: "Greet User",
      description:
        "Return a friendly greeting for the given name. Use when asked to greet someone or verify MCP connectivity; does not read or store user records.",
      inputSchema: GreetInputSchema,
      outputSchema: GreetOutputSchema,
      annotations: {
        title: "Greet User",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      const greeting = `Hello, ${name}! Welcome to Stockroom's MCP server.`;
      return {
        content: [{ type: "text", text: greeting }],
        structuredContent: { greeting, name },
      };
    },
  );

  server.registerTool(
    "get_time",
    {
      title: "Get Current Time",
      description:
        "Return the current date and time, optionally formatted in an IANA timezone (defaults to UTC). Returns a recoverable error if the timezone identifier is invalid.",
      inputSchema: GetTimeInputSchema,
      outputSchema: GetTimeOutputSchema,
      annotations: {
        title: "Get Current Time",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ timezone }) => {
      const targetTimezone = timezone ?? "UTC";
      const now = new Date();
      const formatted = formatInTimezone(now, targetTimezone);

      if (!formatted) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid IANA timezone "${targetTimezone}". Pass a valid identifier such as "UTC", "Asia/Karachi", or "America/New_York".`,
            },
          ],
        };
      }

      const iso = now.toISOString();
      return {
        content: [
          {
            type: "text",
            text: `Current time in ${targetTimezone}: ${formatted} (${iso})`,
          },
        ],
        structuredContent: {
          timezone: targetTimezone,
          iso,
          formatted,
        },
      };
    },
  );
}
