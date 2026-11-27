import { McpServer, ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";
import {
  formatNoteMarkdown,
  getNote,
  listNotes,
  NoteIdSchema,
  noteUri,
} from "./notes-store.js";

/**
 * Register Stockroom account notes as MCP resources (`note://{id}`).
 * Resources expose read-only reference data so host apps or users can attach
 * specific notes directly to a conversation.
 */
export function registerResources(server: McpServer): void {
  const noteTemplate = new ResourceTemplate("note://{id}", {
    list: async () => {
      const resources: Array<{
        uri: string;
        name: string;
        title: string;
        description: string;
        mimeType: string;
      }> = [];

      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const result = await listNotes({ limit: 50, cursor });
        for (const note of result.notes) {
          resources.push({
            uri: noteUri(note.id),
            name: note.title,
            title: note.title,
            description: `[${note.category}] Stockroom account note created ${note.createdAt}`,
            mimeType: "text/markdown",
          });
        }
        if (!result.hasMore || !result.nextCursor) break;
        cursor = result.nextCursor;
      }

      return { resources };
    },
    complete: {
      id: async (value) => {
        const { notes } = await listNotes({ limit: 50 });
        const prefix = value.trim().toLowerCase();
        return notes
          .map((note) => note.id)
          .filter((id) => id.toLowerCase().startsWith(prefix))
          .slice(0, 20);
      },
    },
  });

  server.registerResource(
    "account-note",
    noteTemplate,
    {
      title: "Stockroom Account Note",
      description:
        "Read-only markdown view of a Stockroom customer account note stored in Workers KV.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const rawId = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const parsedId = NoteIdSchema.safeParse(rawId);
      if (!parsedId.success) {
        throw new ResourceNotFoundError(uri.href);
      }

      const note = await getNote(parsedId.data);
      if (!note) {
        throw new ResourceNotFoundError(uri.href);
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: formatNoteMarkdown(note),
          },
        ],
      };
    },
  );
}
