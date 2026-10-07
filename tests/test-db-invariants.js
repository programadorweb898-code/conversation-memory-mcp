const { expect } = require("chai");
const { randomUUID } = require("crypto");
const { db } = require("./test-helper");

describe("Database invariants", () => {
  const sessions = new Set();
  const messages = new Set();

  afterEach(async () => {
    for (const id of messages) {
      await db.runAsync("DELETE FROM conversations WHERE id = $1", [id]);
    }
    for (const sessionId of sessions) {
      await db.runAsync("DELETE FROM session_summaries WHERE session_id = $1", [sessionId]);
      await db.runAsync("DELETE FROM conversations WHERE session_id = $1", [sessionId]);
    }
    messages.clear();
    sessions.clear();
  });

  it("rechaza proyectos, owners y contenido vacíos en conversations", async () => {
    const cases = [
      ["blank-project", "project", "   "],
      ["blank-owner", "owner", "   "],
      ["blank-content", "content", "   "],
    ];

    for (const [name, column, value] of cases) {
      const id = randomUUID();
      sessions.add(id);
      messages.add(id);

      const project = column === "project" ? value : "p16";
      const owner = column === "owner" ? value : "owner-p16";
      const content = column === "content" ? value : "contenido";

      try {
        await db.runAsync(
          \`INSERT INTO conversations
           (id, session_id, project, role, content, owner)
           VALUES ($1, $2, $3, 'user', $4, $5)\`,
          [id, id, project, content, owner],
        );
        expect.fail(\`La inserción inválida para \${name} debería haber fallado\`);
      } catch (err) {
        expect(err.code).to.equal("23514");
      }
    }
  });

  it("rechaza roles que la aplicación tampoco permite", async () => {
    const id = randomUUID();
    sessions.add(id);
    messages.add(id);

    try {
      await db.runAsync(
        \`INSERT INTO conversations
         (id, session_id, project, role, content, owner)
         VALUES ($1, $2, 'p16', 'tool', 'contenido', 'owner-p16')\`,
        [id, id],
      );
      expect.fail("Un role fuera del contrato debería haber fallado");
    } catch (err) {
      expect(err.code).to.equal("23514");
    }
  });

  it("impide que una sesión cambie de proyecto para el mismo owner", async () => {
    const sessionId = randomUUID();
    sessions.add(sessionId);

    await db.runAsync(
      \`INSERT INTO conversations
       (id, session_id, project, role, content, owner)
       VALUES ($1, $2, 'project-a', 'user', 'primero', 'owner-p16')\`,
      [randomUUID(), sessionId],
    );

    try {
      await db.runAsync(
        \`INSERT INTO conversations
         (id, session_id, project, role, content, owner)
         VALUES ($1, $2, 'project-b', 'assistant', 'segundo', 'owner-p16')\`,
        [randomUUID(), sessionId],
      );
      expect.fail("Una sesión no debería poder quedar asociada a dos proyectos");
    } catch (err) {
      expect(err.code).to.equal("23514");
    }
  });

  it("mantiene el mismo proyecto entre conversaciones y resumen", async () => {
    const sessionId = randomUUID();
    sessions.add(sessionId);

    await db.runAsync(
      \`INSERT INTO conversations
       (id, session_id, project, role, content, owner)
       VALUES ($1, $2, 'project-a', 'user', 'mensaje', 'owner-p16')\`,
      [randomUUID(), sessionId],
    );

    try {
      await db.runAsync(
        \`INSERT INTO session_summaries
         (session_id, project, owner, summary)
         VALUES ($1, 'project-b', 'owner-p16', 'resumen')\`,
        [sessionId],
      );
      expect.fail("El resumen debería respetar el proyecto de la sesión");
    } catch (err) {
      expect(err.code).to.equal("23514");
    }
  });

  it("impide related_message_id entre sesiones u owners distintos", async () => {
    const targetId = randomUUID();
    const targetSession = randomUUID();
    const sourceId = randomUUID();
    sessions.add(targetSession);
    sessions.add(sourceId);
    messages.add(targetId);
    messages.add(sourceId);

    await db.runAsync(
      \`INSERT INTO conversations
       (id, session_id, project, role, content, owner)
       VALUES ($1, $2, 'project-a', 'user', 'objetivo', 'owner-a')\`,
      [targetId, targetSession],
    );

    try {
      await db.runAsync(
        \`INSERT INTO conversations
         (id, session_id, project, role, content, owner, related_message_id)
         VALUES ($1, $2, 'project-a', 'assistant', 'respuesta', 'owner-a', $3)\`,
        [sourceId, sourceId, targetId],
      );
      expect.fail("related_message_id no debería cruzar de sesión");
    } catch (err) {
      expect(err.code).to.equal("23503");
    }
  });

  it("rechaza watermarks negativos de resúmenes", async () => {
    const sessionId = randomUUID();
    sessions.add(sessionId);

    try {
      await db.runAsync(
        \`INSERT INTO session_summaries
         (session_id, project, owner, summary, last_processed_seq_id)
         VALUES ($1, 'project-a', 'owner-p16', 'resumen', -1)\`,
        [sessionId],
      );
      expect.fail("Un watermark negativo debería haber fallado");
    } catch (err) {
      expect(err.code).to.equal("23514");
    }
  });
});
