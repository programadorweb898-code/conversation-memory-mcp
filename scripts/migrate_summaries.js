const { db } = require("../src/database");

async function migrate() {
  console.log("Iniciando migración: Añadiendo last_processed_message_id a session_summaries");
  try {
    await db.query(`
      ALTER TABLE session_summaries 
      ADD COLUMN last_processed_message_id TEXT
    `);
    console.log("Migración completada exitosamente.");
  } catch (err) {
    if (err.code === '42701') { // error column already exists
      console.log("La columna ya existe, saltando migración.");
    } else {
      console.error("Error en la migración:", err);
      process.exit(1);
    }
  }
}

migrate();
