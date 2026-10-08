// Small builders for n8n workflow JSON. Each workflow file describes nodes + connections with these.

const crypto = require('crypto');
const { inlineSource } = require('../lib/inline');

// Fixed IDs so Execute Workflow references and the error workflow survive `n8n import:workflow`.
const WF = {
  router: 'omulimuRouter001',
  numbers: 'omulimuNumbers01',
  coach: 'omulimuCoach0001',
  care: 'omulimuCare00001',
  help: 'omulimuHelp00001',
  sendReply: 'omulimuSendRepl1',
  errorAlert: 'omulimuErrorAlrt',
};

// Credential references only (id + name). The secrets live in n8n, never in these files.
const CRED = {
  postgres: { postgres: { id: 'omulimuPostgres1', name: 'Omulimu Postgres' } },
  llm: { httpHeaderAuth: { id: 'omulimuLlmKey001', name: 'Omulimu LLM key' } },
  telegram: { telegramApi: { id: 'omulimuTelegram1', name: 'Omulimu Telegram bot' } },
};

// Retry policy for every LLM call (R5).
const LLM_RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };
const LLM_TIMEOUT_MS = 20000;
// Short retry for the first database writes, so a brief Supabase blip doesn't drop a message.
const DB_RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 };

function uuid(seed) {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function workflow(key, name, build) {
  const nodes = [];
  const connections = {};
  const add = (n) => {
    if (nodes.some((x) => x.name === n.name)) throw new Error(`duplicate node name ${n.name} in ${name}`);
    nodes.push({ id: uuid(`${key}/${n.name}`), ...n });
    return n.name;
  };
  // link('A', 'B') or link('A', 'B', 1) for output index 1 (error output / IF false / switch case)
  const link = (from, to, output = 0) => {
    const c = (connections[from] = connections[from] || { main: [] });
    while (c.main.length <= output) c.main.push([]);
    c.main[output].push({ node: to, type: 'main', index: 0 });
  };
  build({ add, link });
  const settings = { executionOrder: 'v1', timezone: 'Africa/Kampala', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' };
  // Only workflows that start executions on their own get the error workflow. A failing sub-workflow
  // already fails its caller; giving it one too would loop (Error Alert → Send Reply → Error Alert …).
  if (key === 'router' || key === 'numbers') settings.errorWorkflow = WF.errorAlert;
  return { id: WF[key], name, active: false, nodes, connections, settings, pinData: {}, meta: { templateCredsSetupCompleted: false } };
}

// ---- node builders ---------------------------------------------------------

function code(name, position, body, libs = [], notes) {
  const prelude = libs.length ? inlineSource(libs) + '\n\n// ---- node logic ----\n' : '';
  return {
    name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
    parameters: { jsCode: prelude + body.trim() + '\n' },
    ...(notes ? { notes, notesInFlow: true } : {}),
  };
}

// Every query takes ONE jsonb parameter ($1): the object is JSON.stringify'd, and the Postgres node
// passes a JSON string as a single value, so text with commas or quotes is always safe.
function pg(name, position, query, paramsExpr, extra = {}) {
  return {
    name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position,
    parameters: {
      operation: 'executeQuery',
      query: query.trim(),
      options: paramsExpr ? { queryReplacement: `={{ JSON.stringify(${paramsExpr}) }}` } : {},
    },
    credentials: CRED.postgres,
    ...extra,
  };
}

function llmHttp(name, position, notes) {
  return {
    name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
    parameters: {
      method: 'POST',
      url: '={{ $json.llm_url }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'X-Title', value: 'Omulimu' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.llm_request) }}',
      options: { timeout: LLM_TIMEOUT_MS },
    },
    credentials: CRED.llm,
    ...LLM_RETRY,
    onError: 'continueErrorOutput',
    ...(notes ? { notes, notesInFlow: true } : {}),
  };
}

function ifNode(name, position, leftExpr, operator = { type: 'boolean', operation: 'true', singleValue: true }, rightValue = '') {
  return {
    name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: uuid(name), leftValue: `={{ ${leftExpr} }}`, rightValue, operator }],
        combinator: 'and',
      },
      options: {},
    },
  };
}

// Switch on a string expression; one output per value, in order.
function switchNode(name, position, expr, values) {
  return {
    name, type: 'n8n-nodes-base.switch', typeVersion: 3.2, position,
    parameters: {
      rules: {
        values: values.map((v) => ({
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: uuid(`${name}/${v}`), leftValue: `={{ ${expr} }}`, rightValue: v, operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: v,
        })),
      },
      options: {},
    },
  };
}

function subTrigger(position) {
  return {
    name: 'When Called', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position,
    parameters: { inputSource: 'passthrough' },
  };
}

function callWorkflow(name, position, key, extra = {}) {
  return {
    name, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position,
    parameters: {
      workflowId: { __rl: true, value: WF[key], mode: 'id' },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      mode: 'each',
      options: { waitForSubWorkflow: true },
    },
    ...extra,
  };
}

module.exports = { WF, CRED, LLM_RETRY, LLM_TIMEOUT_MS, DB_RETRY, uuid, workflow, code, pg, llmHttp, ifNode, switchNode, subTrigger, callWorkflow };
