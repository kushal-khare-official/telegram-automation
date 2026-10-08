// Remembers what the last boot imported, so a restart with the same workflows and credentials
// skips the slow import/activate CLI runs (each one boots n8n, ~40 s on a small instance).
//   node boot-state.js check <hash>   exit 0 = same as last successful boot, 1 = changed/unknown
//   node boot-state.js save <hash>
const { Client } = require('./pg-client');

const [, , cmd, hash] = process.argv;
const schema = (process.env.DB_POSTGRESDB_SCHEMA || 'n8n').replace(/[^a-z0-9_]/gi, '');

(async () => {
  const client = new Client({
    host: process.env.DB_POSTGRESDB_HOST,
    port: Number(process.env.DB_POSTGRESDB_PORT || 5432),
    database: process.env.DB_POSTGRESDB_DATABASE || 'postgres',
    user: process.env.DB_POSTGRESDB_USER,
    password: process.env.DB_POSTGRESDB_PASSWORD,
    ssl: process.env.DB_POSTGRESDB_SSL_ENABLED === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.omulimu_boot_state (id int PRIMARY KEY, hash text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now())`);
  if (cmd === 'save') {
    await client.query(`INSERT INTO ${schema}.omulimu_boot_state (id, hash) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash, saved_at = now()`, [hash]);
    await client.end();
    return;
  }
  const r = await client.query(`SELECT hash FROM ${schema}.omulimu_boot_state WHERE id = 1`);
  await client.end();
  process.exit(r.rows[0] && r.rows[0].hash === hash ? 0 : 1);
})().catch((e) => {
  console.error(`[omulimu] boot-state ${cmd}: ${e.message}`);
  process.exit(1);
});
