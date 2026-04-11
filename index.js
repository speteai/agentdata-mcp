#!/usr/bin/env node
/**
 * AgentData MCP Server
 *
 * Exposes 16 crypto market data endpoints from https://agentdata-api.com
 * as MCP tools. Claude Desktop, Cursor, and other MCP clients can use them.
 *
 * Payment handling: The client (Claude Desktop, etc.) must provide its own
 * x402-capable HTTP client if they want to auto-pay. This server supports two modes:
 *
 *   1. PROXY mode (default): forwards requests, returns 402 info if unpaid
 *   2. AUTH mode: set AGENTDATA_BUYER_PRIVATE_KEY env var → auto-pays from that wallet
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = process.env.AGENTDATA_BASE_URL || 'https://agentdata-api.com';
const BUYER_KEY = process.env.AGENTDATA_BUYER_PRIVATE_KEY;

// ============ TOOL DEFINITIONS ============

const TOOLS = [
  // Market Data
  {
    name: 'get_crypto_prices',
    description: 'Get real-time prices for BTC, ETH, SOL, BNB, XRP. Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/prices',
  },
  {
    name: 'get_funding_rates',
    description: 'Get perpetual futures funding rates for BTC/ETH/SOL with long/short signals. Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-rates',
  },
  {
    name: 'get_market_overview',
    description: 'Get full market overview with sentiment bias, arbitrage detection, funding yield. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/market-overview',
  },
  {
    name: 'get_volatility',
    description: 'Get 24h volatility, range, and annualized volatility for BTC/ETH/SOL. Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/volatility',
  },
  {
    name: 'get_liquidation_levels',
    description: 'Get estimated liquidation zones by leverage (5x/10x/20x) for BTC/ETH/SOL. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/liquidation-levels',
  },
  {
    name: 'get_correlation',
    description: 'Get 30-day price correlation matrix (ETH/BTC, SOL/BTC, SOL/ETH). Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/correlation',
  },

  // On-Chain
  {
    name: 'get_gas_prices',
    description: 'Get current gas prices for Base, Ethereum, Solana with USD cost estimation. Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/gas-prices',
  },
  {
    name: 'get_base_activity',
    description: 'Get Base Mainnet network activity: TPS, block stats, gas utilization. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/base-activity',
  },
  {
    name: 'get_defi_yields',
    description: 'Get top DeFi yield opportunities from Aave, Compound, Morpho, Pendle (via DefiLlama). Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/defi-yields',
  },

  // Arbitrage
  {
    name: 'get_arbitrage_opportunities',
    description: 'Get cross-exchange arbitrage opportunities between MEXC, Binance, Bybit, OKX. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/arbitrage-opportunities',
  },
  {
    name: 'get_dex_vs_cex',
    description: 'Get DEX aggregated prices vs CEX prices with spread analysis for BTC/ETH/SOL. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/dex-vs-cex',
  },

  // Technical Analysis
  {
    name: 'get_technical_indicators',
    description: 'Get RSI, MACD, Bollinger Bands, ATR for a symbol/interval. Costs $0.002 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Trading pair (e.g. BTCUSDT)', default: 'BTCUSDT' },
        interval: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], default: '1h' },
      },
    },
    endpoint: '/api/indicators',
  },
  {
    name: 'get_support_resistance',
    description: 'Get support & resistance levels via fractal analysis on 4h timeframe. Costs $0.003 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Trading pair', default: 'BTCUSDT' },
      },
    },
    endpoint: '/api/support-resistance',
  },

  // Sentiment
  {
    name: 'get_sentiment',
    description: 'Get composite market sentiment: Fear & Greed Index + Funding-based + composite score. Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/sentiment',
  },
  {
    name: 'get_stablecoin_health',
    description: 'Get stablecoin peg monitoring (USDC, DAI live depeg check) + top 10 stablecoins by market cap. Costs $0.001 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/stablecoin-health',
  },

  // Historical
  {
    name: 'get_historical',
    description: 'Get historical OHLCV candles for backtesting. Costs $0.005 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', default: 'BTCUSDT' },
        interval: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], default: '1d' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
    },
    endpoint: '/api/historical',
  },
];

// ============ X402 CLIENT (optional auto-pay) ============

let x402Fetch = null;

async function initX402Client() {
  if (!BUYER_KEY) return null;
  try {
    const { createWalletClient, createPublicClient, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { base } = await import('viem/chains');

    const account = privateKeyToAccount(BUYER_KEY);
    const publicClient = createPublicClient({ chain: base, transport: http() });
    const walletClient = createWalletClient({ account, chain: base, transport: http() });
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    return async (url) => {
      // First attempt
      const r1 = await fetch(url);
      if (r1.status !== 402) return r1;

      const header = r1.headers.get('payment-required');
      if (!header) return r1;
      const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      const accept = payload.accepts[0];

      // Sign ERC-3009 authorization
      const validAfter = 0;
      const validBefore = Math.floor(Date.now() / 1000) + (accept.maxTimeoutSeconds || 300);
      const nonce = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');

      const signature = await walletClient.signTypedData({
        account,
        domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: account.address,
          to: accept.payTo,
          value: BigInt(accept.maxAmountRequired),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      });

      const paymentPayload = {
        x402Version: 2, scheme: 'exact', network: accept.network,
        payload: { signature, authorization: {
          from: account.address, to: accept.payTo, value: accept.maxAmountRequired,
          validAfter: String(validAfter), validBefore: String(validBefore), nonce,
        }},
      };
      const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

      return fetch(url, {
        headers: {
          'PAYMENT-SIGNATURE': paymentHeader,
          'X-PAYMENT': paymentHeader,
        },
      });
    };
  } catch (e) {
    console.error('Failed to init x402 client:', e.message);
    return null;
  }
}

// ============ MCP SERVER ============

async function main() {
  x402Fetch = await initX402Client();

  const server = new Server(
    { name: 'agentdata-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    // Build URL with query params
    const url = new URL(BASE_URL + tool.endpoint);
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    try {
      const fetcher = x402Fetch || fetch;
      const res = await fetcher(url.toString());

      if (res.status === 402) {
        const header = res.headers.get('payment-required');
        let paymentInfo = {};
        if (header) {
          try { paymentInfo = JSON.parse(Buffer.from(header, 'base64').toString('utf8')); } catch {}
        }
        return {
          content: [{
            type: 'text',
            text: `Payment required. To use this endpoint, either:\n1. Set AGENTDATA_BUYER_PRIVATE_KEY env var for auto-pay\n2. Or manually pay: ${JSON.stringify(paymentInfo.accepts?.[0] || {}, null, 2)}`,
          }],
          isError: true,
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `Request failed: HTTP ${res.status}` }],
          isError: true,
        };
      }

      const data = await res.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`AgentData MCP server running (${x402Fetch ? 'auto-pay enabled' : 'proxy mode'})`);
}

main().catch(e => { console.error(e); process.exit(1); });
