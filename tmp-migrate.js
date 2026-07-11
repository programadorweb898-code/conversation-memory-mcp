const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL no está definida');
  process.exit(1);
}
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
client.connect()
  .then(async () => {
    console.log('connected');
    const res = await client.query('SELECT current_database(), current_user');
    console.log(res.rows[0]);
    await client.query('ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_related_message_id_fkey');
    await client.query('ALTER TABLE conversations ADD CONSTRAINT conversations_related_message_id_fkey FOREIGN KEY (related_message_id) REFERENCES conversations(id) ON DELETE SET NULL');
    console.log('FK updated');
    await client.end();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
