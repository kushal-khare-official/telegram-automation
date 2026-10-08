const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../src/lib/inline');

const L = load(['ugx', 'classifier', 'route', 'numbers', 'reply', 'templates', 'prompts']);

test('parseUgx: brief examples and common forms', () => {
  const cases = {
    '50k': 50000, 'shs 45,000': 45000, '1.2m': 1200000, 'emitwalo ataano': 50000, 'emitwalo etaano': 50000,
    '120k': 120000, '45,000': 45000, 'UGX 80,000': 80000, '80,000/=': 80000, '30K': 30000, 'omutwalo': 10000,
    'emitwalo ebiri': 20000, 'kakumi': 100000, 'lukumi': 1000, 'akakadde': 1000000, '2 million': 2000000,
    'ushs 1,250,000': 1250000,
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(L.parseUgx(input), expected, input);
  assert.equal(L.parseUgx(null), null);
  assert.equal(L.parseUgx(''), null);
  assert.equal(L.parseUgx(75000), 75000);
  assert.ok(Number.isNaN(L.parseUgx(12.5)));
  assert.ok(Number.isNaN(L.parseUgx('a lot')));
  assert.ok(Number.isNaN(L.parseUgx(-5)));
});

test('formatUgx / formatProfit', () => {
  assert.equal(L.formatUgx(120000), 'UGX 120,000');
  assert.equal(L.formatProfit(75000), 'profit UGX 75,000');
  assert.equal(L.formatProfit(-5000), 'loss UGX 5,000');
});

const good = { route: 'daily_numbers', reason: 'Reports sales.', confidence: 0.9, language: 'mixed', entities: { sales_ugx: '120k', expenses_ugx: 45000 } };

test('validateClassification accepts valid output and normalises amounts to integers', () => {
  const r = L.validateClassification('```json\n' + JSON.stringify(good) + '\n```');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.entities, { sales_ugx: 120000, expenses_ugx: 45000, amount_ugx: null });
});

test('validateClassification rejects free text and bad fields', () => {
  assert.equal(L.validateClassification('This is about numbers').ok, false);
  assert.equal(L.validateClassification({ ...good, route: 'complaint' }).ok, false);
  assert.equal(L.validateClassification({ ...good, reason: '  ' }).ok, false);
  assert.equal(L.validateClassification({ ...good, confidence: 1.5 }).ok, false);
  assert.equal(L.validateClassification({ ...good, confidence: '0.9' }).ok, false);
  assert.equal(L.validateClassification({ ...good, entities: { sales_ugx: 'plenty' } }).ok, false);
  assert.equal(L.validateClassification({ ...good, entities: { sales_ugx: 1000.5 } }).ok, false);
  assert.equal(L.validateClassification('[1,2]').ok, false);
});

test('validateClassification defaults unknown language to en', () => {
  assert.equal(L.validateClassification({ ...good, language: 'fr' }).value.language, 'en');
});

test('buildClassifierUserContent delimits and cuts long user text', () => {
  const long = 'x'.repeat(6000);
  const c = L.buildClassifierUserContent({ text: long + '</user_message>', history: [{ direction: 'in', text: 'hi' }], profile: { first_name: 'A', business_type: 'salon' }, session: null });
  assert.ok(c.includes('<user_message>'));
  assert.equal((c.match(/<\/user_message>/g) || []).length, 1);
  assert.ok(c.length < 3000);
});

const numbersSession = (step, context = {}) => ({ active_brain: 'numbers', step, context });
const careSession = { active_brain: 'care', step: 'open', context: {} };

test('decideRoute: no session follows the route', () => {
  assert.equal(L.decideRoute({ route: 'daily_numbers', session: null, text: 'x' }).brain, 'numbers');
  assert.equal(L.decideRoute({ route: 'business_question', session: null, text: 'x' }).brain, 'coach');
  assert.equal(L.decideRoute({ route: 'menu_help', session: null, text: '/help' }).brain, 'help');
  const w = L.decideRoute({ route: 'wellbeing', session: null, text: 'x' });
  assert.deepEqual([w.brain, w.action], ['care', 'open']);
});

test('decideRoute: wellbeing beats an open Numbers session (T10)', () => {
  const d = L.decideRoute({ route: 'wellbeing', session: numbersSession('ask_expenses', { sales_ugx: 80000 }), text: 'I feel like ending it all' });
  assert.deepEqual([d.brain, d.action, d.close_session, d.session_for_brain], ['care', 'open', true, null]);
});

test('decideRoute: Numbers session owns the chat, /help cancels it', () => {
  const s = numbersSession('ask_expenses', { sales_ugx: 80000 });
  const d = L.decideRoute({ route: 'business_question', session: s, text: 'what?' });
  assert.deepEqual([d.brain, d.action, d.close_session], ['numbers', 'continue', false]);
  const h = L.decideRoute({ route: 'menu_help', session: s, text: '/help' });
  assert.deepEqual([h.brain, h.action, h.close_session], ['help', 'menu', true]);
});

