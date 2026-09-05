const { Pool } = require('pg');
const dotenv=require("dotenv");
dotenv.config();
// Configuración basada en variables de entorno (Render te dará esta URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para conexiones externas en Render
  }
});

// Sin este listener, un error en una conexión idle del pool puede tirar
// el proceso completo (uncaughtException) en vez de solo loguearse.
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres (conexión idle):', err.message);
});

// Fuente de verdad de los valores garantizados por CHECK en
// memory_candidates. Deben mantenerse alineadas con
// memoryAuditEngine.ALLOWED_STATUSES y extractMemories.MEMORY_TYPES: si el
// código intenta escribir un valor fuera de estos conjuntos, Postgres lo
// rechaza explícitamente (falla ruidosa en vez de datos corruptos).
const MEMORY_CANDIDATE_STATUSES = [
  'missing',
  'already_exists',
  'related',
  'possible_duplicate',
  'conflict',
  'pending',
  'discard',
];

const MEMORY_CANDIDATE_TYPES = [
  'decision',
  'discovery',
  'constraint',
  'configuration',
  'lesson',
];

/**
 * Formatea una lista de valores como una lista IN (''... ) para CHECK.
 * @param {string[]} values
 * @returns {string}
 */
function inList(values) {
  return values.map((v) => `'${v}'`).join(', ');
}

/**
 * Ejecuta `work` bajo un advisory lock de transacción (pg_advisory_xact_lock).
 * El lock se toma dentro de una transacción explícita sobre una conexión
 * dedicada del pool. Es la única forma confiable en Neon (transaction pooling):
 * un lock de sesión se pierde cuando el proxy rota la sesión al terminar una
 * query en autocommit, mientras que el lock transaccional queda anclado a la
 * transacción activa y se libera automáticamente al hacer COMMIT/ROLLBACK o si
 * se cae la conexión. Los advisory locks son a nivel de cluster, así que
 * serializa también entre procesos/instancias que compartan la base.
 * @param {string} key - Identificador de la sección crítica.
 * @param {Function} work - Trabajo a ejecutar bajo el lock.
 * @returns {Promise<*>} Resultado de `work`.
 */
async function withAdvisoryLock(key, work) {
  const client = await pool.connect();
  const lockValue = hashtext(`advisory:${key}`);
  let transactionActive = false;
  try {
    await client.query(`BEGIN`);
    transactionActive = true;
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockValue]);
    const result = await work();
    await client.query(`COMMIT`);
    transactionActive = false;
    return result;
  } finally {
    if (transactionActive) {
      try {
        await client.query(`ROLLBACK`);
      } catch (err) {
        console.error('Error haciendo ROLLBACK del advisory lock:', err.message);
      }
    }
    client.release();
  }
}

/**
 * Hash int4 (equivalente a hashtext() de Postgres) para usar como clave del
 * advisory lock sin depender de funciones SQL en el lado del cliente.
 * @param {string} value
 * @returns {number}
 */
function hashtext(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // mantiene int32
  }
  return hash;
}

// Interfaz compatible con nuestras promesas anteriores
const db = {
  query: (sql, params) => pool.query(sql, params),
  
  // Adaptamos las funciones para mantener compatibilidad
  runAsync: async (sql, params = []) => {
    // Postgres usa $1, $2, etc. en lugar de ?
    const result = await pool.query(sql, params);
    return { changes: result.rowCount };
  },
  
  getAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows[0];
  },
  
  allAsync: async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
  },
  
  close: async () => {
    await pool.end();
  }
};

