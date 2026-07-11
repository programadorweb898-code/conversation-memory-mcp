const dotenv = require("dotenv");
dotenv.config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ Error: No se encontró la variable DATABASE_URL en el archivo .env");
  process.exit(1);
}

try {
  // Parseamos la URL para extraer solo el host de forma segura
  const url = new URL(dbUrl);
  console.log("=== DIAGNÓSTICO DE CONEXIÓN ===");
  console.log("Host detectado:", url.hostname);
  console.log("Puerto:", url.port || "5432 (defecto)");
  
  if (!url.hostname.includes("render.com")) {
    console.log("\n⚠️ ALERTA DETECTADA:");
    console.log("Parece que estás usando la URL INTERNA de Render (ej. dpg-xxx-a).");
    console.log("Termux está corriendo en tu dispositivo móvil (fuera de Render), por lo que");
    console.log("obligatoriamente debes usar la EXTERNAL DATABASE URL (la que termina en .render.com).");
  } else {
    console.log("\n✅ El host parece ser correcto (es externo de Render).");
    console.log("Si la conexión sigue fallando, las causas probables son:");
    console.log("1. Tu base de datos gratuita de Render está suspendida (dormida). Entra al panel de Render para despertarla.");
    console.log("2. Tu red actual (datos móviles o WiFi) tiene bloqueado el puerto 5432.");
  }
} catch (e) {
  console.error("❌ Error al parsear la URL de la base de datos:", e.message);
}