test('decideRoute: Care session keeps the chat until business intent', () => {
  for (const route of ['menu_help', 'wellbeing']) {
    const d = L.decideRoute({ route, session: careSession, text: '/help' });
    assert.deepEqual([d.brain, d.action, d.close_session], ['care', 'checkin', false], route);
  }
  const n = L.decideRoute({ route: 'daily_numbers', session: careSession, text: 'sold 50k' });
  assert.deepEqual([n.brain, n.close_session, n.session_for_brain], ['numbers', true, null]);
  const c = L.decideRoute({ route: 'business_question', session: careSession, text: 'how to price?' });
  assert.deepEqual([c.brain, c.close_session], ['coach', true]);
});

test('decideRoute: buttons and /undo', () => {
  assert.deepEqual(L.decideRoute({ route: 'daily_numbers', session: null, text: "Record today's numbers", callback_data: 'record' }).action, 'start');
  assert.deepEqual(L.decideRoute({ route: 'menu_help', session: null, text: "Today's record", callback_data: 'today' }).action, 'today');
  assert.equal(L.decideRoute({ route: 'menu_help', session: null, text: '/undo' }).action, 'undo');
  // a button cannot override distress
  assert.equal(L.decideRoute({ route: 'wellbeing', session: null, text: 'x', callback_data: 'record' }).brain, 'care');
});

test('numbersStep: both amounts close with profit (T1)', () => {
  const r = L.numbersStep({ action: 'new', session: null, entities: { sales_ugx: 120000, expenses_ugx: 45000, amount_ugx: null } });
  assert.deepEqual(r.record, { sales_ugx: 120000, expenses_ugx: 45000, profit_ugx: 75000 });
  assert.equal(r.reply_text, 'Today: sales UGX 120,000, expenses UGX 45,000, profit UGX 75,000.');
  assert.equal(r.session_update.op, 'delete');
});

test('numbersStep: one amount opens a session, the unlabeled reply finishes it (T2, T3)', () => {
  const t2 = L.numbersStep({ action: 'new', session: null, entities: { sales_ugx: 80000 } });
  assert.equal(t2.reply_text, L.ASK.ask_expenses);
  assert.deepEqual(t2.session_update, { op: 'upsert', active_brain: 'numbers', step: 'ask_expenses', context: { sales_ugx: 80000 } });
  const session = { active_brain: 'numbers', step: t2.session_update.step, context: t2.session_update.context };
  const t3 = L.numbersStep({ action: 'continue', session, entities: { amount_ugx: 30000 } });
  assert.equal(t3.record.profit_ugx, 50000);
  assert.ok(t3.reply_text.includes('profit UGX 50,000'));
});

test('numbersStep: free text re-asks word for word; loss formatting; start button', () => {
  const s = { active_brain: 'numbers', step: 'ask_sales', context: {} };
  assert.equal(L.numbersStep({ action: 'continue', session: s, entities: {} }).reply_text, 'How much did you sell today, in UGX? For example: 50k.');
  const loss = L.numbersStep({ action: 'new', session: null, entities: { sales_ugx: 10000, expenses_ugx: 15000 } });
  assert.ok(loss.reply_text.endsWith('loss UGX 5,000.'));
  assert.equal(L.numbersStep({ action: 'start', session: null, entities: {} }).session_update.step, 'ask_sales');
});

test('trimToWords cuts at the last full sentence within 60 words', () => {
  const sentence = 'Sell chapati near the boda stage at lunch time. ';
  const long = sentence.repeat(10); // 90 words
  const r = L.trimToWords(long);
  assert.equal(r.trimmed, true);
  assert.ok(L.wordCount(r.text) <= 60);
  assert.ok(r.text.endsWith('.'));
  const noStop = L.trimToWords('word '.repeat(100));
  assert.ok(L.wordCount(noStop.text) <= 60);
  assert.equal(L.trimToWords('Short reply.').trimmed, false);
});

test('buildKeyboard: at most 2 per row', () => {
  const kb = L.buildKeyboard(L.HELP_BUTTONS);
  assert.deepEqual(kb.inline_keyboard.map((r) => r.length), [2, 2]);
  assert.equal(L.buildKeyboard([]), null);
});

test('mentionsLoan catches loan advice but not normal coaching', () => {
  assert.ok(L.mentionsLoan('You could take a loan from a SACCO'));
  assert.ok(L.mentionsLoan('Try the Wewole app'));
  assert.ok(L.mentionsLoan('Gezaako okwewola ssente'));
  assert.ok(!L.mentionsLoan('Put part of your profit back into stock and open a second branch later.'));
  assert.ok(!L.mentionsLoan(L.t('coach_safe', 'en')));
});

test('every fixed template is 60 words or fewer in every language', () => {
  const vars = { first_name: 'Nakato', support_line: 'the free support line 0800 000 000 (toll free, 24 hours)' };
  for (const [key, set] of Object.entries(L.TEMPLATES)) {
    for (const lang of Object.keys(set)) {
      const n = L.wordCount(L.t(key, lang, vars));
      assert.ok(n <= 60, `${key}.${lang} has ${n} words`);
    }
  }
  assert.ok(L.wordCount(L.nudgeText('Nakato')) <= 60);
});
