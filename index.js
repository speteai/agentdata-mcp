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
    description: 'Overnight risk check in one payment ($0.012 USDC): DEX-vs-CEX spreads, liquidation zones, next funding, sentiment and stablecoin pegs, plus what changed since this wallet last called. Use before leaving positions unattended or at the start of a session. Not for one number (call that tool alone) or for memecoins (get_memecoin_risk). The five parts bought separately cost $0.015 and five settlements.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/overnight-risk-brief',
  },
  // Memecoin risk. Every verdict is filed as a claim and scored publicly at
  // /calibration after 7 days, so the record can be checked before trusting it.
  {
    name: 'get_memecoin_risk',
    description: 'Red-flag check for one memecoin on Solana or Base ($0.005 USDC): liquidity against real assets only, mint and freeze authority, honeypot and sell tax, liquidity lock, holder concentration, every finding listed and unknowns reported as unknown. Use before buying or recommending one specific new token. Not a buy signal: most new tokens die within a week whatever the level says, and each response carries that record.',
    inputSchema: { type: 'object', properties: {
      chain: { type: 'string', enum: ['solana', 'base'], description: 'Chain the token lives on' },
      token: { type: 'string', description: 'Mint address (Solana) or 0x contract address (Base)' },
    }, required: ['chain', 'token'] },
    endpoint: '/api/memecoin/risk',
  },
  {
    name: 'get_new_memecoins',
    description: 'Newest memecoin pools on Solana or Base with at least $10,000 of real liquidity, screened every 15 minutes, each with its risk verdict and the market at screening ($0.010 USDC). Use to see what just launched or to study launches. Not for one token you already know (get_memecoin_risk is cheaper). Most of these pools are dead within 7 days; each response carries the measured rate.',
    inputSchema: { type: 'object', properties: {
      chain: { type: 'string', enum: ['solana', 'base'], default: 'solana' },
      hours: { type: 'integer', description: 'look-back window, 1-72', default: 24 },
    }, required: [] },
    endpoint: '/api/memecoin/new',
  },
  // News and classification run on AI Power Grid (an open model on independent
  // GPU operators); the x402 search reads the service's daily census of the
  // Coinbase Bazaar. All three since 2026-11-15 in the service, 1.4.0 here.
  {
    name: 'get_crypto_news',
    description: 'Recent crypto news from seven public feeds, each item already labelled with assets, sentiment (bullish/bearish/neutral), relevance and category, plus counts per sentiment and asset ($0.003 USDC). Use for questions like what is the news on BTC today, or to scan headlines without reading feeds. Filters: hours (1-72), asset, relevance. Labels say what the news claims, not where the price goes.',
    inputSchema: { type: 'object', properties: {
      hours: { type: 'integer', description: 'look-back window, 1-72', default: 24 },
      asset: { type: 'string', description: 'only items about this ticker, e.g. BTC' },
      relevance: { type: 'string', enum: ['high', 'medium', 'low'], description: 'minimum relevance' },
    }, required: [] },
    endpoint: '/api/news',
  },
  {
    name: 'classify_crypto_text',
    description: 'Label one crypto text you already have, up to 1,000 characters ($0.005 USDC): assets, sentiment, relevance and category from fixed vocabularies, never free text. Use for a post, message or headline that is not in get_crypto_news. Not for private text: independent GPU operators on AI Power Grid process it in plain text. Not charged when it fails.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: 'the text to classify, 1-1000 characters' },
    }, required: ['text'] },
    endpoint: '/api/grid/classify',
  },
  {
    name: 'find_x402_services',
    description: 'Find other paid x402 APIs that answer right now ($0.005 USDC): searches our daily census of the Coinbase Bazaar (about 34,000 listings) by words, optionally under a maximum price, and checks the top results live: does it answer 402, how fast, is the price still as listed. Use when you need a capability this server does not have, e.g. weather or web search. At most two results per host.',
    inputSchema: { type: 'object', properties: {
      q: { type: 'string', description: 'words to look for, e.g. "weather forecast"' },
      maxPrice: { type: 'number', description: 'maximum price per call in USDC' },
      network: { type: 'string', enum: ['base', 'solana'], default: 'base' },
      limit: { type: 'integer', description: '1-20', default: 10 },
    }, required: ['q'] },
    endpoint: '/api/x402/services',
  },
  // Free samples, listed before anything priced. An agent arriving here can taste
  // the data before deciding, which the hosted endpoint has offered since
  // 2026-08-22 while this package did not. Rate-limited to 30 requests/min per IP.
  {
    name: 'try_crypto_prices',
    description: 'FREE SAMPLE, no payment: the real-time BTC price, to check format and freshness before paying. Use once to test the connection. Rate-limited to 30 requests/min. The paid get_crypto_prices ($0.002 USDC) adds ETH, SOL, BNB and XRP. The response lists what the sample withholds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/try/prices',
  },
  {
    name: 'try_sentiment',
    description: 'FREE SAMPLE, no payment: the Fear & Greed component of market sentiment. Use once to test the connection or for a rough mood reading. Rate-limited to 30 requests/min. The paid get_sentiment adds the composite and the funding-derived component. The response lists what the sample withholds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/try/sentiment',
  },
  {
    name: 'try_funding_rates',
    description: 'FREE SAMPLE, no payment: the BTC perpetual funding rate. Use once to test the connection. Rate-limited to 30 requests/min. The paid get_funding_rates ($0.002 USDC) covers every tracked perpetual. The response lists what the sample withholds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/try/funding-rates',
  },
  // The recorded series. This is the part that cannot be fetched anywhere else:
  // it exists only because it was written down as it happened, and each day's
  // Merkle root is published on Base, so the record can be checked rather than
  // believed. Verify with /anchors?verify=YYYY-MM-DD.
  {
    name: 'get_signal_history_7d',
    description: 'Recorded hourly history of one derived signal over the last 7 days ($0.005 USDC), e.g. sentiment or funding-predictions. Use to see how a signal moved, which public sources cannot give you after the fact. Needs signal=. Only signals with a gap-free record are offered.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string', description: 'sentiment, funding-rates, liquidation-levels, volatility, correlation, positioning, supply, stablecoin-health, macro-onchain, defi-yields, dex-vs-cex, arbitrage-opportunities, funding-predictions' } }, required: ['signal'] },
    endpoint: '/api/history/7d',
  },
  {
    name: 'get_signal_history_30d',
    description: 'Recorded hourly history of one derived signal over the last 30 days ($0.012 USDC). Use for a longer view than get_signal_history_7d; same signals. Needs signal=.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string' } }, required: ['signal'] },
    endpoint: '/api/history/30d',
  },
  {
    name: 'get_signal_history_full',
    description: 'Complete recorded hourly history of one derived signal ($0.020 USDC). Use for the longest backtest this record allows. Offered only once its record is long and gap-free enough. Needs signal=.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string' } }, required: ['signal'] },
    endpoint: '/api/history/full',
  },
  // Released by the readiness gate on 2026-08-31, once their own record was deep
  // enough to be worth charging for. Both answer a question no venue answers about
  // itself: what the gap between them was, and whether our own forecasts held up.
  {
    name: 'get_arbitrage_spread_history',
    description: 'Hourly cross-exchange spreads between MEXC, Binance, Bybit and OKX over 30 days ($0.015 USDC). Use to judge whether a current spread is unusual. Every venue publishes its own prices, but nobody else archives the spread between them.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/history/arbitrage-spreads',
  },
  {
    name: 'get_funding_accuracy',
    description: 'Our funding predictions paired with the rates actually observed afterwards, over 30 days ($0.015 USDC). Use to audit get_funding_predictions in detail; the free summary is in get_signal_calibration.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-accuracy',
  },
  {
    name: 'get_market_pulse',
    description: 'Eight market signals in one payment ($0.018 USDC): sentiment, liquidation levels, volatility, correlation, funding predictions, positioning, supply, stablecoin health. Use for a broad market snapshot; it beats four or more single calls (the parts cost $0.022). Not for one signal (call that tool) or for wallet-specific changes (get_overnight_risk_brief).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/market-pulse',
  },
  {
    name: 'get_funding_predictions',
    description: 'Predicted next funding rate for the BTC, ETH and SOL perpetuals on MEXC, with confidence and time to settlement ($0.003 USDC). Use before holding a perp through a funding settlement. Each response carries the scored record of these predictions against a naive guess.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-predictions',
  },
  {
    name: 'get_positioning',
    description: 'Trader positioning per coin: open interest, long/short ratios of all accounts and of top traders, and funding, from Binance and CoinEx, hourly ($0.005 USDC). Use to judge whether one side is crowded.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/positioning',
  },
  {
    name: 'get_etf_flows',
    description: 'Daily net flows of US spot Bitcoin and Ethereum ETFs in USD millions, latest trading day plus 30 days ($0.005 USDC). Use for institutional demand. Updated once per trading day, so not for intraday questions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/etf-flows',
  },
  {
    name: 'get_macro_onchain',
    description: 'Macro and on-chain context: stablecoin supply, BTC and ETH dominance, total market cap, BTC hash rate, transactions and fees, Fear & Greed, trending coins ($0.003 USDC). Use for the big picture behind a market move.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/macro-onchain',
  },
  {
    name: 'get_supply',
    description: 'Circulating, total and max supply per major coin, plus the circulating/total ratio: how much supply is still to come ($0.003 USDC). Use to judge future dilution. Source CryptoRank; the freshness field says how long the figures have been unchanged.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/supply',
  },
  // Listed first deliberately. These are the things an agent cannot build for
  // itself — it exists only while it runs, so it cannot wait, remember, or
  // compare against its own last look. A wired-up agent also never re-reads the
  // catalogue: whatever it will buy, it learns here, at integration time.
  {
    name: 'get_changes_since_last_call',
    description: 'Only what changed in one recorded signal since THIS wallet last paid for it ($0.001 USDC, the cheapest call here). Use when you check the same signal again and again: the server keeps your cursor, so you never re-download what you already have. Needs signal= (e.g. sentiment, funding-rates, volatility); the first call returns the last 24h. Not for a one-off question: call the signal tool itself.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string', description: 'sentiment, funding-rates, liquidation-levels, volatility, correlation, positioning, supply, stablecoin-health, macro-onchain, defi-yields, dex-vs-cex, arbitrage-opportunities, funding-predictions' } }, required: ['signal'] },
    endpoint: '/api/diff',
  },
  {
    name: 'watch_condition',
    description: 'Leave a condition on a recorded signal and let this always-on server check it ($0.010 USDC, up to 168h), e.g. sentiment below 20. Use when you will not be running at the moment it matters. Check whether it fired with a free GET to /watch/status?wallet=&token= (both returned when you register). Not for reading a value now: call the signal tool.',
    inputSchema: { type: 'object', properties: { signal: { type: 'string' }, subject: { type: 'string', description: 'e.g. BTC_USDT' }, op: { type: 'string', enum: ['above','below'] }, threshold: { type: 'number' }, hours: { type: 'number' } }, required: ['signal','op','threshold'] },
    endpoint: '/api/watch',
  },
  {
    name: 'get_signal_calibration',
    description: 'FREE. Track record of every signal here that makes a prediction, scored against a naive baseline: hit rate, error, whether it beats the baseline (beatsBaseRate, beatsNaive), and known weaknesses. Use before relying on any signal as a forecast, or to weight sources against each other. Every claim is recorded before its outcome exists.',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } }, required: [] },
    endpoint: '/calibration',
  },  {
    name: 'get_tool_pricing',
    description: 'FREE. The price in USDC of every paid tool here, in one call, and how payment works. Use to plan a budget before a loop of calls. Prices are fixed: the 402 reply to a call is the binding quote, and nothing is charged unless data is delivered.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/pricing',
  },

  // Market Data
  {
    name: 'get_crypto_prices',
    description: 'Spot prices for BTC, ETH, SOL, BNB and XRP ($0.002 USDC). Use when you need the current price of these majors. Not for other coins, for candles (get_historical) or for on-chain prices (get_dex_vs_cex).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/prices',
  },
  {
    name: 'get_funding_rates',
    description: 'Current perpetual funding rate per coin ($0.002 USDC). Use when you need what longs pay shorts right now, e.g. to judge crowding before opening a perp. Read the rate field: the long/short verdict is almost always NEUTRAL at the funding levels seen so far. For the next settlement use get_funding_predictions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/funding-rates',
  },
  {
    name: 'get_market_overview',
    description: 'One combined read of prices, sentiment and cross-exchange arbitrage signals ($0.003 USDC). Use for a quick general look at the market. For more signals in one payment use get_market_pulse.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/market-overview',
  },
  {
    name: 'get_volatility',
    description: 'Volatility, 24h range and annualised volatility for BTC, ETH and SOL from the last 24 hourly candles ($0.002 USDC). Use for position sizing or stop distances. The 24h range forecast is scored publicly; each response carries that record.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/volatility',
  },
  {
    name: 'get_liquidation_levels',
    description: 'Estimated liquidation price zones at 5x, 10x and 20x leverage, long and short, for BTC, ETH and SOL ($0.003 USDC). Use to see where forced buying or selling could cluster near the price. Use the price levels and ignore riskLevel: it has read LOW in every observation so far.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/liquidation-levels',
  },
  {
    name: 'get_correlation',
    description: '30-day price correlation for ETH/BTC, SOL/BTC and SOL/ETH ($0.002 USDC). Use for diversification or hedging decisions among these three.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/correlation',
  },

  // On-Chain
  {
    name: 'get_gas_prices',
    description: 'Gas prices on Base and Ethereum with USD cost estimates, plus Solana priority fees ($0.002 USDC). Use before sending a transaction, to estimate its cost or to pick a chain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/gas-prices',
  },
  {
    name: 'get_base_activity',
    description: 'Base network activity: latest block, transactions per second, block gas use ($0.003 USDC). Use to check whether Base is congested before sending.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/base-activity',
  },
  {
    name: 'get_defi_yields',
    description: 'Top DeFi yields across protocols such as Aave, Compound, Morpho and Pendle, from DefiLlama ($0.003 USDC). Use to compare where stablecoins or majors earn yield. Not a risk assessment of those protocols.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/defi-yields',
  },

  // Arbitrage
  {
    name: 'get_arbitrage_opportunities',
    description: 'Current price spreads above 0.05% for majors between MEXC, Binance, Bybit and OKX ($0.005 USDC). Use to spot cross-exchange dislocations. Spreads are before fees and transfer time. For their history use get_arbitrage_spread_history.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/arbitrage-opportunities',
  },
  {
    name: 'get_dex_vs_cex',
    description: 'On-chain price (WBTC, WETH, wSOL via DefiLlama) against MEXC spot for BTC, ETH and SOL, with spread, age of the on-chain price and confidence ($0.005 USDC). Use to check that on-chain and exchange prices agree before trading on-chain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/dex-vs-cex',
  },

  // Technical Analysis
  {
    name: 'get_technical_indicators',
    description: 'RSI, MACD, Bollinger Bands and ATR for a trading pair ($0.003 USDC). Parameters: symbol (default BTCUSDT), interval (default 1h). Use when a strategy needs standard indicators. Not scored as a forecast.',
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
    description: 'Support and resistance levels from fractal analysis on 4h candles ($0.005 USDC). Parameter: symbol (default BTCUSDT). Use to place entries, stops or targets around recent structure. Not scored as a forecast.',
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
    description: 'Market sentiment: Fear & Greed, a funding-derived component and a composite of both ($0.002 USDC). Use for the mood of the crowd right now. So far the funding term has stayed neutral, so the composite has been Fear & Greed rescaled. Each response carries the scored record of its 24h calls.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/sentiment',
  },
  {
    name: 'get_stablecoin_health',
    description: 'Peg check for USDC and DAI plus the ten largest stablecoins by market cap ($0.002 USDC). Use before holding or routing funds through a stablecoin, or when a depeg is rumoured.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    endpoint: '/api/stablecoin-health',
  },

  // Historical
  {
    name: 'get_historical',
    description: 'Historical OHLCV candles for a trading pair ($0.010 USDC). Parameters: symbol (default BTCUSDT), interval 1m to 1d, limit up to 500. Use for backtests or charts. Not for derived signals (get_signal_history_7d).',
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

/** Free tools say so first in their description; README pricing reads the same mark. */
export const isFree = (tool) => /^FREE\b/.test(tool.description);

/**
 * MCP tool annotations: what a client may assume before calling.
 *
 * Free tools only read public data, so clients may run them without asking.
 * Paid tools are deliberately NOT read-only: with AGENTDATA_BUYER_PRIVATE_KEY set,
 * a call pays from that wallet, and a client trusting readOnlyHint would let an
 * agent spend without anyone approving it. Each paid call pays again, so they are
 * not idempotent either. Nothing deletes or overwrites anything (not destructive);
 * all of them reach agentdata-api.com (openWorld). Same rule as the hosted MCP
 * (mcp-http.js in the service); check-catalogue compares the two.
 */
export function toolAnnotations(tool) {
  return isFree(tool)
    ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    : { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
}

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
      annotations: toolAnnotations(t),
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
