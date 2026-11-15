import { ConversationMemory } from "./conversation-memory.mjs";

// V2's Plugin.define is an identity helper; this is its JS definition shape.
// Keep this entrypoint independent from the V1 loader and its SDK imports.
export async function setupConversationMemory(ctx, options = {}) {
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
        types: ["session.idle"],
        signal: controller.signal,
      })) {
        if (
          event.type === "session.idle" &&
          typeof event.data?.sessionID === "string"
        ) {
          await hooks.event({
            event: {
              type: event.type,
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
