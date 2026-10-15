const { db } = require("../database");

async function getSessionRevision(sessionId, owner, query = (sql, params) => db.getAsync(sql, params)) {
  const row = await query(
    "SELECT revision FROM session_revisions WHERE session_id = $1 AND owner = $2",
    [sessionId, owner]
  );
  return String(row?.revision ?? "0");
}

module.exports = { getSessionRevision };
