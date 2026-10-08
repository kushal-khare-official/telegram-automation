// 06 Send Reply: the only workflow that talks to Telegram.
// In:  {chat_id, text, buttons?, inbound_message_id?, kind?, callback_query_id?, audience?}
// Out: {ok, telegram_message_id, attempts, skipped?}

const { workflow, code, pg, ifNode, subTrigger } = require('./helpers');

const TELEGRAM_BASE = "($env.TELEGRAM_API_BASE || 'https://api.telegram.org') + '/bot' + $env.TELEGRAM_BOT_TOKEN";

module.exports = workflow('sendReply', 'Omulimu 06 · Send Reply', ({ add, link }) => {
  add(subTrigger([0, 300]));

  add(code('Prepare Reply', [220, 300], `
const i = $input.first().json;
const admin = i.audience === 'admin';
const chatId = admin ? ($env.ADMIN_CHAT_ID || i.chat_id) : i.chat_id;
// Youth replies are capped at 60 words; admin alerts are not youth replies.
const r = admin
  ? { text: String(i.text || '').slice(0, 3500), trimmed: false, original_words: wordCount(i.text) }
  : trimToWords(i.text);
const replyMarkup = buildKeyboard(i.buttons);
const sendBody = { chat_id: String(chatId), text: r.text || '…' };
if (replyMarkup) sendBody.reply_markup = replyMarkup;
return [{ json: {
  chat_id: String(chatId),
  text: sendBody.text,
  trimmed: r.trimmed,
  original_words: r.original_words,
  send_body: sendBody,
  inbound_message_id: i.inbound_message_id ?? null,
  kind: i.kind || 'normal',
  callback_query_id: i.callback_query_id || null,
  log: !admin,
} }];
`, ['reply']));

  // Claim the out row BEFORE sending. UNIQUE(reply_to_id) means a second call for the same inbound
  // message gets no row back and sends nothing, even when two calls race.
  add(pg('Claim Out Row', [440, 300], `
WITH p AS (SELECT $1::jsonb AS j),
trim_log AS (
  INSERT INTO error_log (workflow, node, inbound_message_id, error)
  SELECT 'Send Reply', 'Prepare Reply', (j->>'inbound_message_id')::bigint,
         'Reply over 60 words (' || (j->>'original_words') || '), cut at the last full sentence'
  FROM p WHERE (j->>'trimmed')::boolean AND (j->>'log')::boolean
  RETURNING id
),
ins AS (
  INSERT INTO messages (chat_id, direction, text, reply_to_id, kind, status)
  SELECT (j->>'chat_id')::bigint, 'out', j->>'text', (j->>'inbound_message_id')::bigint, j->>'kind', 'sending'
  FROM p WHERE (j->>'log')::boolean
  ON CONFLICT (reply_to_id) DO NOTHING
  RETURNING id
)
SELECT (SELECT id FROM ins) AS out_id, (SELECT (j->>'log')::boolean FROM p) AS logged
`, '$json'));

  add(ifNode('Should Send?', [660, 300], '!$json.logged || !!$json.out_id'));

  add(code('Already Replied', [880, 480], `
return [{ json: { ok: true, skipped: true, telegram_message_id: null, attempts: 0 } }];
`));

  add({
    name: 'Send Message', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [880, 280],
    parameters: {
      method: 'POST',
      url: `={{ ${TELEGRAM_BASE} + '/sendMessage' }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify($('Prepare Reply').first().json.send_body) }}",
      options: { timeout: 10000, response: { response: { fullResponse: true, neverError: true } } },
    },
    onError: 'continueErrorOutput',
  });

  // Runs once per attempt, so $runIndex + 1 is the attempt number.
  add(code('Check Response', [1100, 300], `
const r = $input.first().json;
const attempts = $runIndex + 1;
const status = Number(r.statusCode || 0);
const body = (r.body && typeof r.body === 'object') ? r.body : {};
const ok = status === 200 && body.ok === true;
const retryAfter = Number((body.parameters && body.parameters.retry_after) || 1);
return [{ json: {
  ok,
  status,
  attempts,
  retry: status === 429 && attempts < 3,
  retry_after: Math.min(Math.max(retryAfter, 1), 60),
  telegram_message_id: ok ? body.result.message_id : null,
  error: ok ? null : (body.description || (r.error && (r.error.message || r.error)) || r.message || ('HTTP ' + status)),
} }];
`));

  add(ifNode('Got 429?', [1320, 300], '$json.retry'));

  add({
    name: 'Wait retry_after', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [1320, 80],
    parameters: { resume: 'timeInterval', amount: '={{ $json.retry_after }}', unit: 'seconds' },
    webhookId: 'f3d1c0de-5e2d-4c1a-9b7e-0a1b2c3d4e5f',
  });

  add(pg('Record Result', [1540, 320], `
WITH p AS (SELECT $1::jsonb AS j),
upd AS (
  UPDATE messages m
  SET status = CASE WHEN (j->>'ok')::boolean THEN 'sent' ELSE 'failed' END,
      telegram_message_id = (j->>'telegram_message_id')::bigint,
      attempts = (j->>'attempts')::int
  FROM p
  WHERE m.id = (j->>'out_id')::bigint
  RETURNING m.id
),
err AS (
  INSERT INTO error_log (workflow, node, inbound_message_id, error)
  SELECT 'Send Reply', 'Send Message', (j->>'inbound_message_id')::bigint,
         'Telegram send failed after ' || (j->>'attempts') || ' attempt(s): ' || COALESCE(j->>'error', 'unknown')
  FROM p WHERE NOT (j->>'ok')::boolean
  RETURNING id
)
SELECT (j->>'ok')::boolean AS ok, (j->>'telegram_message_id')::bigint AS telegram_message_id,
       (j->>'attempts')::int AS attempts, (SELECT count(*) FROM upd)::int AS updated
FROM p
`, "Object.assign({}, $json, { out_id: $('Claim Out Row').first().json.out_id, inbound_message_id: $('Prepare Reply').first().json.inbound_message_id })"));

  add(ifNode('Button Tap?', [1760, 320], "!!$('Prepare Reply').first().json.callback_query_id"));

  add({
    name: 'Answer Button Tap', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1980, 220],
    parameters: {
      method: 'POST',
      url: `={{ ${TELEGRAM_BASE} + '/answerCallbackQuery' }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ callback_query_id: $('Prepare Reply').first().json.callback_query_id }) }}",
      options: { timeout: 10000, response: { response: { neverError: true } } },
    },
    onError: 'continueRegularOutput',
  });

  add(code('Done', [2200, 320], `
const r = $('Record Result').first().json;
return [{ json: { ok: !!r.ok, telegram_message_id: r.telegram_message_id ? Number(r.telegram_message_id) : null, attempts: Number(r.attempts) } }];
`));

  link('When Called', 'Prepare Reply');
  link('Prepare Reply', 'Claim Out Row');
  link('Claim Out Row', 'Should Send?');
  link('Should Send?', 'Send Message', 0);
  link('Should Send?', 'Already Replied', 1);
  link('Send Message', 'Check Response', 0);
  link('Send Message', 'Check Response', 1);
  link('Check Response', 'Got 429?');
  link('Got 429?', 'Wait retry_after', 0);
  link('Wait retry_after', 'Send Message');
  link('Got 429?', 'Record Result', 1);
  link('Record Result', 'Button Tap?');
  link('Button Tap?', 'Answer Button Tap', 0);
  link('Button Tap?', 'Done', 1);
  link('Answer Button Tap', 'Done');
});
