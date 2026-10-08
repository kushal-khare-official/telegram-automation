// Loads the `pg` driver that ships inside the n8n image (no extra install needed).
const path = require('path');
const fs = require('fs');

const roots = [
  process.env.N8N_MODULES,
  '/usr/local/lib/node_modules/n8n/node_modules',
  path.join(__dirname, 'node_modules'),
].filter(Boolean);

let pg = null;
for (const r of roots) {
  const p = path.join(r, 'pg');
  if (fs.existsSync(path.join(p, 'package.json'))) { pg = require(p); break; }
}
module.exports = pg || require('pg');
