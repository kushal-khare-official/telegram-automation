#!/usr/bin/env node
// Generates workflows/*.json and prompts.md from src/, then lints the result.
// Usage: node src/build.js            build + lint
//        node src/build.js --check    lint only, and fail if the committed files are stale

const fs = require('fs');
const path = require('path');
const { WF, LLM_TIMEOUT_MS } = require('./workflows/helpers');
const prompts = require('./lib/prompts');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['01_router', '02_brain_numbers', '03_brain_coach', '04_brain_care', '05_brain_help', '06_send_reply', '07_error_alert'];
const check = process.argv.includes('--check');

const SECRET_PATTERNS = [
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, 'Telegram bot token'],
  [/\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{20,}/, 'OpenAI/OpenRouter key'],
  [/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/, 'Postgres URL with password'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'JWT (Supabase key)'],
  [/"(?:password|accessToken|apiKey)"\s*:\s*"[^"]+"/, 'credential field'],
];

const problems = [];
const fail = (wf, msg) => problems.push(`${wf}: ${msg}`);

function lint(file, wf, text) {
  const names = new Set(wf.nodes.map((n) => n.name));
  if (names.size !== wf.nodes.length) fail(file, 'duplicate node names');

  for (const [from, c] of Object.entries(wf.connections)) {
    if (!names.has(from)) fail(file, `connection from unknown node "${from}"`);
    for (const out of c.main) for (const l of out) if (!names.has(l.node)) fail(file, `connection to unknown node "${l.node}"`);
  }

  // Sub-workflows must not have an error workflow: their failure already fails the caller, and
  // Error Alert → Send Reply → Error Alert would loop.
  const selfStarting = [WF.router, WF.numbers].includes(wf.id);
  if (!selfStarting && wf.settings.errorWorkflow) fail(file, 'sub-workflow must not set an error workflow');
  if (selfStarting && wf.settings.errorWorkflow !== WF.errorAlert) fail(file, 'must use the Error Alert workflow');

  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) fail(file, `looks like a hardcoded ${what}`);

  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.code') {
      try {
        // n8n wraps Code-node text in an async function, so top-level return/await are allowed.
        // eslint-disable-next-line no-new-func
        new Function(`return (async () => {\n${n.parameters.jsCode}\n})`);
      } catch (e) {
        fail(file, `Code node "${n.name}" does not parse: ${e.message}`);
      }
    }
    if (n.type === 'n8n-nodes-base.httpRequest' && n.credentials && n.credentials.httpHeaderAuth) {
      const ok = n.retryOnFail === true && n.maxTries === 3 && n.waitBetweenTries > 0
        && n.parameters.options.timeout <= LLM_TIMEOUT_MS && n.onError === 'continueErrorOutput';
      if (!ok) fail(file, `LLM node "${n.name}" is missing retry/timeout/error-output settings`);
      const errOut = wf.connections[n.name] && wf.connections[n.name].main[1];
      if (!errOut || errOut.length === 0) fail(file, `LLM node "${n.name}" has no error branch wired`);
    }
    const adminFallback = wf.id === WF.errorAlert && /ADMIN_CHAT_ID/.test(JSON.stringify(n.parameters));
    if (n.type === 'n8n-nodes-base.httpRequest' && /api\.telegram\.org|TELEGRAM_API_BASE/.test(JSON.stringify(n.parameters)) && wf.id !== WF.sendReply && !adminFallback) {
      fail(file, `node "${n.name}" talks to Telegram outside Send Reply`);
    }
    if (n.type === 'n8n-nodes-base.telegram') fail(file, `Telegram action node "${n.name}": only Send Reply may send`);
    if (n.type === 'n8n-nodes-base.executeWorkflow') {
      const target = n.parameters.workflowId.value;
      if (!Object.values(WF).includes(target)) fail(file, `node "${n.name}" calls unknown workflow ${target}`);
    }
    if (n.credentials) {
      for (const ref of Object.values(n.credentials)) {
        if (Object.keys(ref).some((k) => !['id', 'name'].includes(k))) fail(file, `node "${n.name}" carries credential data`);
      }
    }
  }
}

function decisionsDoc() {
  const { DECISION_QUESTIONS } = require('./lib/inline').load(['ugx', 'classifier', 'decisions']);
  return DECISION_QUESTIONS.map((q) => {
    const opts = (q.choices || []).map((c) => `  - \`${c.value}\`: ${c.description}`).join('\n');
    return `- **\`${q.name}\`** (${q.type}): ${q.instructions}${opts ? '\n' + opts : ''}`;
  }).join('\n');
}

function buildPromptsMd() {
  const tpl = fs.readFileSync(path.join(__dirname, 'prompts.template.md'), 'utf8');
  return tpl
    .replace('{{CLASSIFIER_SYSTEM}}', () => prompts.CLASSIFIER_SYSTEM)
    .replace('{{REPAIR_INSTRUCTION}}', () => prompts.repairInstruction(['<validation errors>']))
    .replace('{{COACH_SYSTEM}}', () => prompts.COACH_SYSTEM)
    .replace('{{TEMPLATES}}', () => require('./templates-doc')())
    .replace('{{DECISIONS}}', () => decisionsDoc())
    .replace('{{DISTRESS_THRESHOLD}}', () => String(require('./lib/inline').load(['ugx', 'classifier', 'decisions']).DISTRESS_THRESHOLD));
}

const outputs = [];
for (const src of SOURCES) {
  const wf = require(`./workflows/${src}`);
  const text = JSON.stringify(wf, null, 2) + '\n';
  const file = `workflows/${src}.json`;
  lint(file, wf, text);
  outputs.push([file, text]);
}
outputs.push(['prompts.md', buildPromptsMd()]);

for (const [file, text] of outputs) {
  const full = path.join(ROOT, file);
  if (check) {
    if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== text) problems.push(`${file} is stale: run node src/build.js`);
  } else {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

if (problems.length) {
  console.error('Build problems:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`${check ? 'Checked' : 'Built'} ${outputs.length} files, lint clean.`);
