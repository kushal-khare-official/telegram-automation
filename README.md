# Omulimu: Telegram business coach in n8n

Omulimu is a Telegram bot for young business owners in Uganda. Every message is saved once, classified by one LLM call into `daily_numbers`, `business_question`, `wellbeing` or `menu_help`, and handed by a router to one of four brain sub-workflows. Every reply leaves through a single Send Reply sub-workflow.

```
Telegram Trigger → Save to messages (ON CONFLICT DO NOTHING) → LLM classifier (15-row history)
   → Router (session ownership, wellbeing always wins) → Numbers | Coach | Care | Help brain
   → Send Reply (claims the out row, 60-word cap, 429 retry) → Telegram
LLM failure after 3 tries → error branch: fallback reply → error_log → status 'failed'
Anything unhandled → Error Trigger workflow → admin chat
```

## What's in the box

| File | What it is |
|---|---|
| `workflows/01_router.json` | Telegram Trigger, dedupe, classifier + validation + repair, router, error branch |
| `workflows/02_brain_numbers.json` | Numbers brain (deterministic) + the 19:00 EAT nudge |
| `workflows/03_brain_coach.json` | Coach brain (LLM, ≤60 words, no loans, loan guard) |
| `workflows/04_brain_care.json` | Care brain (fixed templates, support line, flags for a human, alerts admin) |
| `workflows/05_brain_help.json` | Help brain (menu with 4 buttons, today's record, how it works) |
| `workflows/06_send_reply.json` | Send Reply: the only workflow that sends to a youth |
| `workflows/07_error_alert.json` | Error Trigger → admin alert |
| `schema.sql` | The 6 tables with their constraints; runs on an empty Postgres and is safe to re-run |
| `prompts.md` | Classifier and Coach prompts, all templates, and one line per design choice |
| `credentials/credentials.example.json` | Template for the 3 n8n credentials (exports carry only id + name) |
| `docker-compose.yml`, `.env.example` | Self-hosted n8n 1.123.84 (+ optional Caddy for HTTPS) |
| `src/` | Source of truth: Code-node logic (`src/lib`), workflow definitions, build + lint |
| `tests/` | Unit tests, a local end-to-end suite (mock Telegram/LLM), live-test scripts, SQL checks |

The exported workflows contain no secrets. The bot token, the LLM key and the database password are stored in n8n credentials or `.env`. `node src/build.js` fails if anything that looks like a token or key gets into an export.

## Setup (10 steps)

1. **Bot.** Create the bot with @BotFather and copy its token. Message @userinfobot to get your own chat id; it is the admin chat and the test chat.
2. **Database.** In a new Supabase project, open the SQL editor. In `schema.sql`, change the seed row at the bottom to your chat id and a business type, then run the file.
3. **Server.** You need a host with Docker and a domain pointing at it (Telegram webhooks need HTTPS). `git clone` this repo there.
4. **Env.** Run `cp .env.example .env` and fill in `DOMAIN`, `N8N_ENCRYPTION_KEY` (`openssl rand -hex 32`), `TELEGRAM_BOT_TOKEN`, `SUPPORT_LINE`, `ADMIN_CHAT_ID` and the LLM settings (OpenRouter by default).
5. **Credentials.** Run `cp credentials/credentials.example.json credentials/credentials.json` and fill in the Supabase connection (Project Settings → Database → *Session pooler*, port 5432), your OpenRouter key (`Bearer sk-or-…`) and the bot token.
6. **Start.** Run `docker compose --profile https up -d`. Leave out `--profile https` if you already have a reverse proxy or tunnel.
7. **Import.** Run:
   ```bash
   docker compose exec n8n n8n import:credentials --input=/import/credentials/credentials.json
   docker compose exec n8n n8n import:workflow --separate --input=/import/workflows
   rm credentials/credentials.json   # the secrets now live encrypted inside n8n
   ```
   Use the CLI import, not the UI. It keeps the fixed workflow IDs that the Execute Workflow nodes and the error workflow point to.
8. **Activate.** Activate the router and the Numbers brain (for the 19:00 nudge), then restart n8n:
   ```bash
   docker compose exec n8n n8n update:workflow --id=omulimuRouter001 --active=true
   docker compose exec n8n n8n update:workflow --id=omulimuNumbers01 --active=true
   docker compose restart n8n
   ```
   On activation, the Telegram Trigger registers its webhook with Telegram.
9. **Owner account.** Open `https://$DOMAIN`, create the n8n owner account, and check that the 7 "Omulimu" workflows are there and the router is active.
10. **Smoke test.** Send `/help` to the bot: you should see the menu with 4 buttons. Then work through the tests below.

## Testing

**Unit tests and build check** (no services needed): `npm test`. This runs 18 tests on the Code-node logic and checks that `workflows/*.json` and `prompts.md` match `src/`.

**Local end-to-end suite** (real n8n and real Postgres, with Telegram and the LLM mocked): `npm run e2e:local`. It needs a local stack; `tests/e2e/README.md` shows how to start it. It covers T1–T14 plus repair and fallback, a 429 from Telegram, the 60-word cut, Coach LLM failure, buttons, `/undo`, the Care session and the nudge query. **All 55 checks pass on n8n 1.123.84 with Postgres 16.**

**Live bot**

| Test | How |
|---|---|
| T1–T5, T9, T10, T12–T14 | Type the message to the bot in Telegram |
| T6 | `N8N_URL=https://$DOMAIN CHAT_ID=<you> node tests/e2e/post-update.js --text "hi" --update-id 900001 --times 2` |
| T11 | `... node tests/e2e/post-update.js --text "hi" --update-id 900002 --parallel 2` |
| T7 | Send `/fail_llm`, or set `FORCE_LLM_FAIL=true` in `.env` and run `docker compose up -d` |
| T8 | Send a sticker or a photo (`--sticker` / `--photo` in the script also works) |
| Check | Run `tests/sql/checks.sql` in the Supabase SQL editor |

The script computes the `X-Telegram-Bot-Api-Secret-Token` header that the Telegram Trigger requires. n8n builds it as `<workflow id>_<trigger node id>`, which for this export is `omulimuRouter001_b669f61d-32bf-4cfe-a868-f7e296529775`. The webhook path is `/webhook/17146771-b6a5-460a-ac6d-a4b5cf18af82/webhook`. Posting without that header returns 403.

## How a message flows (router, node by node)

1. **Telegram Trigger** receives the update, checks the secret header, and acknowledges straight away.
2. **Normalize Update** extracts chat id, name, text and button data, and flags non-text and edited messages.
3. **Upsert User** makes sure the youth exists. It never overwrites `business_type`.
4. **Save Inbound** runs `INSERT … ON CONFLICT (telegram_update_id) DO NOTHING RETURNING id`. **Is New?**: if no id came back, it's a Telegram retry and the run stops there, with no second classification or reply.
5. **Is Text?**: stickers, photos and edited messages are set to `ignored` and get a "text only for now" reply.
6. **Load Context** loads the profile, the open session and the last 15 `messages` rows in one query.
7. **Build Classifier Request → LLM Classify** makes one call at temperature 0 in JSON mode, with 3 tries and a 20 s timeout. The error output leads to the error branch.
8. **Validate Classification** checks the schema and turns amounts into integers. **Valid?** If not: **Build Repair Request → LLM Repair → Validate Repair**. If it's still invalid: the Coach brain with `status = 'fallback'`.
9. **Save Routing** writes `routing_history` (route, reason, confidence, raw output, latency, model) and stores the detected language.
10. **Decide Route** applies the session rules (below). **Which Brain?** then calls one brain with Execute Workflow.
11. **Brain Result → Apply Session** upserts or deletes the session row. **Build Reply → Send Reply → Mark Processed**. If the Care brain asked for it, **Send Admin Alert** follows.
12. **Error branch** (an LLM node's error output, or a brain that returns an error): **Build Fallback → Send Fallback Reply → Log Error → Mark Failed**.

**Session rules (`src/lib/route.js`).**
- `wellbeing` always wins: any open session closes unsaved and the Care brain opens or continues.
- In a Care session, only `daily_numbers` or `business_question` ends it, and that message goes straight to that brain. Anything else, `/help` included, gets the check-in template.
- In a Numbers session, everything goes to the Numbers brain except `menu_help`, which cancels the session unsaved.
- With no session, the route picks the brain. A button tap's `callback_data` picks the exact action.

## Adding a fifth intent (e.g. `complaint`)

Edit `src/`, then run `npm run build` and re-import:

1. `src/lib/prompts.js`: add the route definition, its priority, and add it to the OUTPUT enum.
2. `src/lib/classifier.js`: add it to `ROUTES`.
3. `src/lib/route.js`: add `complaint: 'complaint'` to `ROUTE_TO_BRAIN`.
4. `src/workflows/helpers.js`: add a workflow id. Create `src/workflows/08_brain_complaint.js` by copying the Help brain with a one-line reply.
5. `src/workflows/01_router.js`: add `'complaint'` to the `Which Brain?` switch, add a `callWorkflow('Complaint Brain', …)` node, and link it to `Brain Result`.
6. In the database: `ALTER TABLE routing_history DROP CONSTRAINT routing_history_route_check, ADD CONSTRAINT routing_history_route_check CHECK (route IN ('daily_numbers','business_question','wellbeing','menu_help','complaint'));`

To do it directly in the n8n editor instead, edit the same constants inside the Code nodes **Build Classifier Request** (prompt), **Validate Classification** and **Validate Repair** (`ROUTES`) and **Decide Route** (`ROUTE_TO_BRAIN`). Then add the Switch output and the Execute Workflow node. Each Code node carries its own copy of the shared helpers, marked `// ---- lib/x.js ----`; the node's own logic is under `// ---- node logic ----`.

## Known limits

- **I tested against mocks, not the live services.** I ran every workflow in a real n8n with a real Postgres, but with mocked Telegram and LLM endpoints. I haven't run it against Supabase, Telegram and OpenRouter myself, so it needs one pass of the live tests before submission. Anything that depends on the LLM's judgement (Luganda nuance, distress detection, T13 injection) has only been checked by reading the prompt.
- **The Luganda and mixed templates need a native speaker's review.** I wrote them, and Luganda isn't my first language.
- **"emitwalo ataano"** literally reads as 500,000, but the brief says 50,000. I followed the brief, so the parser and the prompt map it to 50,000.
- **In a Numbers session, a business question just re-asks for the missing number.** This follows "Session steps, exactly": only `/help` and wellbeing leave the session. The brief's general rule ("unless the youth clearly changes topic") could also be read as letting `business_question` go to the Coach.
- **If Postgres is down for more than ~3 seconds when a message arrives, the youth gets no reply.** Telegram has already been acknowledged, so it won't resend. The admin still gets an alert sent directly to Telegram. A queue in front of the router would fix this.
- **A reply that fails all 3 send attempts is marked `failed` and not retried.** Send Reply claims the out row before sending, so a reply can never go out twice; the cost is that a reply can occasionally go missing.
- **The 19:00 nudge sends one message at a time.** That's fine for hundreds of youths, but thousands would need batching under Telegram's ~30 messages/second limit.
- **n8n keeps execution data for 14 days, and it contains message text.** Shorten `EXECUTIONS_DATA_MAX_AGE` for real users.
- **`/help` and button taps keep the youth's previous language.** They carry no language signal, so they don't overwrite it. The numbers prompts and the today's-record line are fixed English, as in the brief.

## With 2 more days

1. **A labelled eval set.** About 150 real-style messages in English, Luganda and mixed, including distress hidden inside numbers and injection attempts. Run the classifier prompt against it in CI, and score from `routing_history` (route accuracy, confidence calibration, latency).
2. **A queue in front of the router.** Use n8n queue mode with Redis, so a database or LLM outage delays messages instead of dropping them. Store raw updates first.
3. **Prompt versioning.** Add a `prompt_version` column to `routing_history`, so evals compare versions. Then route most turns to a cheaper model and send only low-confidence or wellbeing-adjacent turns to a stronger one.
4. **Human handoff for Care.** A small admin view of `needs_human` chats, an acknowledge button, and a log of who followed up.
5. **Native-speaker review** of every template, plus a few Luganda few-shot examples from real (anonymised, consented) chats.

## Questions for the client (post in the Upwork thread)

1. Which support line should Care use (`SUPPORT_LINE`)? Should it change by region or time of day?
2. In a Numbers session, should a clear business question go to the Coach, or should the bot keep asking for the missing number, as "Session steps, exactly" says?
3. Should "emitwalo ataano" mean 50,000 (as in the brief) or 500,000 (the literal reading)?
4. Should the 19:00 nudge and the numbers prompts also come in Luganda and mixed versions, or stay in the exact English wording?
5. Who watches the admin chat for Care alerts, and how fast should a human follow up?
