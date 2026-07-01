const { dbReady } = require("../src/database");
const listSessions = require("../src/tools/listSessions");
const finalizeSession = require("../src/tools/finalizeSession");

async function run() {
    try {
        await dbReady; // Esperar a que la BD esté inicializada
        const sessions = await listSessions();
        
        if (!sessions || !sessions.data) {
            console.log("No se encontraron sesiones.");
            process.exit(0);
        }
        
        console.log(`Se encontraron ${sessions.data.length} sesiones.`);
        
        for (const session of sessions.data) {
            console.log(`Finalizando sesión: ${session.session_id}`);
            await finalizeSession(session.session_id);
        }
        
        console.log("Proceso finalizado.");
        process.exit(0);
    } catch (error) {
        console.error("Error al procesar sesiones:", error);
        process.exit(1);
    }
}
run();
