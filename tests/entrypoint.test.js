import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const INDEX = path.join(realpathSync(path.dirname(new URL(import.meta.url).pathname)), '..', 'index.js');

// 1.2.0 shipped a server that never started under npx: argv[1] was the .bin
// symlink, import.meta.url the file behind it, so the entry check never matched
// and main() was skipped. Exit code 0, no output, no error — the client just saw
// a server that said nothing. Every MCP client launches it exactly this way.
const boot = (entry) => execFileSync(process.execPath, [entry], {
  input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}\n',
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30_000,
}).length;

test('the server starts when launched through a bin symlink, as npx does', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentdata-bin-'));
  const link = path.join(dir, 'agentdata-mcp');
  symlinkSync(INDEX, link);
  assert.ok(boot(link) > 0, 'launching via the symlink must produce a response');
});

test('the server still starts when launched by its real path', () => {
  assert.ok(boot(INDEX) > 0);
});
