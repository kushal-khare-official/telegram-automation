// Turns src/lib/*.js into plain script text for n8n Code nodes, and loads that same text for tests.
// Lib files share one scope (no require between them); the order below resolves dependencies.

const fs = require('fs');
const path = require('path');

const ORDER = ['ugx', 'classifier', 'decisions', 'route', 'numbers', 'reply', 'templates', 'prompts'];
const EXPORT_RE = /^module\.exports\s*=\s*\{([\s\S]*?)\};\s*$/m;

function read(name) {
  return fs.readFileSync(path.join(__dirname, `${name}.js`), 'utf8');
}

function exportNames(name) {
  const m = read(name).match(EXPORT_RE);
  if (!m) throw new Error(`src/lib/${name}.js has no module.exports block`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// Script text for the given libs, in dependency order, without module.exports.
function inlineSource(names) {
  return ORDER.filter((n) => names.includes(n))
    .map((n) => `// ---- lib/${n}.js ----\n` + read(n).replace(EXPORT_RE, '').trim())
    .join('\n\n');
}

// Evaluates exactly the text a Code node gets and returns all exported names.
function load(names) {
  const all = ORDER.filter((n) => names.includes(n));
  const exported = all.flatMap(exportNames);
  // eslint-disable-next-line no-new-func
  return new Function(`${inlineSource(all)}\nreturn { ${exported.join(', ')} };`)();
}

module.exports = { ORDER, inlineSource, load };
