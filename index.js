#!/usr/bin/env node
/**
 * AgentData MCP Server
 *
 * Exposes the AgentData API catalogue as MCP tools for Claude Desktop, Cursor,
 * and other MCP clients.
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
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createAutoPayFetch } from './x402-client.js';

const BASE_URL = process.env.AGENTDATA_BASE_URL || 'https://agentdata-api.com';
const BUYER_KEY = process.env.AGENTDATA_BUYER_PRIVATE_KEY;
const MAX_PAYMENT_USDC = process.env.AGENTDATA_MAX_PAYMENT_USDC || '0.05';
const SESSION_BUDGET_USDC = process.env.AGENTDATA_SESSION_BUDGET_USDC || '1.00';
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// ============ TOOL DEFINITIONS ============

export const TOOLS = [
  {
    name: 'get_overnight_risk_brief',
    description: 'Decision-ready overnight risk brief for $0.012 USDC: DEX-vs-CEX spreads, liquidation zones, funding predictions, sentiment, stablecoin health, and recorded changes since this wallet last called it. 20% cheaper than the five parts bought separately ($0.015), and one settlement instead of five.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/overnight-risk-brief',
  },
  // Memecoin risk. Every verdict is filed as a claim and scored publicly at
  // /calibration after 7 days, so the record can be checked before trusting it.
  {
    name: 'get_memecoin_risk',
    description: 'Memecoin risk verdict for one token on Solana or Base ($0.005 USDC): LOW, ELEVATED, HIGH or CRITICAL with every finding behind it — liquidity against real assets only, mint and freeze authority, honeypot and sell tax, liquidity lock, holder concentration. What a source cannot supply is reported as unknown, never as a pass. Each verdict is filed as a claim and scored publicly at /calibration after 7 days.',
    inputSchema: { type: 'object', properties: {
      chain: { type: 'string', enum: ['solana', 'base'], description: 'Chain the token lives on' },
      token: { type: 'string', description: 'Mint address (Solana) or 0x contract address (Base)' },
    }, required: ['chain', 'token'] },
    endpoint: '/api/memecoin/risk',
  },
  {
    name: 'get_new_memecoins',
    description: 'New memecoin pools on Solana or Base, screened every 15 minutes ($0.010 USDC): each with its risk verdict, the market at screening time and whether its 7-day claim has resolved. The same population the public track record is computed from.',
    inputSchema: { type: 'object', properties: {
      chain: { type: 'string', enum: ['solana', 'base'], default: 'solana' },
      hours: { type: 'integer', description: 'look-back window, 1-72', default: 24 },
    }, required: [] },
    endpoint: '/api/memecoin/new',
  },
  // Free samples, listed before anything priced. An agent arriving here can taste
  // the data before deciding, which the hosted endpoint has offered since
  // 2026-08-22 while this package did not. Rate-limited to 30 requests/min per IP.
  {
    name: 'try_crypto_prices',
    description: 'FREE SAMPLE, no payment: the real-time BTC price, to judge format and source. Rate-limited to 30 requests/min. get_crypto_prices ($0.002 USDC) adds ETH, SOL, BNB and XRP. The response lists what the sample withholds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/try/prices',
  },
  {
    name: 'try_sentiment',
    description: 'FREE SAMPLE, no payment: the Fear & Greed component of market sentiment. Rate-limited to 30 requests/min. get_sentiment adds the composite reading and the funding-derived component. The response lists what the sample withholds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/try/sentiment',
  },
  {
    name: 'try_funding_rates',
    description: 'FREE SAMPLE, no payment: the BTC perpetual funding rate. Rate-limited to 30 requests/min. get_funding_rates ($0.002 USDC) covers every tracked perpetual. The response lists what the sample withholds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/try/funding-rates',
  },
  // The recorded series. This is the part that cannot be fetched anywhere else:
  // it exists only because it was written down as it happened, and each day's
  // Merkle root is published on Base, so the record can be checked rather than
  // believed. Verify with /anchors?verify=YYYY-MM-DD.
  {
    name: 'get_signal_history_7d',
    description: 'The last 7 days of a recorded signal, not just its current value. Costs $0.005 USDC. Every recorded day is anchored on Base — verify at /anchors?verify=YYYY-MM-DD.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string', description: 'sentiment, funding-rates, liquidation-levels, volatility, correlation, positioning, supply, stablecoin-health, macro-onchain, defi-yields, dex-vs-cex, arbitrage-opportunities, funding-predictions' } }, required: ['signal'] },
    endpoint: '/api/history/7d',
  },
  {
    name: 'get_signal_history_30d',
    description: 'The last 30 days of a recorded signal. Costs $0.012 USDC. Anchored on Base like every recorded day. Offered only while those 30 days pass the readiness gate (no hole over 6h); otherwise the service answers 404.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string' } }, required: ['signal'] },
    endpoint: '/api/history/30d',
  },
  {
    name: 'get_signal_history_full',
    description: 'The complete recorded series for a signal. Costs $0.020 USDC. Anchored on Base like every recorded day. Offered only while the whole series passes the readiness gate (no hole over 6h); otherwise the service answers 404.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string' } }, required: ['signal'] },
    endpoint: '/api/history/full',
  },
  // Released by the readiness gate on 2026-08-31, once their own record was deep
  // enough to be worth charging for. Both answer a question no venue answers about
  // itself: what the gap between them was, and whether our own forecasts held up.
  {
    name: 'get_arbitrage_spread_history',
    description: '30 days of hourly cross-exchange spreads (MEXC/Binance/Bybit/OKX). Costs $0.015 USDC. Every venue publishes its own prices; nobody archives the spread between them. Offered only while the 30-day record passes the readiness gate.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/history/arbitrage-spreads',
  },
  {
    name: 'get_funding_accuracy',
    description: 'Track record of our funding predictions scored against the rates observed afterwards, over 30 days. Costs $0.015 USDC. Read it before paying for get_funding_predictions. Offered only while the 30-day record passes the readiness gate.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-accuracy',
  },
  {
    name: 'get_market_pulse',
    description: 'Bundle for $0.018 USDC: 8 signals in one call and one settlement — sentiment, liquidation levels, volatility, correlation, funding predictions, positioning, supply, stablecoin health. Bought separately they cost $0.022 and eight settlements.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/market-pulse',
  },
  {
    name: 'get_funding_predictions',
    description: 'Predicted next funding rate for BTC/ETH/SOL on MEXC, with time to settlement. Costs $0.003 USDC. Check get_signal_calibration first — this signal is scored openly and does not yet beat a naive baseline on mean error.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-predictions',
  },
  {
    name: 'get_positioning',
    description: 'Long/short positioning ratios across venues. Costs $0.005 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/positioning',
  },
  {
    name: 'get_etf_flows',
    description: 'Daily spot BTC/ETH ETF net flows in millions USD, with 30 days of history. Costs $0.005 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/etf-flows',
  },
  {
    name: 'get_macro_onchain',
    description: 'Macro on-chain indicators. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/macro-onchain',
  },
  {
    name: 'get_supply',
    description: 'Circulating, total and max supply for 18 coins, with the circulating-to-total ratio. A ratio below 1 under active emission is supply overhang. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/supply',
  },
  // Listed first deliberately. These are the things an agent cannot build for
  // itself — it exists only while it runs, so it cannot wait, remember, or
  // compare against its own last look. A wired-up agent also never re-reads the
  // catalogue: whatever it will buy, it learns here, at integration time.
  {
    name: 'get_changes_since_last_call',
    description: 'Only what changed for a signal since THIS wallet last paid for it. Costs $0.001 USDC — cheaper than any full payload. The server keeps the cursor, keyed to your wallet, so you never re-download or re-diff data you already hold. First call returns the last 24h.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string', description: 'sentiment, funding-rates, liquidation-levels, volatility, correlation, positioning, supply, stablecoin-health, macro-onchain, defi-yields, dex-vs-cex, arbitrage-opportunities, funding-predictions' } }, required: ['signal'] },
    endpoint: '/api/diff',
  },
  {
    name: 'watch_condition',
    description: 'Register a standing condition and let the always-on server watch it for you. Costs $0.010 USDC, lifetime up to 168h. Then poll watch_status for free instead of paying for repeated data calls.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string' }, subject: { type: 'string', description: 'e.g. BTC_USDT' }, op: { type: 'string', enum: ['above','below'] }, threshold: { type: 'number' }, hours: { type: 'number' } }, required: ['signal','op','threshold'] },
    endpoint: '/api/watch',
  },
  {
    name: 'get_signal_calibration',
    description: 'FREE. How often the signals here actually turned out right, scored against a naive baseline. Every claim is recorded before the outcome exists and scored afterwards from the recorded series. Read this before trusting any signal — including to see which ones do not yet justify their price.',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } }, required: [] },
    endpoint: '/calibration',
  },
  // Market Data
  {
    name: 'get_crypto_prices',
    description: 'Get real-time prices for BTC, ETH, SOL, BNB, XRP. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/prices',
  },
  {
    name: 'get_funding_rates',
    description: 'Get perpetual futures funding rates for BTC/ETH/SOL with long/short signals. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-rates',
  },
  {
    name: 'get_market_overview',
    description: 'Get full market overview with sentiment bias, arbitrage detection, funding yield. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/market-overview',
  },
  {
    name: 'get_volatility',
    description: 'Get 24h volatility, range, and annualized volatility for BTC/ETH/SOL. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/volatility',
  },
  {
    name: 'get_liquidation_levels',
    description: 'Get estimated liquidation zones by leverage (5x/10x/20x) for BTC/ETH/SOL. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/liquidation-levels',
  },
  {
    name: 'get_correlation',
    description: 'Get 30-day price correlation matrix (ETH/BTC, SOL/BTC, SOL/ETH). Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/correlation',
  },

  // On-Chain
  {
    name: 'get_gas_prices',
    description: 'Get current gas prices for Base, Ethereum, Solana with USD cost estimation. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/gas-prices',
  },
  {
    name: 'get_base_activity',
    description: 'Get Base Mainnet network activity: TPS, block stats, gas utilization. Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/base-activity',
  },
  {
    name: 'get_defi_yields',
    description: 'Get top DeFi yield opportunities from Aave, Compound, Morpho, Pendle (via DefiLlama). Costs $0.003 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/defi-yields',
  },

  // Arbitrage
  {
    name: 'get_arbitrage_opportunities',
    description: 'Get cross-exchange arbitrage opportunities between MEXC, Binance, Bybit, OKX. Costs $0.005 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/arbitrage-opportunities',
  },
  {
    name: 'get_dex_vs_cex',
    description: 'Get DEX aggregated prices vs CEX prices with spread analysis for BTC/ETH/SOL. Costs $0.005 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/dex-vs-cex',
  },

  // Technical Analysis
  {
    name: 'get_technical_indicators',
    description: 'Get RSI, MACD, Bollinger Bands, ATR for a symbol/interval. Costs $0.003 USDC.',
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
    description: 'Get support & resistance levels via fractal analysis on 4h timeframe. Costs $0.005 USDC.',
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
    description: 'Get composite market sentiment: Fear & Greed Index + Funding-based + composite score. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/sentiment',
  },
  {
    name: 'get_stablecoin_health',
    description: 'Get stablecoin peg monitoring (USDC, DAI live depeg check) + top 10 stablecoins by market cap. Costs $0.002 USDC.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/stablecoin-health',
  },

  // Historical
  {
    name: 'get_historical',
    description: 'Get historical OHLCV candles for backtesting. Costs $0.010 USDC.',
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

function initX402Client() {
  if (!BUYER_KEY) return null;
  return createAutoPayFetch({
    buyerKey: BUYER_KEY,
    maxPaymentUsdc: MAX_PAYMENT_USDC,
    sessionBudgetUsdc: SESSION_BUDGET_USDC,
  });
}

// ============ MCP SERVER ============

async function main() {
  x402Fetch = initX402Client();

  const server = new Server(
    { name: 'agentdata-mcp', version: PACKAGE_VERSION },
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
      const res = await fetcher(url.toString(), { signal: AbortSignal.timeout(60_000) });

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
  const mode = x402Fetch
    ? `auto-pay enabled for ${x402Fetch.walletAddress}, cap ${x402Fetch.maxPaymentUsdc} USDC/call, session budget ${x402Fetch.sessionBudgetUsdc} USDC`
    : 'proxy mode';
  console.error(`AgentData MCP server ${PACKAGE_VERSION} running with ${TOOLS.length} tools (${mode})`);
}

// npx and every MCP client config launch this through the .bin symlink, so
// argv[1] is the symlink while import.meta.url is the file it points at.
// Comparing them unresolved silently skipped main(): the process exited 0,
// printed nothing, and the client saw a server that never spoke. Resolve first.
const invokedAs = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : null;
if (invokedAs === import.meta.url) {
  main().catch(error => { console.error(error); process.exit(1); });
}
