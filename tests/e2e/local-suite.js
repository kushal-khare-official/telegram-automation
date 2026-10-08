#!/usr/bin/env node
// Runs the acceptance tests against a LOCAL n8n wired to tests/e2e/mock-server.js and a local Postgres.
// It checks the plumbing (dedupe, sessions, routing, error branch, 429, 60-word cap, Kampala date).
// LLM judgement (real Luganda, real distress detection, injection) needs the live bot; see README.
//
//   PSQL="psql -h /tmp -p 5433 -U postgres -d omulimu" N8N_URL=http://127.0.0.1:5678 \
//   MOCK_URL=http://127.0.0.1:9000 node tests/e2e/local-suite.js

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PSQL = (process.env.PSQL || 'psql -h /tmp -p 5433 -U postgres -d omulimu').split(' ');
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:9000';
const CHAT = 123456789;
const ADMIN = String(process.env.ADMIN_CHAT_ID || 999);
let updateId = 5000;
let failures = 0;

const sql = (q) => execFileSync(PSQL[0], [...PSQL.slice(1), '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const rows = (q) => JSON.parse(sql(`SELECT COALESCE(json_agg(t), '[]') FROM (${q}) t`));
const one = (q) => rows(q)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (s) => (String(s || '').match(/\S+/g) || []).length;

async function mock(p, method = 'GET') {
  return (await fetch(MOCK + p, { method })).json();
}

function post(text, extra = []) {
  const id = ++updateId;
  execFileSync('node', [path.join(__dirname, 'post-update.js'), '--text', text, '--update-id', String(id), '--chat', String(CHAT), ...extra], { encoding: 'utf8' });
  return id;
}

// Wait until the router finished with this update: its in row has left 'received'.
async function settle(id, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = one(`SELECT status FROM messages WHERE telegram_update_id = ${id}`);
    if (r && r.status !== 'received') { await sleep(700); return r.status; }
    await sleep(300);
  }
  return 'timeout';
}

async function say(text, extra) {
  const before = (await mock('/__sent')).length;
  const id = post(text, extra);
  const status = await settle(id);
  const sent = (await mock('/__sent')).slice(before).filter((s) => s.method === 'sendMessage');
  const youth = sent.filter((s) => s.chat_id === String(CHAT));
  const admin = sent.filter((s) => s.chat_id === ADMIN);
  const msg = one(`SELECT id, status FROM messages WHERE telegram_update_id = ${id}`);
  const route = msg && one(`SELECT route, status, entities FROM routing_history WHERE inbound_message_id = ${msg.id}`);
  return { id, status, youth, admin, reply: youth[0] && youth[0].text, msg, route };
}

const session = () => one(`SELECT active_brain, step, context FROM sessions WHERE chat_id = ${CHAT}`) || null;
const today = () => one(`SELECT sales_ugx, expenses_ugx, profit_ugx FROM daily_records WHERE chat_id = ${CHAT} AND record_date = (now() AT TIME ZONE 'Africa/Kampala')::date`) || null;

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
}

async function reset() {
  sql(`TRUNCATE messages, routing_history, sessions, daily_records, error_log RESTART IDENTITY CASCADE;
       UPDATE users SET needs_human = false, language = 'mixed' WHERE chat_id = ${CHAT}`);
  await mock('/__reset', 'POST');
}

