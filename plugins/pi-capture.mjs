import { sendCapture, visibleText } from "./capture-bridge.mjs";
export function createPiCapture(send = sendCapture) {
  return function register(pi) {
    let pending = Promise.resolve();
    const capture = (_event, ctx) => {
      const session = ctx.sessionManager.getSessionId();
      const messages = ctx.sessionManager.getBranch().filter(e => e.type === "message" && ["user", "assistant"].includes(e.message.role))
        .map(e => ({ id: e.id, role: e.message.role, content: visibleText(e.message.content) })).filter(m => m.content.trim());
      pending = pending.then(() => send("pi", { session_id: session, cwd: ctx.cwd, messages }));
      return pending;
    };
    pi.on("agent_end", capture);
    pi.on("session_shutdown", () => pending);
  };
}
export default createPiCapture();
