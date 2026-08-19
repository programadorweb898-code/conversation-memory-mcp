const { db, dbReady } = require("../src/database");
const listSessions = require("../src/tools/listSessions");
const finalizeSession = require("../src/tools/finalizeSession");

async function run() {
    try {
        await dbReady; // Esperar a que la BD esté inicializada

        const projects = await db.allAsync(
            `SELECT DISTINCT project FROM conversations WHERE project IS NOT NULL`
        );

        if (!projects || projects.length === 0) {
            console.log("No se encontraron proyectos con sesiones.");
            process.exit(0);
        }

        for (const row of projects) {
            const project = row.project;
            const sessions = await listSessions({ project });

            if (!sessions || sessions.length === 0) {
                continue;
            }

            console.log(`Se encontraron ${sessions.length} sesiones para el proyecto ${project}.`);

            for (const session of sessions) {
                console.log(`Finalizando sesión: ${session.session_id}`);
                await finalizeSession({ sessionId: session.session_id, project });
            }
        }

        console.log("Proceso finalizado.");
        process.exit(0);
    } catch (error) {
        console.error("Error al procesar sesiones:", error);
        process.exit(1);
    }
}
run();
