import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

/** KV key prefix so note records stay cleanly isolated in the namespace. */
const NOTE_PREFIX = "note:";
const MAX_PAGE_SIZE = 50;
const MAX_FILTERED_SCAN_PAGES = 10;

export const NOTE_CATEGORIES = ["call", "follow_up", "order", "general"] as const;
const NoteCategorySchema = z.enum(NOTE_CATEGORIES);
type NoteCategory = z.infer<typeof NoteCategorySchema>;

const NoteIdSchema = z
  .string()
  .trim()
  .min(1, "Note ID must not be empty.")
  .max(64, "Note ID must be 64 characters or fewer.")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Note ID must contain only letters, numbers, hyphens, or underscores.",
  );

const ListNotesInputSchema = z.object({
  category: NoteCategorySchema.optional().describe(
    "Optional category filter ('call', 'follow_up', 'order', or 'general'). Omit to include all categories.",
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(20)
    .describe(`Maximum number of notes to return (1–${MAX_PAGE_SIZE}). Defaults to 20.`),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe(
      "Opaque pagination cursor from a previous list_notes response. Omit to start from the first page.",
    ),
});

const NoteSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: NoteCategorySchema,
  createdAt: z.string(),
});

const ListNotesOutputSchema = z.object({
  notes: z.array(NoteSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const GetNoteInputSchema = z.object({
  id: NoteIdSchema.describe(
    "Unique ID of the note to retrieve (obtained from create_note or list_notes).",
  ),
});

const GetNoteOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: NoteCategorySchema,
  body: z.string(),
  createdAt: z.string(),
});

const CreateNoteInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title must not be empty.")
    .max(100, "Title must be 100 characters or fewer.")
    .describe("Short, searchable title for the account note (1–100 characters)."),
  body: z
    .string()
    .trim()
    .min(1, "Body must not be empty.")
    .max(2000, "Body must be 2000 characters or fewer.")
    .describe("Full text details of the account note (1–2000 characters)."),
  category: NoteCategorySchema.default("general").describe(
    "Category for the account note: 'call', 'follow_up', 'order', or 'general'. Defaults to 'general'.",
  ),
});

const CreateNoteOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: NoteCategorySchema,
  createdAt: z.string(),
});

const DeleteNoteInputSchema = z.object({
  id: NoteIdSchema.describe(
    "Unique ID of the note to permanently delete (obtained from create_note or list_notes).",
  ),
});

const DeleteNoteOutputSchema = z.object({
  deleted: z.boolean(),
  id: z.string(),
});

interface StoredNote {
  id: string;
  title: string;
  category: NoteCategory;
  body: string;
  createdAt: string;
}

interface NoteMetadata {
  id: string;
  title: string;
  category: NoteCategory;
  createdAt: string;
}

