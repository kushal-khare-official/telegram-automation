# End-to-end tests

| File | Use |
|---|---|
| `post-update.js` | Posts a Telegram-shaped update to the router webhook, with the right secret header. Works on the live bot (T6, T11, T8) and locally. |
| `mock-server.js` | A fake Telegram Bot API plus a fake OpenAI-compatible LLM, so the real workflows run with no token or key. |
| `local-suite.js` | T1–T14 plus edge cases against a local n8n wired to the mock (55 checks). |

## Running the local suite

You need Node 20+, a Postgres you can reach with `psql`, and n8n 1.123.84 (`npm i n8n@1.123.84` in a scratch folder).

```bash
# 1. database
createdb omulimu && psql -d omulimu -f schema.sql

# 2. mock Telegram + LLM on :9000
node tests/e2e/mock-server.js &

# 3. n8n pointed at the mock (env read by the workflows)
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false GENERIC_TIMEZONE=Africa/Kampala WEBHOOK_URL=http://127.0.0.1:5678/ \
       TELEGRAM_API_BASE=http://127.0.0.1:9000 TELEGRAM_BOT_TOKEN=123:mock \
       LLM_BASE_URL=http://127.0.0.1:9000/v1 LLM_MODEL=mock-model ADMIN_CHAT_ID=999 \
       SUPPORT_LINE="Support line 0800 000 000 (toll free)"
#    credentials: copy credentials/credentials.example.json, point Postgres at your local db (ssl "disable",
#    no allowUnauthorizedCerts) and set the Telegram credential's baseUrl to http://127.0.0.1:9000
n8n import:credentials --input=creds.local.json
n8n import:workflow --separate --input=workflows
n8n update:workflow --id=omulimuRouter001 --active=true
n8n start &

# 4. run
PSQL="psql -d omulimu" node tests/e2e/local-suite.js            # everything
PSQL="psql -d omulimu" node tests/e2e/local-suite.js T9 T10     # by name prefix
```

The suite truncates the message tables between tests, so never point it at a real database.

## What the mock can't tell you

The fake classifier works on keywords, so the suite checks the plumbing: deduplication, sessions, routing, the error branch, retries, the 60-word cap and Kampala dates. It doesn't check whether the real model classifies Luganda distress or injection attempts correctly. Run the live tests in the main README for that.

Magic words for the mock: `BADJSON` (invalid classifier output once), `BADJSON2` (invalid twice), `RATELIMIT` (Telegram 429 once), `LONGREPLY` (a 90-word Coach reply), `LOANREPLY` (the Coach suggests a lending app), `COACHFAIL` (Coach LLM returns 500).
