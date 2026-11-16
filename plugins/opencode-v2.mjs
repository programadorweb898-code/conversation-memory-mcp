import { ConversationMemory } from "./conversation-memory.mjs";
import { resolve } from "node:path";

// V2 declares session.idle for compatibility, but 2.2.6 publishes execution
// terminal events instead. Subscribe to the emitted lifecycle, not just its schema.
export const CAPTURE_EVENTS = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
];

// V2's Plugin.define is an identity helper; this is its JS definition shape.
// Keep this entrypoint independent from the V1 loader and its SDK imports.
export async function setupConversationMemory(ctx, options = {}) {
  const normalizeDirectory = (directory) => {
    const value = resolve(directory);
    return process.platform === "win32" ? value.toLowerCase() : value;
  };
  const client = {
    app: {
      log: async ({ body }) =>
        console.error(`[conversation-memory] ${body.message}`),
    },
    session: {
      get: async ({ path }) => {
        const session = await ctx.session.get({ sessionID: path.id });
        return {
          data: {
            ...session,
            directory: session.location?.directory,
            projectID: session.projectID,
          },
        };
      },
      messages: async ({ path }) => {
        const context = await ctx.session.context({ sessionID: path.id });
        let parentID;
        let agent = "opencode";
        const data = [];
        for (const message of context) {
          if (message.type === "agent-switched") {
            agent = message.agent;
            continue;
          }
          if (message.type === "user") {
            parentID = message.id;
            data.push({
              info: { id: message.id, role: "user", agent },
              parts: [{ type: "text", text: message.text }],
            });
          } else if (message.type === "assistant") {
            data.push({
              info: {
                id: message.id,
                role: "assistant",
                agent: message.agent,
                parentID,
              },
              parts: message.content || [],
            });
          }
        }
        return { data };
      },
    },
  };
  const hooks = await ConversationMemory(
    {
      client,
      directory: ctx.location.directory,
      project: {
        id: ctx.location.project?.id,
        worktree: ctx.location.project?.canonical || ctx.location.directory,
      },
    },
    options,
  );
  const controller = new AbortController();
  let registration;
  try {
    registration = await ctx.tool.hook("execute.before", async (event) => {
      const output = { args: event.input };
      await hooks["tool.execute.before"](
        { tool: event.tool, sessionID: event.sessionID },
        output,
      );
      event.input = output.args;
    });
  } catch (error) {
    await hooks.dispose();
    throw error;
  }
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({
        types: CAPTURE_EVENTS,
        signal: controller.signal,
      })) {
        if (
          CAPTURE_EVENTS.includes(event.type) &&
          typeof event.data?.sessionID === "string" &&
          (!event.location?.directory ||
            normalizeDirectory(event.location.directory) === normalizeDirectory(ctx.location.directory))
        ) {
          await hooks.event({
            event: {
              type: "session.idle",
              properties: { sessionID: event.data.sessionID },
            },
          });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted)
        console.error(
          "[conversation-memory] event subscription failed:",
          error,
        );
    }
  })();
  return async () => {
    controller.abort();
    await events;
    await registration?.dispose();
    await hooks.dispose();
  };
}
export default { id: "conversation-memory", setup: setupConversationMemory };