const tests = {
  async T1() {
    const r = await say('Leero natunze 120k, expenses 45,000');
    check('route daily_numbers, amounts as integers', r.route.route === 'daily_numbers' && r.route.entities.sales_ugx === 120000 && r.route.entities.expenses_ugx === 45000, r.route);
    check('record upserted 120000/45000/75000', JSON.stringify(today()) === JSON.stringify({ sales_ugx: 120000, expenses_ugx: 45000, profit_ugx: 75000 }), today());
    check('reply shows profit UGX 75,000', /profit UGX 75,000/.test(r.reply), r.reply);
    check('no session left open', session() === null, session());
  },
  async T2_T3() {
    const r2 = await say('Today I sold 80k');
    check('T2 asks for expenses', r2.reply === 'How much did you spend on the business today, in UGX? For example: 20k.', r2.reply);
    check('T2 session numbers/ask_expenses', session() && session().step === 'ask_expenses' && session().context.sales_ugx === 80000, session());
    const r3 = await say('30k');
    check('T3 record profit 50,000', today() && today().profit_ugx === 50000, today());
    check('T3 reply shows profit UGX 50,000', /profit UGX 50,000/.test(r3.reply), r3.reply);
    check('T3 session closed', session() === null, session());
  },
  async T2_free_text_reasks() {
    await say('Today I sold 80k');
    const r = await say('I am not sure yet');
    check('free text in a Numbers session gets the same question', r.reply === 'How much did you spend on the business today, in UGX? For example: 20k.', r.reply);
    check('session still open', session() && session().active_brain === 'numbers', session());
    await say('/help');
    check('/help cancels the Numbers session with nothing saved', session() === null && today() === null, { s: session(), t: today() });
  },
  async T4() {
    const r = await say('How do I get more customers for my chapati stand?');
    check('business_question → Coach', r.route.route === 'business_question', r.route);
    check('60 words or fewer', words(r.reply) <= 60, r.reply);
    check('no loan advice', !/loan|borrow/i.test(r.reply), r.reply);
  },
  async T5() {
    const r = await say('/help');
    const kb = r.youth[0] && r.youth[0].reply_markup;
    check("help menu in the youth's last detected language (mixed), not reset by /help", /Nze Omulimu, your business coach/.test(r.reply) && one(`SELECT language FROM users WHERE chat_id=${CHAT}`).language === 'mixed', r.reply);
    check('4 inline buttons in 2 columns', kb && kb.inline_keyboard.length === 2 && kb.inline_keyboard.every((row) => row.length === 2), kb);
  },
  async T6() {
    const id = ++updateId;
    execFileSync('node', [path.join(__dirname, 'post-update.js'), '--text', 'Hello there', '--update-id', String(id), '--times', '2'], { encoding: 'utf8' });
    await settle(id);
    await sleep(3000);
    const c = one(`SELECT (SELECT count(*) FROM messages WHERE direction='in') AS ins, (SELECT count(*) FROM messages WHERE direction='out') AS outs, (SELECT count(*) FROM routing_history) AS routed`);
    const sent = (await mock('/__sent')).filter((s) => s.method === 'sendMessage');
    check('1 in, 1 out, 1 routing_history row, 1 reply', c.ins === 1 && c.outs === 1 && c.routed === 1 && sent.length === 1, { ...c, sent: sent.length });
  },
  async T7() {
    const r = await say('/fail_llm');
    const calls = (await mock('/__llm')).filter((c) => c.kind === 'forced_failure');
    const err = rows('SELECT node, error FROM error_log');
    check('3 attempts at the LLM', calls.length === 3, calls.length);
    check('fallback reply sent', /Nsonyiwa, waliwo ekizibu katono/.test(r.reply), r.reply);
    check('error_log row', err.length === 1 && err[0].node === 'LLM Classify', err);
    check("message status 'failed'", r.msg.status === 'failed', r.msg);
  },
  async T8() {
    const before = (await mock('/__sent')).length;
    const id = post('', ['--sticker']);
    await settle(id);
    const sent = (await mock('/__sent')).slice(before);
    const m = one(`SELECT status FROM messages WHERE telegram_update_id = ${id}`);
    check("saved as 'ignored'", m && m.status === 'ignored', m);
    check('polite text-only reply', sent.length === 1 && /text only/i.test(sent[0].text), sent);
    const e = post('edited text', ['--edited']);
    await settle(e);
    check("edited message also 'ignored'", one(`SELECT status FROM messages WHERE telegram_update_id = ${e}`).status === 'ignored');
  },
  async T9() {
    const r = await say('Nnatunze 60k leero naye maama afudde');
    check('wellbeing wins over the amount', r.route.route === 'wellbeing', r.route);
    check('Care reply with support line, no numbers prompt', /0800 000 000/.test(r.reply) && !/How much/.test(r.reply), r.reply);
    check('Care session opened', session() && session().active_brain === 'care' && session().step === 'open', session());
    check('no record saved', today() === null, today());
    check('admin alerted', r.admin.length === 1 && r.admin[0].text.includes(String(CHAT)), r.admin);
    check('chat flagged for a human', one(`SELECT needs_human FROM users WHERE chat_id=${CHAT}`).needs_human === true);
    const h = await say('/help');
    check('/help inside Care gets template 2, session stays', /still here|Nkyali wano/i.test(h.reply) && session() && session().active_brain === 'care', { reply: h.reply, s: session() });
    const n = await say('Today I sold 40k');
    check('business intent ends Care and goes to Numbers', session() && session().active_brain === 'numbers' && /spend/.test(n.reply), { reply: n.reply, s: session() });
  },
  async T10() {
    await say('Today I sold 80k');
    const r = await say('I feel like ending it all');
    check('distress beats the Numbers session', r.route.route === 'wellbeing' && session() && session().active_brain === 'care', { route: r.route, s: session() });
    check('numbers prompt not repeated, nothing saved', !/How much/.test(r.reply) && today() === null, { reply: r.reply, t: today() });
  },
  async T11() {
    const id = ++updateId;
    execFileSync('node', [path.join(__dirname, 'post-update.js'), '--text', 'Hi again', '--update-id', String(id), '--parallel', '2'], { encoding: 'utf8' });
    await settle(id);
    await sleep(3000);
    const sent = (await mock('/__sent')).filter((s) => s.method === 'sendMessage');
    const c = one(`SELECT count(*) FILTER (WHERE direction='in') AS ins, count(*) FILTER (WHERE direction='out') AS outs FROM messages`);
    check('exactly 1 reply for a parallel duplicate', sent.length === 1 && c.ins === 1 && c.outs === 1, { sent: sent.length, ...c });
  },
  async T12_loan_guard() {
    const r = await say('Njagala loan okugaziya bizinensi LOANREPLY');
    check('Coach answers', r.route.route === 'business_question', r.route);
    check('loan guard replaced a loan suggestion', !/loan|wewole/i.test(r.reply) && /profit|magoba/i.test(r.reply), r.reply);
  },
  async T13_repair_and_fallback() {
    const a = await say('BADJSON what price for samosa?');
    check('invalid JSON → one repair → valid', a.route.status === 'repaired' && a.route.route === 'business_question', a.route);
    const b = await say('BADJSON2 something');
    check("invalid twice → Coach fallback, status 'fallback'", b.route.status === 'fallback' && b.msg.status === 'fallback' && !!b.reply, { route: b.route, msg: b.msg });
    const calls = (await mock('/__llm')).filter((c) => c.kind === 'classifier' && /BADJSON2/.test(c.text));
    check('exactly one repair call', calls.length === 2, calls.length);
  },
  async T14() {
    const r = await say('Ssebo '.repeat(1000) + 'how do I grow?');
    check('6,000-character message answered in ≤60 words', !!r.reply && words(r.reply) <= 60, r.reply);
    const d = one(`SELECT ('2026-10-07 20:30:00+00'::timestamptz AT TIME ZONE 'Africa/Kampala')::date::text AS at_2330_eat,
                          ('2026-10-07 21:30:00+00'::timestamptz AT TIME ZONE 'Africa/Kampala')::date::text AS at_0030_eat`);
    check('Kampala date expression: 23:30 EAT stays on the 7th, 00:30 EAT is the 8th', d.at_2330_eat === '2026-10-07' && d.at_0030_eat === '2026-10-08', d);
  },
  async sixty_word_cap() {
    const r = await say('LONGREPLY how to count stock?');
    const e = rows(`SELECT node FROM error_log WHERE node = 'Prepare Reply'`);
    check('long LLM reply cut to ≤60 words at a full sentence', words(r.reply) <= 60 && /\.$/.test(r.reply), r.reply);
    check('cut logged to error_log', e.length === 1, e);
  },
  async telegram_429() {
    const r = await say('RATELIMIT how to save?');
    const out = one(`SELECT attempts, status FROM messages WHERE reply_to_id = ${r.msg.id}`);
    check('429 → waits retry_after → sent on attempt 2', out && out.attempts === 2 && out.status === 'sent' && r.youth.length === 1, out);
  },
  async coach_llm_failure() {
    const r = await say('COACHFAIL how to price?');
    const e = rows(`SELECT node FROM error_log`);
    check('Coach LLM failure → fallback reply, error_log, failed', /Nsonyiwa/.test(r.reply) && e.some((x) => x.node === 'LLM Coach') && r.msg.status === 'failed', { reply: r.reply, e, msg: r.msg });
  },
  async buttons_and_undo() {
    const none = await say("Today's record", ['--callback', 'today']);
    check("Today's record with no record offers the Record button", /No record|Tewali/.test(none.reply) && none.youth[0].reply_markup.inline_keyboard[0][0].callback_data === 'record', none.reply);
    const rec = await say("Record today's numbers", ['--callback', 'record']);
    check('Record button opens a Numbers session at ask_sales', /How much did you sell today/.test(rec.reply) && session().step === 'ask_sales', rec.reply);
    await say('50k');
    await say('20k');
    const t = await say("Today's record", ['--callback', 'today']);
    check("Today's record shows the figures", /sales UGX 50,000 · expenses UGX 20,000 · profit UGX 30,000/.test(t.reply), t.reply);
    const taps = (await mock('/__sent')).filter((s) => s.method === 'answerCallbackQuery');
    check('button taps are answered', taps.length >= 3, taps.length);
    const how = await say('How Omulimu works', ['--callback', 'how']);
    check('How Omulimu works: four lines', how.reply.split('\n').length === 4, how.reply);
    const u = await say('/undo');
    check('/undo removes today\'s record', today() === null && /removed|giddwawo/.test(u.reply), u.reply);
  },
  async nudge_sql() {
    // Runs the nudge queries exactly as they are in workflows/02_brain_numbers.json.
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows/02_brain_numbers.json'), 'utf8'));
    const q = (name) => wf.nodes.find((n) => n.name === name).parameters.query;
    sql(`INSERT INTO users (chat_id, first_name) VALUES (222, 'Recorded'), (333, 'InCare'), (444, 'StaleNumbers') ON CONFLICT DO NOTHING;
         INSERT INTO daily_records (chat_id, record_date, sales_ugx, expenses_ugx, profit_ugx) VALUES (222, (now() AT TIME ZONE 'Africa/Kampala')::date, 1, 1, 0);
         INSERT INTO sessions (chat_id, active_brain, step) VALUES (333, 'care', 'open'), (444, 'numbers', 'ask_expenses')`);
    sql(q('Close Stale Numbers Sessions'));
    // data-modifying CTEs can't be wrapped in json_agg, so read psql's "chat_id|first_name" lines
    const targets = sql(q('Open Nudge Sessions')).split('\n').filter(Boolean).map((l) => Number(l.split('|')[0])).sort();
    check('nudge skips youths with a record or a Care session; stale Numbers session replaced', JSON.stringify(targets) === JSON.stringify([444, CHAT].sort()), targets);
    check('nudge opens ask_sales sessions', one(`SELECT step FROM sessions WHERE chat_id = 444`).step === 'ask_sales');
    sql('DELETE FROM users WHERE chat_id IN (222, 333, 444)');
  },
};

(async () => {
  const only = process.argv.slice(2);
  for (const [name, fn] of Object.entries(tests)) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    console.log(name);
    await reset();
    try { await fn(); } catch (e) { failures++; console.log(`  ✗ crashed: ${e.stack}`); }
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
