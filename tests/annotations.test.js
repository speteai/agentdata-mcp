import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, isFree, toolAnnotations } from '../index.js';

// With a buyer key set, a paid tool pays from that wallet. Marked read-only, a
// client could run it without asking: the one thing these hints must get right.
test('paid tools are never read-only, free tools are', () => {
  for (const t of TOOLS) {
    const a = toolAnnotations(t);
    assert.equal(a.readOnlyHint, isFree(t), t.name);
    assert.equal(a.idempotentHint, isFree(t), `${t.name}: a paid call pays again`);
    assert.equal(a.destructiveHint, false, t.name);
    assert.equal(a.openWorldHint, true, t.name);
  }
  assert.deepEqual(TOOLS.filter(isFree).map((t) => t.name).sort(),
    ['get_signal_calibration', 'try_crypto_prices', 'try_funding_rates', 'try_sentiment']);
});

// A paid tool without a price would read as free to anyone skimming, and as paid
// to these hints. (Free samples may name the price of their paid counterpart.)
test('every paid tool quotes its price', () => {
  for (const t of TOOLS.filter((x) => !isFree(x))) assert.match(t.description, /\$[0-9.]+ USDC/, t.name);
});
