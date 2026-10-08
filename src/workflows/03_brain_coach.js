// 03 Coach brain: one LLM answer, 60 words or fewer, no loans.
// In:  {chat_id, text, classification, session, profile, inbound_message_id}
// Out: {reply_text, buttons, session_update} or {error: true, error_node, error_message}

const { workflow, code, pg, llmHttp, subTrigger } = require('./helpers');

module.exports = workflow('coach', 'Omulimu 03 · Coach Brain', ({ add, link }) => {
  add(subTrigger([0, 300]));

  // Last 5 rows of the chat, in and out, excluding the message being answered.
  add(pg('Load Last 5 Messages', [220, 300], `
WITH p AS (SELECT $1::jsonb AS j)
SELECT COALESCE((
  SELECT jsonb_agg(jsonb_build_object('direction', h.direction, 'text', h.text) ORDER BY h.created_at, h.id)
  FROM (
    SELECT m.id, m.direction, m.text, m.created_at FROM messages m, p
    WHERE m.chat_id = (j->>'chat_id')::bigint AND m.id <> COALESCE((j->>'inbound_message_id')::bigint, -1)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 5
  ) h
), '[]'::jsonb) AS history
`, '$json'));

  add(code('Build Coach Request', [440, 300], `
const i = $('When Called').first().json;
const history = $input.first().json.history || [];
const profile = i.profile || {};
const language = (i.classification && i.classification.language) || profile.language || 'en';
const system = fill(COACH_SYSTEM, {
  first_name: profile.first_name || 'the youth',
  business_type: profile.business_type || 'small business',
  language,
});
const historyText = history.map((r) => (r.direction === 'out' ? '[coach] ' : '[youth] ') + clip(r.text, 300).replace(/\\s+/g, ' ')).join('\\n');
const user = [
  'Recent chat, oldest first:',
  historyText || '(none)',
  '',
  '<user_message>',
  clip(i.text, MAX_LLM_TEXT).replace(/<\\/?user_message>/gi, ''),
  '</user_message>',
].join('\\n');
const forceFail = String($env.FORCE_LLM_FAIL || '').toLowerCase() === 'true';
const base = String($env.LLM_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\\/+$/, '');
const model = $env.LLM_COACH_MODEL || $env.LLM_MODEL || 'openai/gpt-4o-mini';
return [{ json: {
  llm_url: forceFail ? base + '/__force_fail' : base + '/chat/completions',
  llm_request: { model, temperature: 0.4, max_tokens: 160, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
  language,
} }];
`, ['classifier', 'templates', 'prompts']));

  add(llmHttp('LLM Coach', [660, 300], '3 tries · 20 s timeout · error output → router error branch'));

  add(code('Check Coach Reply', [880, 200], `
const req = $('Build Coach Request').first().json;
let text = completionText($input.first().json).trim().replace(/[*_\`#]+/g, '');
// Second line of defence: if the model mentions a loan or lender anyway, use the safe template.
const guarded = !text || mentionsLoan(text);
if (guarded) text = t('coach_safe', req.language);
return [{ json: { reply_text: text, buttons: [], session_update: { op: 'none' }, loan_guard: guarded } }];
`, ['classifier', 'reply', 'templates']));

  add(code('Coach Failed', [880, 420], `
const e = $input.first().json;
const msg = (e.error && (e.error.message || e.error)) || e.message || 'LLM Coach failed';
return [{ json: { error: true, error_node: 'LLM Coach', error_message: String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 1000) } }];
`));

  link('When Called', 'Load Last 5 Messages');
  link('Load Last 5 Messages', 'Build Coach Request');
  link('Build Coach Request', 'LLM Coach');
  link('LLM Coach', 'Check Coach Reply', 0);
  link('LLM Coach', 'Coach Failed', 1);
});
