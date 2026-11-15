import { sendCapture, visibleText, stableId } from "./capture-bridge.mjs";
export function createOpenClawCapture(send = sendCapture) {
  return { id: "conversation-memory-capture", name: "Conversation Memory Capture", register(api) {
    api.on("agent_end", async (event, ctx) => {
      if (!event.messages?.length) return; // Incognito hosts deliberately omit messages.
      if (!ctx.sessionId || !ctx.workspaceDir) {
        api.logger?.warn("[conversation-memory] Session identity/workspace unavailable; capture skipped."); return;
      }
      const messages = event.messages.filter(m => ["user", "assistant"].includes(m.role)).map((m, i) => ({
        id: m.id || stableId([m.timestamp, i, m.role, visibleText(m.content)]), role: m.role, content: visibleText(m.content),
      })).filter(m => m.content.trim());
      await send("openclaw", { session_id: ctx.sessionId, cwd: ctx.workspaceDir, messages });
    });
  } };
}
export default createOpenClawCapture();