// Inicialización de tablas
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        project TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT
      );
    `);
    
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)`);
    
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_embeddings (
        message_id TEXT PRIMARY KEY,
        embedding vector(384) NOT NULL,
        FOREIGN KEY(message_id) REFERENCES conversations(id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_message_embeddings_hnsw_cosine ON message_embeddings USING hnsw (embedding vector_cosine_ops);`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS embedding_failures (
        message_id TEXT PRIMARY KEY,
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(message_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        topic_key TEXT,
        what TEXT,
        why TEXT,
        where_context TEXT,
        learned TEXT,
        importance TEXT,
        status TEXT NOT NULL,
        source_message_ids JSONB NOT NULL DEFAULT '[]',
        engram_id TEXT,
        engram_topic_key TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        audited_at TIMESTAMP,
        promoted_at TIMESTAMP,
        CONSTRAINT chk_memory_candidates_status CHECK (status IN (${inList(MEMORY_CANDIDATE_STATUSES)})),
        CONSTRAINT chk_memory_candidates_type CHECK (type IN (${inList(MEMORY_CANDIDATE_TYPES)}))
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_candidates_project ON memory_candidates(project)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_candidates_session_id ON memory_candidates(session_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_candidates_status ON memory_candidates(status)`);

    // Bases creadas antes de estos CHECK no los tendrían (CREATE TABLE IF NOT
    // EXISTS es no-op). Postgres no soporta IF NOT EXISTS en ADD CONSTRAINT, así
    // que se aplican de forma idempotente con un DO. Falla si hubiera datos
    // previos que violen el dominio: es la señal correcta ante datos corruptos.
    await client.query(`
      DO $constraints$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_memory_candidates_status') THEN
          ALTER TABLE memory_candidates
            ADD CONSTRAINT chk_memory_candidates_status
            CHECK (status IN (${inList(MEMORY_CANDIDATE_STATUSES)}));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_memory_candidates_type') THEN
          ALTER TABLE memory_candidates
            ADD CONSTRAINT chk_memory_candidates_type
            CHECK (type IN (${inList(MEMORY_CANDIDATE_TYPES)}));
        END IF;
      END
      $constraints$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY,
        project TEXT,
        summary TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`ALTER TABLE session_summaries ADD COLUMN IF NOT EXISTS project TEXT;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_summary_embeddings (
        session_id TEXT PRIMARY KEY,
        embedding vector(384) NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session_summaries(session_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_session_summary_embeddings_hnsw_cosine ON session_summary_embeddings USING hnsw (embedding vector_cosine_ops);`);
    await client.query(`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS related_message_id TEXT 
      REFERENCES conversations(id);
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS sequence_id BIGINT;
    `);

    await client.query(`
      UPDATE conversations
      SET sequence_id = subquery.new_seq
      FROM (
        SELECT id, row_number() OVER (ORDER BY timestamp ASC, id ASC) AS new_seq
        FROM conversations
      ) AS subquery
      WHERE conversations.id = subquery.id
        AND conversations.sequence_id IS NULL;
    `);

    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS conversations_seq;
    `);

    const nextSequenceValue = await client.query(`
      SELECT COALESCE(MAX(sequence_id), 0) + 1 AS next_val
      FROM conversations;
    `);
    await client.query(`SELECT setval('conversations_seq', ${nextSequenceValue.rows[0].next_val});`);

    await client.query(`
      ALTER TABLE conversations
      ALTER COLUMN sequence_id SET DEFAULT nextval('conversations_seq');
    `);

    await client.query(`
      ALTER TABLE conversations
      ALTER COLUMN sequence_id SET NOT NULL;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_sequence
      ON conversations (sequence_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_session_id_sequence_id
      ON conversations (session_id, sequence_id);
    `);

    await client.query(`
      ALTER TABLE session_summaries
      ADD COLUMN IF NOT EXISTS last_processed_seq_id BIGINT;
    `);

    const sessionSummaryFkRes = await client.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'session_summary_embeddings'
        AND kcu.column_name = 'session_id';
    `);

    for (const row of sessionSummaryFkRes.rows) {
      const constraintName = row.constraint_name;
      console.log(`Actualizando FK ${constraintName} de 'session_summary_embeddings' a ON DELETE CASCADE...`);
      await client.query(`ALTER TABLE session_summary_embeddings DROP CONSTRAINT ${constraintName}`);
      await client.query(`
        ALTER TABLE session_summary_embeddings
        ADD CONSTRAINT ${constraintName}
        FOREIGN KEY (session_id)
        REFERENCES session_summaries(session_id)
        ON DELETE CASCADE
      `);
      console.log(`FK ${constraintName} actualizada exitosamente.`);
    }

    // Buscar y actualizar la FK de related_message_id para que sea ON DELETE SET NULL
    const fkRes = await client.query(`
      SELECT 
          tc.constraint_name,
          rc.delete_rule
      FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.referential_constraints AS rc
            ON tc.constraint_name = rc.constraint_name
            AND tc.constraint_schema = rc.constraint_schema
      WHERE 
          tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_name = 'conversations'
          AND kcu.column_name = 'related_message_id';
    `);

    for (const row of fkRes.rows) {
      if (row.delete_rule !== 'SET NULL') {
        const constraintName = row.constraint_name;
        console.log(`Actualizando FK ${constraintName} de 'conversations' a ON DELETE SET NULL...`);
        await client.query(`ALTER TABLE conversations DROP CONSTRAINT ${constraintName}`);
        await client.query(`
          ALTER TABLE conversations 
          ADD CONSTRAINT ${constraintName} 
          FOREIGN KEY (related_message_id) 
          REFERENCES conversations(id) 
          ON DELETE SET NULL
        `);
        console.log(`FK ${constraintName} actualizada exitosamente.`);
      }
    }

    console.log("Tablas inicializadas correctamente en Postgres.");
  } catch (err) {
    console.error("Error inicializando tablas:", err);
  } finally {
    client.release();
  }
}

const dbReady = initDb();

module.exports = { db, dbReady, withAdvisoryLock };
