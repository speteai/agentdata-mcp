import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

const BASE_NETWORK = 'eip155:8453';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const DEFAULT_MAX_PAYMENT_USDC = '0.05';
// Per process, not per call. Refusing is recoverable; an unnoticed drained
// wallet is not, so this defaults to a small number rather than to unlimited.
const DEFAULT_SESSION_BUDGET_USDC = '1.00';

export function usdcToAtomic(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) {
    throw new Error(`invalid USDC amount ${JSON.stringify(value)}`);
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

export function atomicToUsdc(value) {
  const atomic = BigInt(value);
  const sign = atomic < 0n ? '-' : '';
  const absolute = atomic < 0n ? -atomic : atomic;
  return `${sign}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, '0')}`;
}

export function decodePaymentRequired(headerValue) {
  if (!headerValue) throw new Error('402 response omitted PAYMENT-REQUIRED');
  try {
    return JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
  } catch {
    throw new Error('PAYMENT-REQUIRED is not valid base64 JSON');
  }
}

function selectRequirement(paymentRequired, maxPaymentUsdc) {
  if (paymentRequired?.x402Version !== 2 || !Array.isArray(paymentRequired.accepts)) {
    throw new Error('auto-pay requires an x402 v2 PAYMENT-REQUIRED response');
  }

  const accepted = paymentRequired.accepts.find((candidate) =>
    candidate?.scheme === 'exact'
      && candidate?.network === BASE_NETWORK
      && String(candidate?.asset || '').toLowerCase() === BASE_USDC
  );
  if (!accepted) throw new Error('no supported Base USDC exact payment option');

  const amount = accepted.amount ?? accepted.maxAmountRequired;
  if (!/^\d+$/.test(String(amount || ''))) throw new Error('payment requirement has no atomic USDC amount');

  const maximum = usdcToAtomic(maxPaymentUsdc);
  if (BigInt(amount) > maximum) {
    throw new Error(`requested payment ${amount} atomic USDC exceeds auto-pay cap ${maximum}`);
  }
  return { accepted, amount: String(amount) };
}

export async function buildPaymentPayload({
  paymentRequired,
  account,
  maxPaymentUsdc = DEFAULT_MAX_PAYMENT_USDC,
  nowSeconds = Math.floor(Date.now() / 1000),
  nonce = `0x${randomBytes(32).toString('hex')}`,
}) {
  const { accepted, amount } = selectRequirement(paymentRequired, maxPaymentUsdc);
  const chainId = Number(String(accepted.network).split(':')[1]);
  const timeout = Number(accepted.maxTimeoutSeconds) || 300;
  const validAfter = Math.max(0, nowSeconds - 60);
  const validBefore = nowSeconds + timeout;
  const authorization = {
    from: account.address,
    to: accepted.payTo,
    value: amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };
  const signature = await account.signTypedData({
    domain: {
      name: accepted.extra?.name || 'USD Coin',
      version: accepted.extra?.version || '2',
      chainId,
      verifyingContract: accepted.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce,
    },
  });

  return {
    x402Version: 2,
    ...(paymentRequired.resource !== undefined ? { resource: paymentRequired.resource } : {}),
    accepted,
    payload: { signature, authorization },
    ...(paymentRequired.extensions !== undefined ? { extensions: paymentRequired.extensions } : {}),
  };
}

export function createAutoPayFetch({
  buyerKey,
  maxPaymentUsdc = DEFAULT_MAX_PAYMENT_USDC,
  sessionBudgetUsdc = DEFAULT_SESSION_BUDGET_USDC,
  fetchImpl = globalThis.fetch,
}) {
  if (!buyerKey) throw new Error('AGENTDATA_BUYER_PRIVATE_KEY is required for auto-pay');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  usdcToAtomic(maxPaymentUsdc);
  // maxPaymentUsdc caps ONE call. On its own that is not a budget: an agent in a
  // loop pays it again on every iteration, without bound. The session budget is
  // the actual spending limit, and it is checked before the authorization is
  // signed — once signed, the money can move.
  const budget = usdcToAtomic(sessionBudgetUsdc);
  let spent = 0n;
  const account = privateKeyToAccount(buyerKey);
  const paymentFetch = async (url, init = {}) => {
    const firstResponse = await fetchImpl(url, init);
    if (firstResponse.status !== 402) return firstResponse;

    const paymentRequired = decodePaymentRequired(firstResponse.headers.get('payment-required'));
    const paymentPayload = await buildPaymentPayload({
      paymentRequired,
      account,
      maxPaymentUsdc,
    });
    const accepted = paymentPayload.accepted;
    const amount = BigInt(accepted.amount ?? accepted.maxAmountRequired);
    if (spent + amount > budget) {
      throw new Error(
        `auto-pay session budget exhausted: ${atomicToUsdc(spent)} of ${atomicToUsdc(budget)} USDC already spent, `
        + `this call needs ${atomicToUsdc(amount)}. Raise AGENTDATA_SESSION_BUDGET_USDC or restart the session.`,
      );
    }
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
    const headers = new Headers(init.headers);
    headers.set('PAYMENT-SIGNATURE', paymentHeader);
    const paidResponse = await fetchImpl(url, { ...init, headers });
    // Count only what actually settled. A refused settlement returns 402 and
    // costs nothing, so charging it against the budget would lock out a wallet
    // that never spent anything.
    const settled = paidResponse.status === 200
      && Boolean(paidResponse.headers.get('payment-response') || paidResponse.headers.get('x-payment-response'));
    if (settled) spent += amount;
    return paidResponse;
  };

  paymentFetch.walletAddress = account.address;
  paymentFetch.maxPaymentUsdc = String(maxPaymentUsdc);
  paymentFetch.sessionBudgetUsdc = atomicToUsdc(budget);
  paymentFetch.spentUsdc = () => atomicToUsdc(spent);
  paymentFetch.remainingUsdc = () => atomicToUsdc(budget - spent);
  return paymentFetch;
}
