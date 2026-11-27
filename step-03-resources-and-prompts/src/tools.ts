import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  MAX_PAGE_SIZE,
  NoteCategorySchema,
  NoteIdSchema,
  NoteSummarySchema,
  noteUri,
} from "./notes-store.js";

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

const ListNotesOutputSchema = z.object({
  notes: z.array(NoteSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const GetNoteInputSchema = z.object({
  id: NoteIdSchema.describe(
    "Unique ID of the note to retrieve (obtained from create_note, list_notes, or a note://{id} resource URI).",
  ),
});

const GetNoteOutputSchema = z.object({
  id: z.string(),
  uri: z.string(),
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
  uri: z.string(),
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

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Register the Stockroom account-notes toolset on a fresh per-request McpServer.
 * Mutations invoke `onResourceListChanged` so any subscribed stream on this handler
 * receives `notifications/resources/list_changed`.
 */
export function registerTools(
  server: McpServer,
  onResourceListChanged?: () => void,
): void {
  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description:
        "List Stockroom account note summaries (ID, title, category, creation timestamp) stored in Workers KV. " +
        "Does not return note bodies — call get_note with a note ID or read its note://{id} resource when full details are needed. " +
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
      const output = await listNotes({ category, limit, cursor });
      const filterText = category ? ` in category "${category}"` : "";
      const text =
        output.notes.length === 0
          ? `No notes found${filterText}. Use create_note to save a new account note.`
          : `Found ${output.notes.length} note(s)${filterText}${output.hasMore ? " (more available via nextCursor)" : ""}.`;

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
        "Retrieve the full title, category, body, URI, and creation timestamp of a single Stockroom account note by ID. " +
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
      let note;
      try {
        note = await getNote(id);
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

      const output = {
        ...note,
        uri: noteUri(note.id),
      };

      return {
        content: [
          {
            type: "text",
            text: `[${note.category}] ${note.title} (${output.uri})\nCreated: ${note.createdAt}\n\n${note.body}`,
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create Note",
      description:
        "Create and persist a new Stockroom account note in Workers KV with a title, body, and category ('call', 'follow_up', 'order', or 'general'). " +
        "Publishes the note as a note://{id} resource and returns its ID and URI. Never modifies or deletes existing notes.",
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
      const note = await createNote({ title, body, category });
      onResourceListChanged?.();

      const output = {
        id: note.id,
        uri: noteUri(note.id),
        title: note.title,
        category: note.category,
        createdAt: note.createdAt,
      };

      return {
        content: [
          {
            type: "text",
            text: `Created ${note.category} note "${note.title}" (ID: ${note.id}, Resource: ${output.uri}).`,
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
      const removed = await deleteNote(id);
      if (!removed) {
        return toolError(
          `Cannot delete note "${id}" because it does not exist. Call list_notes to check existing note IDs.`,
        );
      }

      onResourceListChanged?.();

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
