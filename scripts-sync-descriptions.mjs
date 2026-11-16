#!/usr/bin/env node
/**
 * Copy the tool descriptions from the hosted MCP into index.js, verbatim.
 *
 * The descriptions are what an LLM reads to choose a tool, and the service
 * (mcp-http.js) is where they are written. Two hand-kept copies drifted before
 * (2026-08-25: 19 tools here against 31, five wrong prices); check-catalogue now
 * fails on any difference, and this is the way to fix one.
 *
 *   node scripts-sync-descriptions.mjs          show what would change
 *   node scripts-sync-descriptions.mjs --write  rewrite index.js
 */
import fs from 'node:fs';
const BASE = process.env.AGENTDATA_BASE_URL || 'https://agentdata-api.com';
const write = process.argv.includes('--write');
const r = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  signal: AbortSignal.timeout(20_000),
});
const line = (await r.text()).split('\n').find((l) => l.startsWith('data: '));
const live = new Map(JSON.parse(line.slice(6)).result.tools.map((t) => [t.name, t.description]));
const file = new URL('./index.js', import.meta.url);
let src = fs.readFileSync(file, 'utf8');
const quote = (s) => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
let changed = 0;
src = src.replace(/(name: '([a-z_0-9]+)',\s*\n\s*description: ')((?:[^'\\]|\\.)*)(')/g, (m, head, name, desc, tail) => {
  if (!live.has(name)) return m;
  const want = quote(live.get(name));
  if (want === desc) return m;
  changed++;
  console.log(`${write ? 'updated' : 'differs'}: ${name}`);
  return head + want + tail;
});
if (write && changed) fs.writeFileSync(file, src);
console.log(changed ? `${changed} description(s) ${write ? 'updated' : 'differ — run with --write'}` : 'All descriptions match the service.');
