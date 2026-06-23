const { db } = require('../src/database');

async function cleanupProtocolLogs() {
  console.log("Iniciando limpieza de logs de protocolo...");
  
  const ignoredMethods = [
    "%initialize%",
    "%notifications/initialized%",
    "%tools/list%",
    "%tools/call%",
    "%$/cancelRequest%"
  ];

  try {
    // Construimos una consulta que elimine los mensajes cuyo contenido contenga los métodos ignorados
    // Nota: Esto es un enfoque agresivo pero seguro para los patrones de logs identificados.
    const query = `
      DELETE FROM conversations
      WHERE content LIKE $1 OR content LIKE $2 OR content LIKE $3 OR content LIKE $4 OR content LIKE $5
    `;
    
    const result = await db.runAsync(query, ignoredMethods);
    console.log(`Limpieza completada. Filas eliminadas: ${result.changes || 'desconocido'}`);
  } catch (error) {
    console.error("Error durante la limpieza:", error.message);
  } finally {
    process.exit();
  }
}

cleanupProtocolLogs();
