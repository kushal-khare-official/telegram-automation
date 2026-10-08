// Numbers brain: deterministic, no LLM. Depends on ugx.js.

const ASK = {
  ask_sales: 'How much did you sell today, in UGX? For example: 50k.',
  ask_expenses: 'How much did you spend on the business today, in UGX? For example: 20k.',
};

function nudgeText(firstName) {
  return `Hi ${firstName || 'there'}, time for today's numbers. How much did you sell today, in UGX?`;
}

function recordText(sales, expenses) {
  return `Today: sales ${formatUgx(sales)}, expenses ${formatUgx(expenses)}, ${formatProfit(sales - expenses)}.`;
}

// dateLabel like "7 Oct" (formatted in SQL from the Kampala date)
function todayText(dateLabel, rec) {
  return `Today, ${dateLabel}: sales ${formatUgx(rec.sales_ugx)} · expenses ${formatUgx(rec.expenses_ugx)} · ${formatProfit(rec.profit_ugx)}`;
}

// action: 'start' (button / nudge), 'new' (daily_numbers without a session), 'continue' (session open)
// Returns {record, reply_text, session_update}. record is set when both amounts are known.
function numbersStep({ action, session, entities }) {
  if (action === 'start') {
    return { record: null, reply_text: ASK.ask_sales, session_update: { op: 'upsert', active_brain: 'numbers', step: 'ask_sales', context: {} } };
  }

  const open = session && session.active_brain === 'numbers' ? session : null;
  const ctx = Object.assign({}, (open && open.context) || {});
  const e = entities || {};
  const isAmount = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

  if (isAmount(e.sales_ugx)) ctx.sales_ugx = e.sales_ugx;
  if (isAmount(e.expenses_ugx)) ctx.expenses_ugx = e.expenses_ugx;
  if (!isAmount(e.sales_ugx) && !isAmount(e.expenses_ugx) && isAmount(e.amount_ugx)) {
    // An amount with no label counts as the one the current step asks for.
    const target = open && open.step === 'ask_expenses' ? 'expenses_ugx'
      : ctx.sales_ugx === undefined ? 'sales_ugx' : 'expenses_ugx';
    ctx[target] = e.amount_ugx;
  }

  if (ctx.sales_ugx !== undefined && ctx.expenses_ugx !== undefined) {
    const record = { sales_ugx: ctx.sales_ugx, expenses_ugx: ctx.expenses_ugx, profit_ugx: ctx.sales_ugx - ctx.expenses_ugx };
    return { record, reply_text: recordText(record.sales_ugx, record.expenses_ugx), session_update: { op: 'delete' } };
  }

  const step = ctx.sales_ugx === undefined ? 'ask_sales' : 'ask_expenses';
  return { record: null, reply_text: ASK[step], session_update: { op: 'upsert', active_brain: 'numbers', step, context: ctx } };
}

module.exports = { ASK, nudgeText, recordText, todayText, numbersStep };
