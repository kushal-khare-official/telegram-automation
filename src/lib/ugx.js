// UGX amount parsing and formatting. Pure functions, inlined into n8n Code nodes by src/build.js.

const LUGANDA_DIGITS = {
  emu: 1, gumu: 1, kumu: 1, limu: 1, omu: 1,
  bbiri: 2, ebiri: 2, abiri: 2, biri: 2,
  ssatu: 3, esatu: 3, asatu: 3, satu: 3,
  nnya: 4, ena: 4, ana: 4,
  ttaano: 5, etaano: 5, ataano: 5, taano: 5,
  mukaaga: 6, musanvu: 7, munaana: 8, mwenda: 9, kkumi: 10, ekkumi: 10,
};

// Luganda money units. "omutwalo" is 10,000; plural forms take a count word after them.
const LUGANDA_UNITS = [
  { re: /^(?:omu|e?mi)twalo$/, value: 10000 },
  { re: /^(?:lu|n)kumi$/, value: 1000 },
  { re: /^(?:aka|ka|obu|bu)kumi$/, value: 100000 },
  { re: /^(?:aka|obu)kadde$/, value: 1000000 },
];

const SUFFIX = {
  k: 1e3, thousand: 1e3, thou: 1e3,
  m: 1e6, mil: 1e6, million: 1e6, millions: 1e6,
  bn: 1e9, b: 1e9, billion: 1e9,
};

// Returns a whole-number UGX amount, null for "no amount", or NaN when the value can't be read.
function parseUgx(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? value : NaN;
  }
  if (typeof value !== 'string') return NaN;

  let s = value.toLowerCase().trim();
  if (s === '' || s === 'null' || s === 'none') return null;
  s = s
    .replace(/\/=|\/-/g, '')
    .replace(/\b(?:ugx|ushs?|shs?|shillings?|sh)\b\.?/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .trim();

  const num = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (num) {
    const base = parseFloat(num[1]);
    const mult = num[2] ? SUFFIX[num[2]] : 1;
    if (!mult) return NaN;
    const amount = Math.round(base * mult * 100) / 100;
    return Number.isInteger(amount) ? amount : NaN;
  }

  const words = s.split(/\s+/);
  const unit = LUGANDA_UNITS.find((u) => u.re.test(words[0]));
  if (unit) {
    if (words.length === 1) return unit.value;
    if (words.length === 2) {
      const n = /^\d+$/.test(words[1]) ? parseInt(words[1], 10) : LUGANDA_DIGITS[words[1]];
      return n ? unit.value * n : NaN;
    }
  }
  return NaN;
}

function groupThousands(n) {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatUgx(n) {
  return 'UGX ' + groupThousands(n);
}

// "profit UGX 75,000" or "loss UGX 5,000"
function formatProfit(profit) {
  return (profit < 0 ? 'loss ' : 'profit ') + formatUgx(profit);
}

module.exports = { parseUgx, formatUgx, formatProfit, groupThousands };
