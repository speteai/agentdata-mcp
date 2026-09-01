#!/usr/bin/env node
import fs from 'node:fs';
import { TOOLS } from './index.js';

const write = process.argv.includes('--write');
const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const readmeUrl = new URL('./README.md', import.meta.url);
const serverUrl = new URL('./server.json', import.meta.url);
const start = '<!-- tools:start -->';
const end = '<!-- tools:end -->';

const priceOf = (tool) => {
  if (/^FREE\b|FREE[.:]/i.test(tool.description)) return '**free**';
  const match = tool.description.match(/\$([0-9.]+) USDC/);
  return match ? `$${match[1]}` : '—';
};
const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = [
  start,
  '| Tool | Price | What it gives you |',
  '|------|-------|-------------------|',
  ...TOOLS.map((tool) => `| \`${tool.name}\` | ${priceOf(tool)} | ${escapeCell(tool.description)} |`),
  end,
].join('\n');

const currentReadme = fs.readFileSync(readmeUrl, 'utf8');
const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
if (!pattern.test(currentReadme)) throw new Error('README tool markers are missing');
const nextReadme = currentReadme.replace(pattern, table);

const currentServerText = fs.readFileSync(serverUrl, 'utf8');
const server = JSON.parse(currentServerText);
server.version = packageJson.version;
server.description = 'Verifiable crypto signals, recorded history and always-on monitoring for AI agents via x402 on Base.';
const nextServerText = `${JSON.stringify(server, null, 2)}\n`;

if (write) {
  fs.writeFileSync(readmeUrl, nextReadme);
  fs.writeFileSync(serverUrl, nextServerText);
  console.log(`Synchronized ${TOOLS.length} tools and package version ${packageJson.version}.`);
  process.exit(0);
}

const stale = [];
if (currentReadme !== nextReadme) stale.push('README.md tool table');
if (currentServerText !== nextServerText) stale.push('server.json metadata');
if (stale.length) {
  console.error(`Documentation drift: ${stale.join(', ')}. Run npm run sync-docs.`);
  process.exit(1);
}
console.log(`Documentation matches ${TOOLS.length} tools and package version ${packageJson.version}.`);
