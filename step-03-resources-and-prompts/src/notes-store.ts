import { env } from "cloudflare:workers";
import { z } from "zod";

/** KV key prefix so note records stay cleanly namespaced in storage. */
export const NOTE_PREFIX = "note:";
export const MAX_PAGE_SIZE = 50;
const MAX_FILTERED_SCAN_PAGES = 10;

export const NOTE_CATEGORIES = ["call", "follow_up", "order", "general"] as const;
export const NoteCategorySchema = z.enum(NOTE_CATEGORIES);
export type NoteCategory = z.infer<typeof NoteCategorySchema>;

export const NoteIdSchema = z
  .string()
  .trim()
  .min(1, "Note ID must not be empty.")
  .max(64, "Note ID must be 64 characters or fewer.")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Note ID must contain only letters, numbers, hyphens, or underscores.",
  );

export const NoteSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: NoteCategorySchema,
  createdAt: z.string(),
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export interface StoredNote {
  id: string;
  title: string;
  category: NoteCategory;
  body: string;
  createdAt: string;
}

function noteKey(id: string): string {
  return `${NOTE_PREFIX}${id}`;
}

export function noteUri(id: string): string {
  return `note://${id}`;
}

/** Format a stored note cleanly as markdown for resource reads. */
export function formatNoteMarkdown(note: StoredNote): string {
  return [
    `# ${note.title}`,
    "",
    `- **ID:** ${note.id}`,
    `- **Category:** ${note.category}`,
    `- **Created:** ${note.createdAt}`,
    "",
    note.body,
  ].join("\n");
}

/**
 * List Stockroom account note summaries stored in Workers KV.
 * Shared by both `list_notes` (tool) and `note://{id}` (resource listing).
 */
export async function listNotes(options: {
  category?: NoteCategory;
  limit?: number;
  cursor?: string;
} = {}): Promise<{
  notes: NoteSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const limit = options.limit ?? 20;
  const notes: NoteSummary[] = [];
  let currentCursor = options.cursor;
  let hasMore = false;
  let nextCursor: string | null = null;

  // Scan bounded KV pages when filtering by category so sparse matches are not hidden.
  const maxPages = options.category ? MAX_FILTERED_SCAN_PAGES : 1;

  for (let page = 0; page < maxPages; page++) {
    const result = await env.NOTES.list<NoteSummary>({
      prefix: NOTE_PREFIX,
      limit,
      cursor: currentCursor,
    });

    for (const key of result.keys) {
      const meta = key.metadata;
      const summary: NoteSummary = {
        id: key.name.slice(NOTE_PREFIX.length),
        title: meta?.title ?? "(untitled)",
        category: meta?.category ?? "general",
        createdAt: meta?.createdAt ?? "",
      };

      if (!options.category || summary.category === options.category) {
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

    if (!options.category || notes.length >= limit) {
      break;
    }
  }

  return {
    notes: notes.slice(0, limit),
    nextCursor,
    hasMore,
  };
}

/**
 * Retrieve a single Stockroom note by ID from Workers KV.
 * Returns `null` if absent, or throws if JSON parsing fails.
 */
export async function getNote(id: string): Promise<StoredNote | null> {
  const note = await env.NOTES.get<StoredNote>(noteKey(id), "json");
  if (!note) return null;
  return {
    id: note.id,
    title: note.title,
    category: note.category ?? "general",
    body: note.body,
    createdAt: note.createdAt,
  };
}

/** Persist a new Stockroom note in Workers KV with summary metadata. */
export async function createNote(input: {
  title: string;
  body: string;
  category: NoteCategory;
}): Promise<StoredNote> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const note: StoredNote = {
    id,
    title: input.title,
    category: input.category,
    body: input.body,
    createdAt,
  };
  const metadata: NoteSummary = {
    id,
    title: input.title,
    category: input.category,
    createdAt,
  };

  // Summary metadata lets list operations avoid fetching full note bodies.
  await env.NOTES.put(noteKey(id), JSON.stringify(note), { metadata });
  return note;
}

/** Delete a note from KV; returns `false` if it did not exist. */
export async function deleteNote(id: string): Promise<boolean> {
  const existing = await env.NOTES.get(noteKey(id));
  if (!existing) return false;
  await env.NOTES.delete(noteKey(id));
  return true;
}
