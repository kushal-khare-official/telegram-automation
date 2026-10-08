// 01 Router: Telegram Trigger → save (idempotent) → classify → decide → brain → Send Reply.

const { workflow, code, pg, llmHttp, ifNode, switchNode, callWorkflow, uuid, DB_RETRY } = require('./helpers');

module.exports = workflow('router', 'Omulimu 01 · Router', ({ add, link }) => {
  add({
    name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.2, position: [0, 300],
    parameters: { updates: ['message', 'edited_message', 'callback_query'], additionalFields: {} },
    credentials: require('./helpers').CRED.telegram,
    webhookId: uuid('omulimu-telegram-webhook'),
  });

  add(code('Normalize Update', [220, 300], `
const u = $input.first().json;
const cq = u.callback_query || null;
const msg = u.message || u.edited_message || (cq && cq.message) || null;
const chat = msg && msg.chat;
if (!chat || chat.id === undefined) return []; // nothing we can answer

let text = null;
let isText = false;
let callbackData = null;
if (cq) {
  callbackData = cq.data || null;
  const rows = (cq.message && cq.message.reply_markup && cq.message.reply_markup.inline_keyboard) || [];
  const tapped = rows.flat().find((b) => b.callback_data === cq.data);
  text = tapped ? tapped.text : String(cq.data || '');
  isText = true; // a button tap is routed like any other message
} else if (u.message && typeof u.message.text === 'string') {
  text = u.message.text;
  isText = true;
} else if (u.edited_message) {
  text = '[edited] ' + (u.edited_message.text || u.edited_message.caption || '');
} else {
  const kinds = ['sticker', 'photo', 'voice', 'video', 'video_note', 'audio', 'document', 'animation', 'location', 'contact'];
  const kind = kinds.find((k) => msg[k] !== undefined) || 'non-text';
  text = '[' + kind + ']' + (msg.caption ? ' ' + msg.caption : '');
}

const from = (cq && cq.from) || (msg && msg.from) || {};
return [{ json: {
  update_id: u.update_id,
  chat_id: chat.id,
  first_name: from.first_name || chat.first_name || null,
  text,
  is_text: isText,
  is_edited: !!u.edited_message,
  callback_data: callbackData,
  callback_query_id: cq ? cq.id : null,
} }];
`));

  add(pg('Upsert User', [440, 300], `
WITH p AS (SELECT $1::jsonb AS j)
INSERT INTO users (chat_id, first_name)
SELECT (j->>'chat_id')::bigint, j->>'first_name' FROM p
ON CONFLICT (chat_id) DO UPDATE SET first_name = COALESCE(EXCLUDED.first_name, users.first_name)
RETURNING chat_id
`, "$('Normalize Update').first().json", DB_RETRY));

  // R3: the database decides what is a duplicate. No row back = Telegram retry → stop here.
  add(pg('Save Inbound', [660, 300], `
WITH p AS (SELECT $1::jsonb AS j),
ins AS (
  INSERT INTO messages (chat_id, direction, text, telegram_update_id, kind, status)
  SELECT (j->>'chat_id')::bigint, 'in', j->>'text', (j->>'update_id')::bigint, 'normal', 'received' FROM p
  ON CONFLICT (telegram_update_id) DO NOTHING
  RETURNING id
)
SELECT (SELECT id FROM ins) AS id
`, "$('Normalize Update').first().json", DB_RETRY));

  add(ifNode('Is New?', [880, 300], '!!$json.id'));

  add({
    name: 'Duplicate: Stop', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1100, 480], parameters: {},
  });

  add(ifNode('Is Text?', [1100, 300], "$('Normalize Update').first().json.is_text && !$('Normalize Update').first().json.is_edited"));

  // Non-text or edited: save as ignored, polite reply, no crash.
  add(pg('Mark Ignored', [1320, 520], `
WITH p AS (SELECT $1::jsonb AS j)
UPDATE messages SET status = 'ignored' FROM p WHERE id = (j->>'id')::bigint RETURNING id
`, "$('Save Inbound').first().json"));

  add(code('Build Text-Only Reply', [1540, 520], `
const n = $('Normalize Update').first().json;
return [{ json: {
  chat_id: n.chat_id,
  text: t('text_only', 'en'),
  inbound_message_id: $('Save Inbound').first().json.id,
  kind: 'text_only',
} }];
`, ['templates']));

  add(callWorkflow('Send Text-Only Reply', [1760, 520], 'sendReply'));

  add(pg('Load Context', [1320, 300], `
WITH p AS (SELECT ($1::jsonb->>'chat_id')::bigint AS chat_id)
SELECT
  (SELECT to_jsonb(u) FROM users u, p WHERE u.chat_id = p.chat_id) AS profile,
  (SELECT to_jsonb(s) FROM sessions s, p WHERE s.chat_id = p.chat_id) AS session,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('direction', h.direction, 'text', h.text) ORDER BY h.created_at, h.id)
    FROM (
      SELECT m.id, m.direction, m.text, m.created_at FROM messages m, p
      WHERE m.chat_id = p.chat_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 15
    ) h
  ), '[]'::jsonb) AS history
`, "$('Normalize Update').first().json"));

  add(code('Build Classifier Request', [1540, 300], `
const n = $('Normalize Update').first().json;
const ctx = $input.first().json;
// Test switch for R5/T7: env FORCE_LLM_FAIL=true or a message starting with /fail_llm.
const forceFail = String($env.FORCE_LLM_FAIL || '').toLowerCase() === 'true' || /^\\/fail_llm\\b/i.test(n.text || '');
const base = String($env.LLM_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\\/+$/, '');
const model = $env.LLM_MODEL || 'openai/gpt-4o-mini';
const messages = [
  { role: 'system', content: CLASSIFIER_SYSTEM },
  { role: 'user', content: buildClassifierUserContent({ text: n.text, history: ctx.history, profile: ctx.profile || {}, session: ctx.session }) },
];
return [{ json: {
  llm_url: forceFail ? base + '/__force_fail' : base + '/chat/completions',
  llm_request: { model, temperature: 0, max_tokens: 300, response_format: { type: 'json_object' }, messages },
  model,
  started_at: Date.now(),
} }];
`, ['classifier', 'prompts']));

  add(llmHttp('LLM Classify', [1760, 300], 'temperature 0 · 3 tries · 20 s timeout · error output → error branch'));

  add(code('Validate Classification', [1980, 200], `
const res = $input.first().json;
const req = $('Build Classifier Request').first().json;
const raw = completionText(res);
const v = validateClassification(raw);
return [{ json: {
  valid: v.ok,
  errors: v.errors,
  classification: v.value,
  status: 'ok',
  raw_output: raw || JSON.stringify(res).slice(0, 4000),
  model: res.model || req.model,
  latency_ms: Date.now() - req.started_at,
} }];
`, ['ugx', 'classifier']));

  add(ifNode('Valid?', [2200, 200], '$json.valid'));

  add(code('Build Repair Request', [2420, 380], `
const req = $('Build Classifier Request').first().json;
const v = $input.first().json;
const messages = req.llm_request.messages.concat([
  { role: 'assistant', content: String(v.raw_output).slice(0, 2000) },
  { role: 'user', content: repairInstruction(v.errors) },
]);
return [{ json: {
  llm_url: req.llm_url,
  llm_request: Object.assign({}, req.llm_request, { messages }),
  first_raw: v.raw_output,
  first_errors: v.errors,
} }];
`, ['prompts']));

  add(llmHttp('LLM Repair', [2640, 380], 'one repair retry · same retry/timeout settings'));

  add(code('Validate Repair', [2860, 300], `
const res = $input.first().json;
const req = $('Build Classifier Request').first().json;
const first = $('Build Repair Request').first().json;
const ctx = $('Load Context').first().json;
const raw = completionText(res);
const v = validateClassification(raw);
// Still invalid after one repair: fall back to the Coach brain and log status = 'fallback'.
const fallback = {
  route: 'business_question',
  reason: 'Classifier output failed validation twice; fallback to Coach.',
  confidence: 0,
  language: (ctx.profile && ctx.profile.language) || 'en',
  entities: { sales_ugx: null, expenses_ugx: null, amount_ugx: null },
};
return [{ json: {
  valid: true,
  classification: v.ok ? v.value : fallback,
  status: v.ok ? 'repaired' : 'fallback',
  raw_output: JSON.stringify({ first: first.first_raw, first_errors: first.first_errors, repair: raw, repair_errors: v.errors }),
  model: res.model || req.model,
  latency_ms: Date.now() - req.started_at,
} }];
`, ['ugx', 'classifier']));

  add(pg('Save Routing', [3080, 200], `
WITH p AS (SELECT $1::jsonb AS j),
rh AS (
  INSERT INTO routing_history (inbound_message_id, route, reason, confidence, language, entities, status, model, latency_ms, raw_output)
  SELECT (j->>'inbound_message_id')::bigint, j#>>'{c,route}', j#>>'{c,reason}', (j#>>'{c,confidence}')::numeric,
         j#>>'{c,language}', COALESCE(j#>'{c,entities}', '{}'::jsonb), j->>'status', j->>'model', (j->>'latency_ms')::int, j->>'raw_output'
  FROM p
  ON CONFLICT (inbound_message_id) DO NOTHING
  RETURNING id
),
lang AS (
  UPDATE users u SET language = j#>>'{c,language}' FROM p
  WHERE u.chat_id = (j->>'chat_id')::bigint AND j->>'status' <> 'fallback' AND NOT (j->>'keep_language')::boolean
  RETURNING u.chat_id
),
fb AS (
  UPDATE messages m SET status = 'fallback' FROM p
  WHERE m.id = (j->>'inbound_message_id')::bigint AND j->>'status' = 'fallback'
  RETURNING m.id
)
SELECT j->'c' AS classification, j->>'status' AS status, (SELECT id FROM rh) AS routing_id FROM p
`, "{ c: $json.classification, status: $json.status, model: $json.model, latency_ms: $json.latency_ms, raw_output: $json.raw_output, inbound_message_id: $('Save Inbound').first().json.id, chat_id: $('Normalize Update').first().json.chat_id, keep_language: /^\\//.test($('Normalize Update').first().json.text || '') || !!$('Normalize Update').first().json.callback_data }"));

  add(code('Decide Route', [3300, 200], `
const n = $('Normalize Update').first().json;
const ctx = $('Load Context').first().json;
const r = $input.first().json;
const c = r.classification;
const d = decideRoute({ route: c.route, session: ctx.session, text: n.text, callback_data: n.callback_data });
// "/help" or a button tap says little about language: keep the youth's last detected language.
const keepLanguage = r.status === 'fallback' || /^\\//.test(n.text || '') || !!n.callback_data;
const profile = Object.assign({}, ctx.profile || {}, keepLanguage ? {} : { language: c.language });
return [{ json: {
  brain: d.brain,
  action: d.action,
  close_session: d.close_session,
  chat_id: n.chat_id,
  text: clip(n.text, MAX_LLM_TEXT),
  classification: c,
  classification_status: r.status,
  session: d.session_for_brain,
  profile,
  inbound_message_id: $('Save Inbound').first().json.id,
  callback_query_id: n.callback_query_id,
} }];
`, ['classifier', 'route']));

  add(switchNode('Which Brain?', [3520, 200], '$json.brain', ['numbers', 'coach', 'care', 'help']));
  add(callWorkflow('Numbers Brain', [3740, 0], 'numbers'));
  add(callWorkflow('Coach Brain', [3740, 160], 'coach'));
  add(callWorkflow('Care Brain', [3740, 320], 'care'));
  add(callWorkflow('Help Brain', [3740, 480], 'help'));

  add(code('Brain Result', [3960, 240], `
const out = $input.first().json;
const d = $('Decide Route').first().json;
const su = out.session_update || { op: 'none' };
// The brain's own session change wins; otherwise close the session the router decided to end.
const op = (su.op === 'upsert' || su.op === 'delete') ? su.op : (d.close_session ? 'delete' : 'none');
return [{ json: {
  error: !!out.error,
  error_message: out.error_message || null,
  error_node: out.error_node || null,
  reply_text: out.reply_text,
  buttons: out.buttons || [],
  admin_alert: out.admin_alert || null,
  session: { op, active_brain: su.active_brain || null, step: su.step || null, context: su.context || {} },
} }];
`));

  add(ifNode('Brain Failed?', [4180, 240], '$json.error'));

  add(pg('Apply Session', [4400, 300], `
WITH p AS (SELECT $1::jsonb AS j),
del AS (
  DELETE FROM sessions s USING p
  WHERE s.chat_id = (j->>'chat_id')::bigint AND j->>'op' = 'delete'
  RETURNING s.chat_id
),
up AS (
  INSERT INTO sessions (chat_id, active_brain, step, context, opened_at)
  SELECT (j->>'chat_id')::bigint, j->>'active_brain', j->>'step', COALESCE(j->'context', '{}'::jsonb), now()
  FROM p WHERE j->>'op' = 'upsert'
  ON CONFLICT (chat_id) DO UPDATE
    SET active_brain = EXCLUDED.active_brain, step = EXCLUDED.step, context = EXCLUDED.context,
        opened_at = CASE WHEN sessions.active_brain = EXCLUDED.active_brain THEN sessions.opened_at ELSE now() END
  RETURNING chat_id
)
SELECT j->>'op' AS op FROM p
`, "Object.assign({ chat_id: $('Decide Route').first().json.chat_id }, $json.session)"));

  add(code('Build Reply', [4620, 300], `
const b = $('Brain Result').first().json;
const d = $('Decide Route').first().json;
return [{ json: {
  chat_id: d.chat_id,
  text: b.reply_text,
  buttons: b.buttons,
  inbound_message_id: d.inbound_message_id,
  kind: d.classification_status === 'fallback' ? 'fallback' : 'normal',
  callback_query_id: d.callback_query_id,
} }];
`));

  add(callWorkflow('Send Reply', [4840, 300], 'sendReply'));

  add(pg('Mark Processed', [5060, 300], `
WITH p AS (SELECT $1::jsonb AS j)
UPDATE messages m
SET status = CASE WHEN j->>'ok' = 'false' THEN 'failed' WHEN m.status = 'fallback' THEN 'fallback' ELSE 'processed' END
FROM p WHERE m.id = (j->>'id')::bigint
RETURNING m.id, m.status
`, "{ id: $('Decide Route').first().json.inbound_message_id, ok: $json.ok }"));

  add(ifNode('Alert Admin?', [5280, 300], "!!$('Brain Result').first().json.admin_alert"));

  add(code('Build Admin Alert', [5500, 220], `
const a = $('Brain Result').first().json.admin_alert;
return [{ json: { audience: 'admin', chat_id: $env.ADMIN_CHAT_ID, text: a, kind: 'normal' } }];
`));

  add(callWorkflow('Send Admin Alert', [5720, 220], 'sendReply', { onError: 'continueRegularOutput' }));

  // ---- error branch (R5): fallback reply → error_log → status failed ----
  add(code('Build Fallback', [4400, 620], `
const n = $('Normalize Update').first().json;
const e = $input.first().json;
let node = e.error_node;
if (!node) node = $('LLM Repair').isExecuted ? 'LLM Repair' : 'LLM Classify';
const err = e.error_message || (e.error && (e.error.message || e.error)) || e.message || JSON.stringify(e).slice(0, 500);
return [{ json: {
  chat_id: n.chat_id,
  text: t('fallback', 'en'),
  inbound_message_id: $('Save Inbound').first().json.id,
  kind: 'error',
  callback_query_id: n.callback_query_id,
  error_node: node,
  error_message: String(typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 1000),
} }];
`, ['templates']));

  add(callWorkflow('Send Fallback Reply', [4620, 620], 'sendReply', { onError: 'continueRegularOutput' }));

  add(pg('Log Error', [4840, 620], `
WITH p AS (SELECT $1::jsonb AS j)
INSERT INTO error_log (workflow, node, inbound_message_id, error)
SELECT 'Router', j->>'error_node', (j->>'inbound_message_id')::bigint, j->>'error_message' FROM p
RETURNING id
`, "$('Build Fallback').first().json"));

  add(pg('Mark Failed', [5060, 620], `
WITH p AS (SELECT $1::jsonb AS j)
UPDATE messages SET status = 'failed' FROM p WHERE id = (j->>'inbound_message_id')::bigint
RETURNING id, status
`, "$('Build Fallback').first().json"));

  // ---- connections ----
  link('Telegram Trigger', 'Normalize Update');
  link('Normalize Update', 'Upsert User');
  link('Upsert User', 'Save Inbound');
  link('Save Inbound', 'Is New?');
  link('Is New?', 'Is Text?', 0);
  link('Is New?', 'Duplicate: Stop', 1);
  link('Is Text?', 'Load Context', 0);
  link('Is Text?', 'Mark Ignored', 1);
  link('Mark Ignored', 'Build Text-Only Reply');
  link('Build Text-Only Reply', 'Send Text-Only Reply');
  link('Load Context', 'Build Classifier Request');
  link('Build Classifier Request', 'LLM Classify');
  link('LLM Classify', 'Validate Classification', 0);
  link('LLM Classify', 'Build Fallback', 1);
  link('Validate Classification', 'Valid?');
  link('Valid?', 'Save Routing', 0);
  link('Valid?', 'Build Repair Request', 1);
  link('Build Repair Request', 'LLM Repair');
  link('LLM Repair', 'Validate Repair', 0);
  link('LLM Repair', 'Build Fallback', 1);
  link('Validate Repair', 'Save Routing');
  link('Save Routing', 'Decide Route');
  link('Decide Route', 'Which Brain?');
  link('Which Brain?', 'Numbers Brain', 0);
  link('Which Brain?', 'Coach Brain', 1);
  link('Which Brain?', 'Care Brain', 2);
  link('Which Brain?', 'Help Brain', 3);
  for (const b of ['Numbers Brain', 'Coach Brain', 'Care Brain', 'Help Brain']) link(b, 'Brain Result');
  link('Brain Result', 'Brain Failed?');
  link('Brain Failed?', 'Build Fallback', 0);
  link('Brain Failed?', 'Apply Session', 1);
  link('Apply Session', 'Build Reply');
  link('Build Reply', 'Send Reply');
  link('Send Reply', 'Mark Processed');
  link('Mark Processed', 'Alert Admin?');
  link('Alert Admin?', 'Build Admin Alert', 0);
  link('Build Admin Alert', 'Send Admin Alert');
  link('Build Fallback', 'Send Fallback Reply');
  link('Send Fallback Reply', 'Log Error');
  link('Log Error', 'Mark Failed');
});
