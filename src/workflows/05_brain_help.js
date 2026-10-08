// 05 Help brain: menu, today's record, how it works. No LLM.
// In:  {chat_id, profile, action: 'menu' | 'ask' | 'today' | 'how'}
// Out: {reply_text, buttons, session_update}

const { workflow, code, pg, subTrigger } = require('./helpers');

module.exports = workflow('help', 'Omulimu 05 · Help Brain', ({ add, link }) => {
  add(subTrigger([0, 300]));

  // Always returns one row, so the next node always runs.
  add(pg("Load Today's Record", [220, 300], `
WITH p AS (SELECT $1::jsonb AS j)
SELECT
  (SELECT jsonb_build_object('sales_ugx', r.sales_ugx, 'expenses_ugx', r.expenses_ugx, 'profit_ugx', r.profit_ugx)
     FROM daily_records r
     WHERE r.chat_id = (j->>'chat_id')::bigint AND r.record_date = (now() AT TIME ZONE 'Africa/Kampala')::date) AS record,
  to_char((now() AT TIME ZONE 'Africa/Kampala')::date, 'FMDD Mon') AS date_label
FROM p
`, '$json'));

  add(code('Help Reply', [440, 300], `
const i = $('When Called').first().json;
const row = $input.first().json;
const profile = i.profile || {};
const lang = profile.language || 'en';
const vars = { first_name: profile.first_name };
const record = row.record ? {
  sales_ugx: Number(row.record.sales_ugx), expenses_ugx: Number(row.record.expenses_ugx), profit_ugx: Number(row.record.profit_ugx),
} : null;

let reply_text;
let buttons = [];
switch (i.action) {
  case 'ask':
    reply_text = t('help_ask', lang, vars);
    break;
  case 'how':
    reply_text = t('help_how', lang, vars);
    break;
  case 'today':
    if (record) {
      reply_text = todayText(row.date_label, record);
    } else {
      reply_text = t('today_none', lang, vars);
      buttons = [HELP_BUTTONS[0]];
    }
    break;
  default:
    reply_text = t('help_menu', lang, vars);
    buttons = HELP_BUTTONS;
}
return [{ json: { reply_text, buttons, session_update: { op: 'none' } } }];
`, ['ugx', 'numbers', 'templates']));

  link('When Called', "Load Today's Record");
  link("Load Today's Record", 'Help Reply');
});
