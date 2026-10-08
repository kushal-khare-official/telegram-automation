// 07 Error Alert: catches anything not handled elsewhere and alerts the admin chat.
// Every other workflow points at this one in Settings → Error workflow.

const { workflow, code, callWorkflow } = require('./helpers');

module.exports = workflow('errorAlert', 'Omulimu 07 · Error Alert', ({ add, link }) => {
  add({ name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 300], parameters: {} });

  add(code('Format Alert', [220, 300], `
const e = $input.first().json;
const ex = e.execution || {};
const lines = [
  '🚨 Omulimu unhandled error',
  'Workflow: ' + ((e.workflow && e.workflow.name) || 'unknown'),
  'Node: ' + (ex.lastNodeExecuted || (e.trigger && e.trigger.node && e.trigger.node.name) || 'unknown'),
  'Error: ' + String((ex.error && ex.error.message) || (e.trigger && e.trigger.error && e.trigger.error.message) || 'unknown').slice(0, 600),
  'Execution: ' + (ex.url || ex.id || 'n/a'),
];
return [{ json: { audience: 'admin', chat_id: $env.ADMIN_CHAT_ID, text: lines.join('\\n'), kind: 'normal' } }];
`));

  add(callWorkflow('Send Admin Alert', [440, 300], 'sendReply', { onError: 'continueErrorOutput' }));

  // Last resort, admin only: Send Reply needs Postgres, so if the database is down the alert goes
  // straight to Telegram. This is the one Telegram call outside Send Reply, and it never reaches a youth.
  add({
    name: 'Direct Admin Alert (DB down)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, 420],
    parameters: {
      method: 'POST',
      url: "={{ ($env.TELEGRAM_API_BASE || 'https://api.telegram.org') + '/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ chat_id: $env.ADMIN_CHAT_ID, text: $('Format Alert').first().json.text + '\\n(Send Reply failed too: database may be down)' }) }}",
      options: { timeout: 10000 },
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
  });

  link('Error Trigger', 'Format Alert');
  link('Format Alert', 'Send Admin Alert');
  link('Send Admin Alert', 'Direct Admin Alert (DB down)', 1);
});
