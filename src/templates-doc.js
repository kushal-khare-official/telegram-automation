// Renders the fixed reply templates as Markdown for prompts.md.
const { TEMPLATES, HELP_BUTTONS } = require('./lib/templates');
const { ASK, nudgeText } = require('./lib/numbers');

const LABELS = {
  help_menu: '/help menu', help_ask: '"Ask a business question" button', help_how: '"How Omulimu works" button',
  today_none: '"Today\'s record" with no record yet', care_open: 'Care template 1 (opens the Care session)',
  care_checkin: 'Care template 2 (gentle check-in while the session is open)', coach_safe: 'Coach loan-guard replacement',
  fallback: 'Error fallback', text_only: 'Non-text / edited message', undo_done: '/undo, record removed', undo_none: '/undo, nothing to remove',
};
const LANG = { en: 'English', lg: 'Luganda', mixed: 'Mixed' };

module.exports = function templatesDoc() {
  const out = [];
  for (const [key, set] of Object.entries(TEMPLATES)) {
    out.push(`#### ${LABELS[key] || key}\n`);
    for (const [lang, text] of Object.entries(set)) {
      out.push(`*${Object.keys(set).length > 1 ? LANG[lang] : 'All languages'}*\n`);
      out.push('```text\n' + text + '\n```\n');
    }
  }
  out.push('#### Numbers brain (fixed, English, word for word)\n');
  out.push('```text\n' + [nudgeText('{first_name}'), ASK.ask_sales, ASK.ask_expenses,
    'Today: sales UGX 120,000, expenses UGX 45,000, profit UGX 75,000.', "Today, 7 Oct: sales UGX 120,000 · expenses UGX 45,000 · profit UGX 75,000"].join('\n') + '\n```\n');
  out.push('#### Help buttons (2 columns)\n');
  out.push(HELP_BUTTONS.map((b) => `- \`${b.data}\`: ${b.text}`).join('\n') + '\n');
  return out.join('\n');
};
