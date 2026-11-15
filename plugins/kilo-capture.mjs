import { sendCapture, visibleText } from "./capture-bridge.mjs";
export function createKiloCapture(send = sendCapture) {
  const server = async ({ client, directory }) => ({ event: async ({ event }) => {
    if (event.type !== "session.idle") return;
    const session = event.properties?.sessionID;
    if (!session) return;
    const detail = await client.session.get({ path: { id: session } });
    const sessionDirectory = detail.data?.directory;
    if (!sessionDirectory) throw new Error("Kilo session directory unavailable");
    const result = await client.session.messages({ path: { id: session } });
    if (result.error || !Array.isArray(result.data)) throw new Error("Kilo messages unavailable");
    const messages = (result.data || []).filter(m => ["user", "assistant"].includes(m.info.role)).map(m => ({
      id: m.info.id, role: m.info.role, content: visibleText(m.parts),
    })).filter(m => m.content.trim());
    await send("kilocode", { session_id: session, cwd: sessionDirectory, messages });
  } });
  return { id: "conversation-memory-capture", server };
}
export default createKiloCapture();
