const { db } = require("../src/database");

async function runMigration() {
  try {
    console.log("Iniciando migración de secuencia...");

    // 1. Añadir columna
    await db.runAsync("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sequence_id BIGINT");

    // 2. Backfill
    await db.runAsync(`
      UPDATE conversations 
      SET sequence_id = subquery.new_seq
      FROM (
          SELECT id, row_number() OVER (ORDER BY timestamp ASC, id ASC) as new_seq
          FROM conversations
      ) AS subquery
      WHERE conversations.id = subquery.id
      AND conversations.sequence_id IS NULL
    `);

    // 3. Crear secuencia
    await db.runAsync("CREATE SEQUENCE IF NOT EXISTS conversations_seq");

    // 4. Sincronizar
    const res = await db.getAsync("SELECT COALESCE(MAX(sequence_id), 0) + 1 as next_val FROM conversations");
    await db.runAsync(`SELECT setval('conversations_seq', ${res.next_val})`);

    // 5. DEFAULT
    await db.runAsync("ALTER TABLE conversations ALTER COLUMN sequence_id SET DEFAULT nextval('conversations_seq')");

    // 6. NOT NULL
    await db.runAsync("ALTER TABLE conversations ALTER COLUMN sequence_id SET NOT NULL");

    // 7. Migrar session_summaries
    // Renombrar (manejo manual porque DO no funciona fácil en db.runAsync)
    const columnExists = await db.getAsync("SELECT 1 FROM information_schema.columns WHERE table_name='session_summaries' AND column_name='last_processed_message_id'");
    if (columnExists) {
        await db.runAsync("ALTER TABLE session_summaries RENAME COLUMN last_processed_message_id TO last_processed_seq_id");
    }
    
    // Limpieza y cast
    await db.runAsync("UPDATE session_summaries SET last_processed_seq_id = NULL WHERE last_processed_seq_id::text ~ '[^0-9]'");
    await db.runAsync("ALTER TABLE session_summaries ALTER COLUMN last_processed_seq_id TYPE BIGINT USING last_processed_seq_id::bigint");

    // 8. Índice
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_conversations_sequence ON conversations(sequence_id)");

    console.log("Migración completada con éxito.");
  } catch (err) {
    console.error("Error en la migración:", err);
    process.exit(1);
  } finally {
    await db.close();
  }
}

runMigration();
