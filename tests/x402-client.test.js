import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentPayload,
  createAutoPayFetch,
  decodePaymentRequired,
  usdcToAtomic,
} from '../x402-client.js';

const BUYER_KEY = `0x${'11'.repeat(32)}`;
const ACCEPTED = {
  scheme: 'exact',
  network: 'eip155:8453',
  amount: '15000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x844fedF9651C446bcA039b94e6b94a23cb3D6B89',
  maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2' },
};
const REQUIRED = {
  x402Version: 2,
  resource: { url: 'https://agentdata-api.com/api/overnight-risk-brief' },
  accepts: [ACCEPTED],
};

test('USDC limits convert without floating-point rounding', () => {
  assert.equal(usdcToAtomic('0.05'), 50_000n);
  assert.equal(usdcToAtomic('1.000001'), 1_000_001n);
  assert.throws(() => usdcToAtomic('0.0000001'), /invalid USDC amount/);
});

test('payment requirements decode from the response header', () => {
  const header = Buffer.from(JSON.stringify(REQUIRED)).toString('base64');
  assert.deepEqual(decodePaymentRequired(header), REQUIRED);
  assert.throws(() => decodePaymentRequired('not-json'), /base64 JSON/);
});

test('payment payload echoes the accepted requirement byte-for-byte', async () => {
  let signed;
  const account = {
    address: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
    signTypedData: async (typedData) => {
      signed = typedData;
      return `0x${'aa'.repeat(65)}`;
    },
  };
  const nonce = `0x${'22'.repeat(32)}`;
  const payload = await buildPaymentPayload({
    paymentRequired: REQUIRED,
    account,
    maxPaymentUsdc: '0.05',
    nowSeconds: 1_700_000_000,
    nonce,
  });

  assert.strictEqual(payload.accepted, ACCEPTED);
  assert.deepEqual(payload.resource, REQUIRED.resource);
  assert.equal(payload.payload.authorization.value, '15000');
  assert.equal(payload.payload.authorization.validAfter, '1699999940');
  assert.equal(payload.payload.authorization.validBefore, '1700000300');
  assert.equal(signed.domain.chainId, 8453);
  assert.equal(signed.message.value, 15_000n);
});

test('auto-pay retries once with a canonical v2 PAYMENT-SIGNATURE', async () => {
  const calls = [];
  const header = Buffer.from(JSON.stringify(REQUIRED)).toString('base64');
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': header } });
    }
    return new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const paymentFetch = createAutoPayFetch({ buyerKey: BUYER_KEY, fetchImpl });
  const response = await paymentFetch('https://agentdata-api.com/api/overnight-risk-brief');

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  const sent = JSON.parse(Buffer.from(calls[1].init.headers.get('payment-signature'), 'base64').toString('utf8'));
  assert.deepEqual(sent.accepted, ACCEPTED);
  assert.equal(sent.x402Version, 2);
  assert.match(sent.payload.signature, /^0x[0-9a-f]+$/i);
});

test('auto-pay refuses a price above its configured cap', async () => {
  const expensive = { ...REQUIRED, accepts: [{ ...ACCEPTED, amount: '50001' }] };
  const header = Buffer.from(JSON.stringify(expensive)).toString('base64');
  let calls = 0;
  const paymentFetch = createAutoPayFetch({
    buyerKey: BUYER_KEY,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': header } });
    },
  });

  await assert.rejects(paymentFetch('https://agentdata-api.com/api/prices'), /exceeds auto-pay cap/);
  assert.equal(calls, 1, 'must not retry a payment above the cap');
});

test('auto-pay fails at startup for an invalid key or cap', () => {
  assert.throws(() => createAutoPayFetch({ buyerKey: 'not-a-key' }), /private key|hex|size/i);
  assert.throws(() => createAutoPayFetch({ buyerKey: BUYER_KEY, maxPaymentUsdc: 'unlimited' }), /invalid USDC amount/);
});

// The per-call cap is not a budget: a looping agent pays it on every iteration.
// These cover the limit that actually stops spending.
const paymentRequiredResponse = () => new Response('', {
  status: 402,
  headers: { 'payment-required': Buffer.from(JSON.stringify(REQUIRED)).toString('base64') },
});
const settledResponse = () => new Response('{}', {
  status: 200,
  headers: { 'payment-response': Buffer.from('{"success":true}').toString('base64') },
});

test('session budget stops auto-pay before the authorization is signed', async () => {
  let paidCalls = 0;
  const fetchImpl = async (_url, init) => {
    if (init?.headers && new Headers(init.headers).get('PAYMENT-SIGNATURE')) {
      paidCalls += 1;
      return settledResponse();
    }
    return paymentRequiredResponse();
  };
  // 0.045 USDC buys exactly three calls at 0.015; the fourth must be refused.
  const pay = createAutoPayFetch({ buyerKey: BUYER_KEY, sessionBudgetUsdc: '0.045', fetchImpl });
  for (let i = 0; i < 3; i += 1) assert.equal((await pay('https://agentdata-api.com/x')).status, 200);
  assert.equal(pay.spentUsdc(), '0.045000');
  assert.equal(pay.remainingUsdc(), '0.000000');
  await assert.rejects(() => pay('https://agentdata-api.com/x'), /session budget exhausted/);
  assert.equal(paidCalls, 3, 'the refused call must never reach the network');
});

test('a settlement that fails costs nothing against the budget', async () => {
  const fetchImpl = async (_url, init) => {
    if (init?.headers && new Headers(init.headers).get('PAYMENT-SIGNATURE')) {
      return new Response('', { status: 402 });   // facilitator refused: no charge
    }
    return paymentRequiredResponse();
  };
  const pay = createAutoPayFetch({ buyerKey: BUYER_KEY, sessionBudgetUsdc: '0.015', fetchImpl });
  assert.equal((await pay('https://agentdata-api.com/x')).status, 402);
  assert.equal(pay.spentUsdc(), '0.000000', 'a refused payment must not consume the budget');
  assert.equal((await pay('https://agentdata-api.com/x')).status, 402);
});