function noteKey(id: string): string {
  return `${NOTE_PREFIX}${id}`;
}

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Register the Step 02 notes toolset on a fresh per-request McpServer instance.
 *
 * All notes live in Workers KV (`env.NOTES`), never in module-level memory, so
 * any Worker isolate handling a follow-up request reads the same note state.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description:
        "List Stockroom account note summaries (ID, title, category, creation timestamp) stored in Workers KV. " +
        "Does not return note bodies — call get_note with a note ID when full details are needed. " +
        "Supports optional category filtering and cursor pagination.",
      inputSchema: ListNotesInputSchema,
      outputSchema: ListNotesOutputSchema,
      annotations: {
        title: "List Notes",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category, limit, cursor }) => {
      const notes: Array<z.infer<typeof NoteSummarySchema>> = [];
      let currentCursor = cursor;
      let hasMore = false;
      let nextCursor: string | null = null;

      // Without a category filter we return one KV page directly; with a filter we
      // scan bounded pages so empty non-matching pages do not hide matching notes.
      const maxPages = category ? MAX_FILTERED_SCAN_PAGES : 1;

      for (let page = 0; page < maxPages; page++) {
        const result = await env.NOTES.list<NoteMetadata>({
          prefix: NOTE_PREFIX,
          limit,
          cursor: currentCursor,
        });

        for (const key of result.keys) {
          const meta = key.metadata;
          const summary: z.infer<typeof NoteSummarySchema> = {
            id: key.name.slice(NOTE_PREFIX.length),
            title: meta?.title ?? "(untitled)",
            category: meta?.category ?? "general",
            createdAt: meta?.createdAt ?? "",
          };

          if (!category || summary.category === category) {
            notes.push(summary);
          }
        }

        if (result.list_complete) {
          hasMore = false;
          nextCursor = null;
          break;
        }

        currentCursor = result.cursor;
        nextCursor = result.cursor;
        hasMore = true;

        if (!category || notes.length >= limit) {
          break;
        }
      }

      const trimmedNotes = notes.slice(0, limit);
      const output = {
        notes: trimmedNotes,
        nextCursor,
        hasMore,
      };

      const filterText = category ? ` in category "${category}"` : "";
      const text =
        trimmedNotes.length === 0
          ? `No notes found${filterText}. Use create_note to save a new account note.`
          : `Found ${trimmedNotes.length} note(s)${filterText}${hasMore ? " (more available via nextCursor)" : ""}.`;

      return {
        content: [{ type: "text", text }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get Note",
      description:
        "Retrieve the full title, category, body, and creation timestamp of a single Stockroom account note by ID. " +
        "Use list_notes if you need to discover note IDs first. Returns a recoverable error when the note does not exist.",
      inputSchema: GetNoteInputSchema,
      outputSchema: GetNoteOutputSchema,
      annotations: {
        title: "Get Note",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      let note: StoredNote | null;
      try {
        note = await env.NOTES.get<StoredNote>(noteKey(id), "json");
      } catch {
        return toolError(
          `Note "${id}" is unreadable or corrupted in storage. Verify its ID with list_notes or create a replacement note.`,
        );
      }

      if (!note) {
        return toolError(
          `Note "${id}" was not found. Call list_notes to see valid note IDs, or create_note to create a new note.`,
        );
      }

      const normalized: z.infer<typeof GetNoteOutputSchema> = {
        id: note.id,
        title: note.title,
        category: note.category ?? "general",
        body: note.body,
        createdAt: note.createdAt,
      };

      return {
        content: [
          {
            type: "text",
            text: `[${normalized.category}] ${normalized.title} (${normalized.id})\nCreated: ${normalized.createdAt}\n\n${normalized.body}`,
          },
        ],
        structuredContent: normalized,
      };
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create Note",
      description:
        "Create and persist a new Stockroom account note in Workers KV with a title, body, and category ('call', 'follow_up', 'order', or 'general'). " +
        "Returns the generated note ID for later retrieval with get_note. Never modifies or deletes existing notes.",
      inputSchema: CreateNoteInputSchema,
      outputSchema: CreateNoteOutputSchema,
      annotations: {
        title: "Create Note",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, body, category }) => {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const note: StoredNote = { id, title, category, body, createdAt };
      const metadata: NoteMetadata = { id, title, category, createdAt };

      // Metadata keeps list_notes fast without reading every note body from KV.
      await env.NOTES.put(noteKey(id), JSON.stringify(note), { metadata });

      const output = { id, title, category, createdAt };
      return {
        content: [
          {
            type: "text",
            text: `Created ${category} note "${title}" with ID ${id}.`,
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete Note",
      description:
        "Permanently delete a Stockroom account note by ID from Workers KV. " +
        "This action cannot be undone; use only when the user asks to remove a specific note. " +
        "Returns a recoverable error if no note exists with that ID.",
      inputSchema: DeleteNoteInputSchema,
      outputSchema: DeleteNoteOutputSchema,
      annotations: {
        title: "Delete Note",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const existing = await env.NOTES.get(noteKey(id));
      if (!existing) {
        return toolError(
          `Cannot delete note "${id}" because it does not exist. Call list_notes to check existing note IDs.`,
        );
      }

      await env.NOTES.delete(noteKey(id));

      const output = { deleted: true, id };
      return {
        content: [
          {
            type: "text",
            text: `Permanently deleted note "${id}".`,
          },
        ],
        structuredContent: output,
      };
    },
  );
}
