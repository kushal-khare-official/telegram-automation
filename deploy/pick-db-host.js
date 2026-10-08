// Prints the first Supabase pooler host that accepts the Omulimu role's login.
// Supabase projects live on either aws-0-<region> or aws-1-<region>; a wrong one answers
// "Tenant or user not found", so we try each and keep the one that works.
const { Client } = require('./pg-client');

const region = process.env.SUPABASE_REGION || 'eu-central-1';
const candidates = (process.env.DB_HOST_CANDIDATES || `aws-1-${region}.pooler.supabase.com,aws-0-${region}.pooler.supabase.com`)
  .split(',').map((s) => s.trim()).filter(Boolean);

(async () => {
  for (const host of candidates) {
    const client = new Client({
      host,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER || `${process.env.DB_USER_ROLE || 'omulimu_app'}.${process.env.SUPABASE_PROJECT_REF}`,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      await client.query('select 1');
      await client.end();
      process.stdout.write(host);
      return;
    } catch (e) {
      console.error(`[omulimu] ${host}: ${e.message}`);
      try { await client.end(); } catch (_) { /* ignore */ }
    }
  }
  process.exit(1);
})();
