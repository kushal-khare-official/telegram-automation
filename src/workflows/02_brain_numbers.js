// 02 Numbers brain: deterministic. Also owns the 19:00 EAT nudge.
// In:  {chat_id, text, classification, session, profile, action}
// Out: {reply_text, buttons, session_update}

const { workflow, code, pg, switchNode, subTrigger, callWorkflow } = require('./helpers');

const KAMPALA_TODAY = "(now() AT TIME ZONE 'Africa/Kampala')::date";

module.exports = workflow('numbers', 'Omulimu 02 · Numbers Brain', ({ add, link }) => {
  add(subTrigger([0, 300]));

  add(code('Plan Numbers Step', [220, 300], `
const i = $input.first().json;
if (i.action === 'undo') {
  return [{ json: { plan: 'undo', chat_id: i.chat_id, language: (i.profile && i.profile.language) || 'en' } }];
}
const r = numbersStep({ action: i.action, session: i.session, entities: (i.classification || {}).entities });
return [{ json: {
  plan: r.record ? 'record' : 'ask',
  chat_id: i.chat_id,
  record: r.record,
  reply_text: r.reply_text,
  buttons: [],
  session_update: r.session_update,
} }];
`, ['ugx', 'numbers']));

  add(switchNode('Plan?', [440, 300], '$json.plan', ['record', 'ask', 'undo']));

  // Upsert on (chat_id, record_date) with the Kampala date: a second record the same day replaces the first.
  add(pg('Upsert Daily Record', [660, 120], `
WITH p AS (SELECT $1::jsonb AS j)
INSERT INTO daily_records (chat_id, record_date, sales_ugx, expenses_ugx, profit_ugx)
SELECT (j->>'chat_id')::bigint, ${KAMPALA_TODAY}, (j#>>'{record,sales_ugx}')::bigint,
       (j#>>'{record,expenses_ugx}')::bigint, (j#>>'{record,profit_ugx}')::bigint
FROM p
ON CONFLICT (chat_id, record_date) DO UPDATE
  SET sales_ugx = EXCLUDED.sales_ugx, expenses_ugx = EXCLUDED.expenses_ugx,
      profit_ugx = EXCLUDED.profit_ugx, updated_at = now()
RETURNING id, record_date
`, '$json'));

  add(code('Record Saved', [880, 120], `
const p = $('Plan Numbers Step').first().json;
return [{ json: { reply_text: p.reply_text, buttons: [], session_update: p.session_update } }];
`));

  add(code('Ask For Missing', [660, 300], `
const p = $input.first().json;
return [{ json: { reply_text: p.reply_text, buttons: [], session_update: p.session_update } }];
`));

  add(pg('Delete Today Record', [660, 480], `
WITH p AS (SELECT $1::jsonb AS j),
d AS (
  DELETE FROM daily_records r USING p
  WHERE r.chat_id = (j->>'chat_id')::bigint AND r.record_date = ${KAMPALA_TODAY}
  RETURNING r.id
)
SELECT (SELECT count(*) FROM d)::int AS removed
`, '$json'));

  add(code('Undo Reply', [880, 480], `
const p = $('Plan Numbers Step').first().json;
const removed = Number($input.first().json.removed) > 0;
return [{ json: { reply_text: t(removed ? 'undo_done' : 'undo_none', p.language), buttons: [], session_update: { op: 'delete' } } }];
`, ['templates']));

  // ---- 19:00 EAT daily nudge (workflow timezone is Africa/Kampala) ----
  add({
    name: 'Every Day 19:00 EAT', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 760],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 19 * * *' }] } },
  });

  // A Numbers session left open from before is deleted unsaved; the nudge opens a fresh one.
  add(pg('Close Stale Numbers Sessions', [220, 760], `
WITH d AS (DELETE FROM sessions WHERE active_brain = 'numbers' RETURNING chat_id)
SELECT count(*)::int AS closed FROM d
`));

  // Youths with no record for today (Kampala) and no open session (a Care session skips the nudge).
  add(pg('Open Nudge Sessions', [440, 760], `
WITH targets AS (
  SELECT u.chat_id, u.first_name FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM daily_records r WHERE r.chat_id = u.chat_id AND r.record_date = ${KAMPALA_TODAY})
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.chat_id = u.chat_id)
),
opened AS (
  INSERT INTO sessions (chat_id, active_brain, step, context)
  SELECT chat_id, 'numbers', 'ask_sales', '{}'::jsonb FROM targets
  ON CONFLICT (chat_id) DO NOTHING
  RETURNING chat_id
)
SELECT t.chat_id, t.first_name FROM targets t JOIN opened o USING (chat_id)
`));

  add(code('Build Nudges', [660, 760], `
return $input.all()
  .filter((it) => it.json && it.json.chat_id)
  .map((it) => ({ json: { chat_id: it.json.chat_id, text: nudgeText(it.json.first_name), kind: 'nudge', inbound_message_id: null } }));
`, ['ugx', 'numbers']));

  add(callWorkflow('Send Nudge', [880, 760], 'sendReply', { onError: 'continueRegularOutput' }));

  link('When Called', 'Plan Numbers Step');
  link('Plan Numbers Step', 'Plan?');
  link('Plan?', 'Upsert Daily Record', 0);
  link('Upsert Daily Record', 'Record Saved');
  link('Plan?', 'Ask For Missing', 1);
  link('Plan?', 'Delete Today Record', 2);
  link('Delete Today Record', 'Undo Reply');
  link('Every Day 19:00 EAT', 'Close Stale Numbers Sessions');
  link('Close Stale Numbers Sessions', 'Open Nudge Sessions');
  link('Open Nudge Sessions', 'Build Nudges');
  link('Build Nudges', 'Send Nudge');
});
