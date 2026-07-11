const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error('DATABASE_URL no está definida.');
  process.exit(1);
}

const url = rawUrl.replace(/^postgresql:/, 'postgres');
console.log('URL usada:', url.replace(/:[^:@]+@/, ':***@'));

(async () => {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
    query_timeout: 60000,
    connectionTimeoutMillis: 60000,
  });

  try {
    console.log('Intentando conectar a la base de datos...');
    await client.connect();
    console.log('Conectado a la base de datos.');

    await client.query(`
      ALTER TABLE conversations
      DROP CONSTRAINT IF EXISTS conversations_related_message_id_fkey;
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD CONSTRAINT conversations_related_message_id_fkey
      FOREIGN KEY (related_message_id)
      REFERENCES conversations(id)
      ON DELETE SET NULL;
    `);

    console.log('FK actualizada con ON DELETE SET NULL.');

    const res = await client.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'conversations'
        AND kcu.column_name = 'related_message_id';
    `);

    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
