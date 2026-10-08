// Reply helpers used by Send Reply and the Coach brain. Pure, no I/O.

const MAX_WORDS = 60;

function wordCount(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

// Cuts at the last full sentence within the word limit. Keeps line breaks.
// Returns {text, trimmed, original_words}.
function trimToWords(text, max = MAX_WORDS) {
  const s = String(text || '').trim();
  const words = [...s.matchAll(/\S+/g)];
  if (words.length <= max) return { text: s, trimmed: false, original_words: words.length };

  const last = words[max - 1];
  const head = s.slice(0, last.index + last[0].length);
  let cut = -1;
  for (const m of head.matchAll(/[.!?…](?=["'”’)\]]*(?:\s|$))["'”’)\]]*/g)) cut = m.index + m[0].length;
  const out = cut > 0 ? head.slice(0, cut) : head.replace(/[,;:\-–—\s]+$/, '') + '…';
  return { text: out.trim(), trimmed: true, original_words: words.length };
}

// buttons: [{text, data}] → Telegram inline keyboard with at most 2 per row.
function buildKeyboard(buttons, perRow = 2) {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const rows = [];
  buttons
    .filter((b) => b && b.text)
    .forEach((b, i) => {
      if (i % perRow === 0) rows.push([]);
      rows[rows.length - 1].push({ text: String(b.text).slice(0, 64), callback_data: String(b.data || b.text).slice(0, 64) });
    });
  return rows.length ? { inline_keyboard: rows } : null;
}

// Second line of defence behind the Coach prompt: no loans, no lenders.
const LOAN_PATTERN = new RegExp(
  [
    '\\bloans?\\b', '\\bborrow\\w*', '\\blend(?:er|ers|ing)?\\b', '\\blooni\\b', '\\bokw?ewol\\w*', '\\bkwewol\\w*', '\\bwewole\\b',
    '\\btala\\b', '\\bmokash\\b', '\\bfido\\b', '\\bzengo\\b', '\\bbranch (?:app|loan)', '\\bmo ?kash\\b', '\\bairtel (?:wewole|quick ?loan)',
    '\\bpayday\\b', '\\bmicro ?finance\\b', '\\bmicrolend\\w*', '\\bquick ?cash\\b', '\\bsacco loans?\\b', '\\bcredit (?:app|line|facility)\\b',
    '\\bebbanja\\b', '\\bbbanja\\b',
  ].join('|'),
  'i'
);

function mentionsLoan(text) {
  return LOAN_PATTERN.test(String(text || ''));
}

module.exports = { MAX_WORDS, wordCount, trimToWords, buildKeyboard, mentionsLoan };
