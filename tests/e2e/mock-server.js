#!/usr/bin/env node
// Local stand-in for the Telegram Bot API and an OpenAI-compatible LLM, so the real n8n workflows
// can be run end to end without a bot token or an API key. Test harness only.
//
//   Telegram: /bot<token>/<method>     (setWebhook, deleteWebhook, getMe, sendMessage, answerCallbackQuery)
//   LLM:      /v1/chat/completions     (rule-based fake classifier + fake coach)
//             /v1/__force_fail         (always 500, used by FORCE_LLM_FAIL and /fail_llm)
//   Control:  GET /__sent  GET /__llm  POST /__reset
//
// Magic words in a message: BADJSON (classifier returns invalid output once), BADJSON2 (invalid twice),
// RATELIMIT (the coach echoes it; the first sendMessage containing it gets HTTP 429), LONGREPLY (coach answers with ~90 words),
// LOANREPLY (coach suggests a loan app, to exercise the loan guard), COACHFAIL (coach LLM returns 500).

const http = require('http');

const PORT = Number(process.env.MOCK_PORT || 9000);
let sent = [];
let llmCalls = [];
let messageId = 1000;
const rateLimited = new Set();
const badJsonSeen = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function amountsIn(text) {
  const re = /(\d[\d,]*(?:\.\d+)?\s*(?:k|m)?)\b/gi;
  return [...text.matchAll(re)].map((m) => m[1].trim()).filter((s) => /\d/.test(s));
}

function fakeClassify(text, history) {
  const t = text.toLowerCase();
  const out = (route, entities = {}, language = 'en') => ({
    route, reason: `mock: ${route}`, confidence: 0.9, language,
    entities: { sales_ugx: null, expenses_ugx: null, amount_ugx: null, ...entities },
  });
  if (/afudde|ending it all|kill myself|can't go on|cannot go on|njagala okufa/.test(t)) {
    const a = amountsIn(t);
    return out('wellbeing', a.length ? { sales_ugx: a[0] } : {}, 'mixed');
  }
  if (/^\/(help|start)|today's record|how omulimu works|ask a business question|^\/undo/.test(t)) return out('menu_help');
  if (/record today's numbers/.test(t)) return out('daily_numbers');
  const a = amountsIn(t);
  if (a.length) {
    const e = {};
    const sold = t.match(/(?:sold|natunze|nnatunze|sales)\s*([\d,.]+\s*k?)/);
    const spent = t.match(/(?:expenses|spent)\s*([\d,.]+\s*k?)/);
    if (sold) e.sales_ugx = sold[1].trim(); // a string on purpose: the Code node must normalise it
    if (spent) e.expenses_ugx = spent[1].trim();
    if (!sold && !spent) e.amount_ugx = a[0];
    return out('daily_numbers', e, /natunze|leero/.test(t) ? 'mixed' : 'en');
  }
  return out('business_question', {}, /njagala|bizinensi/.test(t) ? 'mixed' : 'en');
}

function completion(content, model) {
  return { id: 'mock', object: 'chat.completion', model: model || 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] };
}

function handleLlm(req, res, body) {
  const isClassifier = !!(body.response_format && body.response_format.type === 'json_object');
  const userMsg = (body.messages || []).filter((m) => m.role === 'user').pop() || { content: '' };
  const firstUser = (body.messages || []).find((m) => m.role === 'user') || { content: '' };
  const text = ((firstUser.content.match(/<user_message>\n([\s\S]*?)\n<\/user_message>/) || [])[1] || '').trim();
  llmCalls.push({ kind: isClassifier ? 'classifier' : 'coach', text, repair: userMsg !== firstUser, at: Date.now() });

  if (isClassifier) {
    const isRepair = userMsg !== firstUser;
    if (/BADJSON2/.test(text) || (/BADJSON/.test(text) && !isRepair)) {
      badJsonSeen.set(text, (badJsonSeen.get(text) || 0) + 1);
      return json(res, 200, completion('Sure! The route is probably daily_numbers.', body.model));
    }
    return json(res, 200, completion(JSON.stringify(fakeClassify(text)), body.model));
  }
  if (/COACHFAIL/.test(text)) return json(res, 500, { error: { message: 'mock coach outage' } });
  if (/LONGREPLY/.test(text)) {
    return json(res, 200, completion('Start by counting every chapati you sell each day. Write the number in a small book. '.repeat(6), body.model));
  }
  if (/RATELIMIT/.test(text)) return json(res, 200, completion('Save part of each day\'s profit in a separate wallet. RATELIMIT', body.model));
  if (/LOANREPLY/.test(text)) return json(res, 200, completion('Take a quick loan on the Wewole app to buy more flour.', body.model));
  return json(res, 200, completion('Sell near the boda stage at lunch time and keep a daily notebook of sales. Which day sells best for you?', body.model));
}

function handleTelegram(method, res, body) {
  if (method === 'sendMessage') {
    if (/RATELIMIT/.test(body.text || '') && !rateLimited.has(body.text)) {
      rateLimited.add(body.text);
      return json(res, 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } });
    }
    const message_id = ++messageId;
    sent.push({ method, chat_id: String(body.chat_id), text: body.text, reply_markup: body.reply_markup || null, message_id, at: Date.now() });
    return json(res, 200, { ok: true, result: { message_id, chat: { id: body.chat_id }, text: body.text } });
  }
  if (method === 'answerCallbackQuery') {
    sent.push({ method, callback_query_id: body.callback_query_id, at: Date.now() });
    return json(res, 200, { ok: true, result: true });
  }
  if (method === 'getMe') return json(res, 200, { ok: true, result: { id: 1, is_bot: true, username: 'omulimu_mock_bot' } });
  return json(res, 200, { ok: true, result: true });
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { /* form posts are fine to ignore */ }
    const url = req.url.split('?')[0];
    if (url === '/__sent') return json(res, 200, sent);
    if (url === '/__llm') return json(res, 200, llmCalls);
    if (url === '/__reset') { sent = []; llmCalls = []; rateLimited.clear(); badJsonSeen.clear(); return json(res, 200, { ok: true }); }
    if (url === '/v1/chat/completions') return handleLlm(req, res, body);
    if (url.startsWith('/v1/')) { llmCalls.push({ kind: 'forced_failure', at: Date.now() }); return json(res, 500, { error: { message: 'forced failure' } }); }
    const tg = url.match(/^\/bot[^/]+\/(\w+)$/);
    if (tg) return handleTelegram(tg[1], res, body);
    json(res, 404, { ok: false, description: 'not found' });
  });
}).listen(PORT, () => console.log(`mock telegram+llm on :${PORT}`));
