// 04 Care brain: fixed templates, no LLM. Opens a Care session and flags the chat for a human.
// In:  {chat_id, text, profile, action: 'open' | 'checkin'}
// Out: {reply_text, buttons, session_update, admin_alert?}

const { workflow, code, pg, subTrigger } = require('./helpers');

module.exports = workflow('care', 'Omulimu 04 · Care Brain', ({ add, link }) => {
  add(subTrigger([0, 300]));

  add(code('Care Reply', [220, 300], `
const i = $input.first().json;
const profile = i.profile || {};
const lang = profile.language || 'en';
const vars = { first_name: profile.first_name, support_line: $env.SUPPORT_LINE || 'a trusted person near you' };
if (i.action === 'checkin') {
  return [{ json: { chat_id: i.chat_id, flag_human: false, reply_text: t('care_checkin', lang, vars), buttons: [], session_update: { op: 'none' }, admin_alert: null } }];
}
const alert = '⚠️ Omulimu Care flag\\nChat: ' + i.chat_id + ' (' + (profile.first_name || 'unknown') + ')\\nMessage: ' + String(i.text || '').slice(0, 800) + '\\nPlease check in with this youth.';
return [{ json: {
  chat_id: i.chat_id,
  flag_human: true,
  reply_text: t('care_open', lang, vars),
  buttons: [],
  session_update: { op: 'upsert', active_brain: 'care', step: 'open', context: {} },
  admin_alert: alert,
} }];
`, ['templates']));

  add(pg('Flag For Human', [440, 300], `
WITH p AS (SELECT $1::jsonb AS j)
UPDATE users u SET needs_human = true FROM p
WHERE u.chat_id = (j->>'chat_id')::bigint AND (j->>'flag_human')::boolean
RETURNING u.chat_id
`, '$json', { alwaysOutputData: true }));

  add(code('Care Output', [660, 300], `
const c = $('Care Reply').first().json;
return [{ json: { reply_text: c.reply_text, buttons: c.buttons, session_update: c.session_update, admin_alert: c.admin_alert } }];
`));

  link('When Called', 'Care Reply');
  link('Care Reply', 'Flag For Human');
  link('Flag For Human', 'Care Output');
});
