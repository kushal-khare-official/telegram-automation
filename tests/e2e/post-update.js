#!/usr/bin/env node
// Posts a fake Telegram update straight to the router's webhook, the way Telegram would.
// Works against the live bot (to test duplicates, T6/T11) and against a local n8n.
//
//   N8N_URL=https://n8n.example.com CHAT_ID=123456789 node tests/e2e/post-update.js --text "Today I sold 80k"
//   ... --text "hi" --update-id 777 --times 2          (T6: same update twice, one after the other)
//   ... --text "hi" --update-id 778 --parallel 2       (T11: same update twice at the same moment)
//   ... --sticker                                      (T8)
//   ... --callback record --text "Record today's numbers"   (button tap)
//
// The Telegram Trigger checks the X-Telegram-Bot-Api-Secret-Token header. n8n derives it from the
// workflow id and node id, which are fixed in workflows/01_router.json, so this script can compute it.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const router = JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows/01_router.json'), 'utf8'));
const trigger = router.nodes.find((n) => n.type === 'n8n-nodes-base.telegramTrigger');
const secret = `${router.id}_${trigger.id}`.replace(/[^a-zA-Z0-9_-]+/g, '');
const base = (process.env.N8N_URL || 'http://127.0.0.1:5678').replace(/\/+$/, '');
const url = `${base}/webhook/${trigger.webhookId}/webhook`;

const chatId = Number(opt('chat', process.env.CHAT_ID || '123456789'));
const updateId = Number(opt('update-id', String(Date.now() % 1e9 + Math.floor(Math.random() * 1000))));
const text = opt('text', 'hi');
const from = { id: chatId, is_bot: false, first_name: process.env.FIRST_NAME || 'Tester' };
const chat = { id: chatId, type: 'private', first_name: from.first_name };
const date = Math.floor(Date.now() / 1000);

let update;
if (flag('sticker')) {
  update = { update_id: updateId, message: { message_id: updateId, from, chat, date, sticker: { file_id: 'x', emoji: '👍' } } };
} else if (flag('photo')) {
  update = { update_id: updateId, message: { message_id: updateId, from, chat, date, photo: [{ file_id: 'x', width: 1, height: 1 }] } };
} else if (flag('edited')) {
  update = { update_id: updateId, edited_message: { message_id: updateId, from, chat, date, edit_date: date, text } };
} else if (opt('callback')) {
  const data = opt('callback');
  update = {
    update_id: updateId,
    callback_query: {
      id: String(updateId), from, data, chat_instance: '1',
      message: { message_id: 1, from: { id: 1, is_bot: true, first_name: 'Omulimu' }, chat, date, text: 'menu',
        reply_markup: { inline_keyboard: [[{ text, callback_data: data }]] } },
    },
  };
} else {
  update = { update_id: updateId, message: { message_id: updateId, from, chat, date, text } };
}

async function post() {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  });
  return `${res.status} ${await res.text()}`;
}

(async () => {
  const parallel = Number(opt('parallel', '1'));
  const times = Number(opt('times', '1'));
  for (let t = 0; t < times; t++) {
    const results = await Promise.all(Array.from({ length: parallel }, post));
    results.forEach((r) => console.log(`update_id=${updateId} → ${r}`));
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
