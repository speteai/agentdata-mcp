#!/usr/bin/env node
/**
 * Does this package still describe the service it wraps?
 *
 * The tool catalogue lives here AND in the service (mcp-http.js). Two copies of
 * the same list drift, and they did: on 2026-08-25 this package offered 19 tools
 * against the service's 31, and five descriptions quoted prices the service had
 * long since changed — get_positioning said $0.003 while $0.005 was charged.
 * A tool catalogue is read by machines, so a wrong price is a broken contract.
 *
 * The service refuses to start on such a mismatch (checkToolPrices in
 * mcp-http.js). This package cannot do that — it must keep working when the
 * service is unreachable — so it checks on demand instead. Run it before
 * publishing.
 *
 *   node scripts-check-catalogue.mjs
 */
const BASE = process.env.AGENTDATA_BASE_URL || 'https://agentdata-api.com';

const call = async (method, params) => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
  }
  throw new Error(`no JSON-RPC payload in the answer (HTTP ${r.status})`);
};

const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8'));
const mine = new Map();
for (const m of src.matchAll(/name: '([a-z_0-9]+)',\s*\n\s*description: '((?:[^'\\]|\\.)*)'/g)) {
  mine.set(m[1], m[2]);
}

let live;
try {
  live = (await call('tools/list', {})).result.tools;
} catch (e) {
  console.error(`Cannot reach ${BASE}: ${e.message}`);
  console.error('Nothing was checked — this is inconclusive, not a pass.');
  process.exit(2);
}

const liveNames = new Set(live.map((t) => t.name));
const missing = [...liveNames].filter((n) => !mine.has(n));
// Served only while their recorded window passes the service's readiness gate.
// On 2026-09-22 four of them were absent because the outage of 2026-09-07 left a
// 20-hour hole inside their 30-day window; the full history can stay withheld
// indefinitely. Absent-while-gated is the service working, not the catalogue
// drifting — but a gated tool that IS served still has its price checked below.
const GATED = new Set([
  'get_signal_history_7d', 'get_signal_history_30d', 'get_signal_history_full',
  'get_arbitrage_spread_history', 'get_funding_accuracy',
]);
const absent = [...mine.keys()].filter((n) => !liveNames.has(n));
const withheld = absent.filter((n) => GATED.has(n));
const extra = absent.filter((n) => !GATED.has(n));

// Prices are quoted inside prose here; compare the numbers the service quotes.
const priceOf = (d) => (String(d || '').match(/\$([0-9.]+) USDC/) || [])[1];
const wrongPrice = [];
for (const t of live) {
  const here = priceOf(mine.get(t.name));
  const there = priceOf(t.description);
  if (here && there && Number(here) !== Number(there)) {
    wrongPrice.push({ tool: t.name, here: `$${here}`, service: `$${there}` });
  }
}

console.log(`package: ${mine.size} tools | service: ${liveNames.size} tools`);
if (missing.length) console.log(`missing here (${missing.length}): ${missing.join(', ')}`);
if (extra.length) console.log(`not served (${extra.length}): ${extra.join(', ')}`);
if (withheld.length) console.log(`withheld by the readiness gate right now (${withheld.length}, not a discrepancy): ${withheld.join(', ')}`);
for (const w of wrongPrice) console.log(`price: ${w.tool} says ${w.here}, the service charges ${w.service}`);

const problems = missing.length + extra.length + wrongPrice.length;
console.log(problems ? `\n${problems} discrepancy(ies) — fix before publishing.` : '\nCatalogue matches the service.');
process.exit(problems ? 1 : 0);
