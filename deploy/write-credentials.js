// Builds the n8n credentials import file from env vars (same ids/names as
// credentials/credentials.example.json, which the workflow exports reference).
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const creds = [
  {
    id: 'omulimuPostgres1',
    name: 'Omulimu Postgres',
    type: 'postgres',
    data: {
      host: env('DB_POSTGRESDB_HOST'),
      port: Number(env('DB_POSTGRESDB_PORT', 5432)),
      database: env('DB_POSTGRESDB_DATABASE', 'postgres'),
      user: env('DB_POSTGRESDB_USER'),
      password: env('DB_POSTGRESDB_PASSWORD'),
      // Supabase needs TLS; its pooler certificate is not in the default trust store.
      ssl: env('DB_SSL', 'true') === 'true' ? 'require' : 'disable',
      ...(env('DB_SSL', 'true') === 'true' ? { allowUnauthorizedCerts: true } : {}),
    },
  },
  {
    id: 'omulimuLlmKey001',
    name: 'Omulimu LLM key',
    type: 'httpHeaderAuth',
    data: { name: 'Authorization', value: `Bearer ${env('LLM_API_KEY', 'missing-key')}` },
  },
  {
    // OpenAI Decisions API classifier. Imported even without a key so the workflow reference
    // resolves; the router only uses it when OPENAI_API_KEY is set (or CLASSIFIER_MODE=decisions).
    id: 'omulimuOpenAiKy1',
    name: 'Omulimu OpenAI key',
    type: 'httpHeaderAuth',
    data: { name: 'Authorization', value: `Bearer ${env('OPENAI_API_KEY', 'missing-key')}` },
  },
  {
    id: 'omulimuTelegram1',
    name: 'Omulimu Telegram bot',
    type: 'telegramApi',
    data: { accessToken: env('TELEGRAM_BOT_TOKEN'), baseUrl: env('TELEGRAM_API_BASE', 'https://api.telegram.org') },
  },
];

for (const k of ['DB_POSTGRESDB_HOST', 'DB_POSTGRESDB_USER', 'DB_POSTGRESDB_PASSWORD', 'TELEGRAM_BOT_TOKEN']) {
  if (!env(k)) {
    console.error(`[omulimu] missing env ${k}`);
    process.exit(1);
  }
}
process.stdout.write(JSON.stringify(creds));
