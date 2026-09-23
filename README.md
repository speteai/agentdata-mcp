# AgentData MCP Server

**Model Context Protocol server** exposing the live AgentData crypto catalogue to Claude Desktop, Cursor and other MCP clients. Payments use [x402](https://www.x402.org) and USDC on Base Mainnet.

[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-brightgreen)](https://registry.modelcontextprotocol.io)
[![x402 v2](https://img.shields.io/badge/x402-v2-00D395)](https://www.x402.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## What this is

A thin MCP wrapper around the [AgentData API](https://agentdata-api.com), a production x402 service on Base Mainnet. Free tools work through the remote MCP immediately. Paid tools accept a caller-signed payment payload or auto-pay through the local stdio package.

## Two modes

**Proxy mode (default)** — No wallet needed. Free tools return data; paid tools return canonical x402 requirements that a capable client can sign and submit.

**Auto-pay mode** — Set `AGENTDATA_BUYER_PRIVATE_KEY` to a wallet funded with USDC on Base. The package signs the exact x402 v2 requirement and retries automatically. It defaults to a `0.05` USDC per-call cap; the facilitator covers settlement gas.

Use a dedicated, low-balance buyer wallet. Never place a treasury or primary personal wallet key in an MCP configuration.

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

**Option 1: Remote MCP (free tools or externally signed payments)**
```json
{
  "mcpServers": {
    "agentdata": {
      "url": "https://agentdata-api.com/mcp"
    }
  }
}
```

**Option 2: Local stdio with auto-pay**
```json
{
  "mcpServers": {
    "agentdata": {
      "command": "npx",
      "args": ["-y", "agentdata-mcp"],
      "env": {
        "AGENTDATA_BUYER_PRIVATE_KEY": "0xYourWalletKeyHere"
      }
    }
  }
}
```

Restart Claude Desktop. The tools become available immediately.

### Cursor

Settings → MCP → Add Server with the same config as above.

### Install from source

```bash
git clone https://github.com/speteai/agentdata-mcp.git
cd agentdata-mcp
npm install
node index.js
```

## Available Tools

Generated from the package catalogue by `npm run sync-docs`. `npm run check-docs` and the
live catalogue comparison both run before publication, so tool counts and prices cannot drift silently.

<!-- tools:start -->
| Tool | Price | What it gives you |
|------|-------|-------------------|
| `get_overnight_risk_brief` | $0.012 | Decision-ready overnight risk brief for $0.012 USDC: DEX-vs-CEX spreads, liquidation zones, funding predictions, sentiment, stablecoin health, and recorded changes since this wallet last called it. 20% cheaper than the five parts bought separately ($0.015), and one settlement instead of five. |
| `get_memecoin_risk` | $0.005 | Memecoin risk verdict for one token on Solana or Base ($0.005 USDC): LOW, ELEVATED, HIGH or CRITICAL with every finding behind it — liquidity against real assets only, mint and freeze authority, honeypot and sell tax, liquidity lock, holder concentration. What a source cannot supply is reported as unknown, never as a pass. Each verdict is filed as a claim and scored publicly at /calibration after 7 days. |
| `get_new_memecoins` | $0.010 | New memecoin pools on Solana or Base, screened every 15 minutes ($0.010 USDC): each with its risk verdict, the market at screening time and whether its 7-day claim has resolved. The same population the public track record is computed from. |
| `try_crypto_prices` | **free** | FREE SAMPLE, no payment: the real-time BTC price, to judge format and source. Rate-limited to 30 requests/min. get_crypto_prices ($0.002 USDC) adds ETH, SOL, BNB and XRP. The response lists what the sample withholds. |
| `try_sentiment` | **free** | FREE SAMPLE, no payment: the Fear & Greed component of market sentiment. Rate-limited to 30 requests/min. get_sentiment adds the composite reading and the funding-derived component. The response lists what the sample withholds. |
| `try_funding_rates` | **free** | FREE SAMPLE, no payment: the BTC perpetual funding rate. Rate-limited to 30 requests/min. get_funding_rates ($0.002 USDC) covers every tracked perpetual. The response lists what the sample withholds. |
| `get_signal_history_7d` | $0.005 | The last 7 days of a recorded signal, not just its current value. Costs $0.005 USDC. Every recorded day is anchored on Base — verify at /anchors?verify=YYYY-MM-DD. |
| `get_signal_history_30d` | $0.012 | The last 30 days of a recorded signal. Costs $0.012 USDC. Anchored on Base like every recorded day. Offered only while those 30 days pass the readiness gate (no hole over 6h); otherwise the service answers 404. |
| `get_signal_history_full` | $0.020 | The complete recorded series for a signal. Costs $0.020 USDC. Anchored on Base like every recorded day. Offered only while the whole series passes the readiness gate (no hole over 6h); otherwise the service answers 404. |
| `get_arbitrage_spread_history` | $0.015 | 30 days of hourly cross-exchange spreads (MEXC/Binance/Bybit/OKX). Costs $0.015 USDC. Every venue publishes its own prices; nobody archives the spread between them. Offered only while the 30-day record passes the readiness gate. |
| `get_funding_accuracy` | $0.015 | Track record of our funding predictions scored against the rates observed afterwards, over 30 days. Costs $0.015 USDC. Read it before paying for get_funding_predictions. Offered only while the 30-day record passes the readiness gate. |
| `get_market_pulse` | $0.018 | Bundle for $0.018 USDC: 8 signals in one call and one settlement — sentiment, liquidation levels, volatility, correlation, funding predictions, positioning, supply, stablecoin health. Bought separately they cost $0.022 and eight settlements. |
| `get_funding_predictions` | $0.003 | Predicted next funding rate for BTC/ETH/SOL on MEXC, with time to settlement. Costs $0.003 USDC. Check get_signal_calibration first — this signal is scored openly and does not yet beat a naive baseline on mean error. |
| `get_positioning` | $0.005 | Long/short positioning ratios across venues. Costs $0.005 USDC. |
| `get_etf_flows` | $0.005 | Daily spot BTC/ETH ETF net flows in millions USD, with 30 days of history. Costs $0.005 USDC. |
| `get_macro_onchain` | $0.003 | Macro on-chain indicators. Costs $0.003 USDC. |
| `get_supply` | $0.003 | Circulating, total and max supply for 18 coins, with the circulating-to-total ratio. A ratio below 1 under active emission is supply overhang. Costs $0.003 USDC. |
| `get_changes_since_last_call` | $0.001 | Only what changed for a signal since THIS wallet last paid for it. Costs $0.001 USDC — cheaper than any full payload. The server keeps the cursor, keyed to your wallet, so you never re-download or re-diff data you already hold. First call returns the last 24h. |
| `watch_condition` | $0.010 | Register a standing condition and let the always-on server watch it for you. Costs $0.010 USDC, lifetime up to 168h. Then poll watch_status for free instead of paying for repeated data calls. |
| `get_signal_calibration` | **free** | FREE. How often the signals here actually turned out right, scored against a naive baseline. Every claim is recorded before the outcome exists and scored afterwards from the recorded series. Read this before trusting any signal — including to see which ones do not yet justify their price. |
| `get_crypto_prices` | $0.002 | Get real-time prices for BTC, ETH, SOL, BNB, XRP. Costs $0.002 USDC. |
| `get_funding_rates` | $0.002 | Get perpetual futures funding rates for BTC/ETH/SOL with long/short signals. Costs $0.002 USDC. |
| `get_market_overview` | $0.003 | Get full market overview with sentiment bias, arbitrage detection, funding yield. Costs $0.003 USDC. |
| `get_volatility` | $0.002 | Get 24h volatility, range, and annualized volatility for BTC/ETH/SOL. Costs $0.002 USDC. |
| `get_liquidation_levels` | $0.003 | Get estimated liquidation zones by leverage (5x/10x/20x) for BTC/ETH/SOL. Costs $0.003 USDC. |
| `get_correlation` | $0.002 | Get 30-day price correlation matrix (ETH/BTC, SOL/BTC, SOL/ETH). Costs $0.002 USDC. |
| `get_gas_prices` | $0.002 | Get current gas prices for Base, Ethereum, Solana with USD cost estimation. Costs $0.002 USDC. |
| `get_base_activity` | $0.003 | Get Base Mainnet network activity: TPS, block stats, gas utilization. Costs $0.003 USDC. |
| `get_defi_yields` | $0.003 | Get top DeFi yield opportunities from Aave, Compound, Morpho, Pendle (via DefiLlama). Costs $0.003 USDC. |
| `get_arbitrage_opportunities` | $0.005 | Get cross-exchange arbitrage opportunities between MEXC, Binance, Bybit, OKX. Costs $0.005 USDC. |
| `get_dex_vs_cex` | $0.005 | Get DEX aggregated prices vs CEX prices with spread analysis for BTC/ETH/SOL. Costs $0.005 USDC. |
| `get_technical_indicators` | $0.003 | Get RSI, MACD, Bollinger Bands, ATR for a symbol/interval. Costs $0.003 USDC. |
| `get_support_resistance` | $0.005 | Get support & resistance levels via fractal analysis on 4h timeframe. Costs $0.005 USDC. |
| `get_sentiment` | $0.002 | Get composite market sentiment: Fear & Greed Index + Funding-based + composite score. Costs $0.002 USDC. |
| `get_stablecoin_health` | $0.002 | Get stablecoin peg monitoring (USDC, DAI live depeg check) + top 10 stablecoins by market cap. Costs $0.002 USDC. |
| `get_historical` | $0.010 | Get historical OHLCV candles for backtesting. Costs $0.010 USDC. |
<!-- tools:end -->
The readiness gate withholds history tools until their own record is deep enough to justify charging. Run `npm run check-catalogue` before publishing to compare this package with the live service.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTDATA_BUYER_PRIVATE_KEY` | — | Wallet for auto-pay (optional) |
| `AGENTDATA_MAX_PAYMENT_USDC` | `0.05` | Hard per-call auto-pay cap |
| `AGENTDATA_SESSION_BUDGET_USDC` | `1.00` | Total auto-pay spend per process |
| `AGENTDATA_BASE_URL` | `https://agentdata-api.com` | Override API base URL |

The per-call cap is not a spending limit on its own — an agent in a loop pays it
on every iteration. `AGENTDATA_SESSION_BUDGET_USDC` is the limit that actually
stops: once the process has spent it, further paid calls fail with an error
instead of signing another authorization. Refused settlements cost nothing and
do not count against it.

## Cost Economics

`get_overnight_risk_brief` replaces five calls totalling $0.015 with one $0.012 settlement.
`get_market_pulse` bundles eight broader signals for $0.018 instead of $0.022 bought separately.
The free calibration tool should be read before paying for a derived signal.

Fund your buyer wallet with $5 USDC → good for roughly 2,500 sentiment checks or 250 full-history calls.

No ETH needed on the buyer wallet. The AgentData facilitator pays settlement gas.

## Related

- **[agentdata-api](https://github.com/speteai/agentdata-api)** — the underlying service
- **[elizaos-plugin-agentdata](https://github.com/speteai/elizaos-plugin-agentdata)** — ElizaOS plugin version
- **Live service:** https://agentdata-api.com
- **Admin dashboard:** https://agentdata-api.com/admin

## Keywords

Model Context Protocol, MCP server, Claude Desktop MCP, Cursor MCP, crypto market data MCP, x402 MCP, AI agent tools, agentic payments, USDC micropayments, Base Mainnet API, DeFi data for AI, crypto tools for LLM, autonomous agent data, agent economy, DeFAI

## License

MIT — see [LICENSE](LICENSE).
