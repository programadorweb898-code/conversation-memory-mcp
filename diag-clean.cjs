require("dotenv").config();
const { Pool } = require("pg");

(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const rows = async (q, a) => (await p.query(q, a)).rows;

  const count = async (label, sql) => {
    const r = await rows(sql);
    console.log(label, JSON.stringify(r[0]));
  };

  await count("ANTES:", `
    SELECT
      (SELECT count(*) FROM embedding_failures)   AS failures,
      (SELECT count(*) FROM conversations
        WHERE session_id LIKE 'worker-session-%') AS worker_sessions,
      (SELECT count(*) FROM conversations
        WHERE project IN ('test','worker-test'))  AS test_projects
  `);

  const delMsgs = await p.query(
    `DELETE FROM conversations
     WHERE session_id LIKE 'worker-session-%'
        OR project IN ('test','worker-test')`
  );
  console.log("DELETE conversations:", delMsgs.rowCount);

  const delFails = await p.query(
    `DELETE FROM embedding_failures f
     USING conversations c
     WHERE f.message_id = c.id AND c.project IN ('test','worker-test')`
  );
  console.log("DELETE embedding_failures:", delFails.rowCount);

  const delEmb = await p.query(
    `DELETE FROM message_embeddings e
     USING conversations c
     WHERE e.message_id = c.id AND c.project IN ('test','worker-test')`
  );
  console.log("DELETE message_embeddings:", delEmb.rowCount);

  await count("DESPUES:", `
    SELECT
      (SELECT count(*) FROM embedding_failures)   AS failures,
      (SELECT count(*) FROM conversations
        WHERE session_id LIKE 'worker-session-%') AS worker_sessions,
      (SELECT count(*) FROM conversations
        WHERE project IN ('test','worker-test'))  AS test_projects
  `);

  await p.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
