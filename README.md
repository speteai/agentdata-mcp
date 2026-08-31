# AgentData MCP Server

**Model Context Protocol server** exposing 16 crypto market data tools for Claude Desktop, Cursor, and any MCP-compatible AI client. Payments via [x402](https://www.x402.org) / USDC on Base Mainnet.

[![npm](https://img.shields.io/badge/npm-%40speteai%2Fagentdata--mcp-red)](https://github.com/speteai/agentdata-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-brightgreen)](https://registry.modelcontextprotocol.io)
[![x402 v2](https://img.shields.io/badge/x402-v2-00D395)](https://www.x402.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## What this is

A thin MCP wrapper around the [AgentData API](https://agentdata-api.com) — a production x402 service on Base Mainnet. Any MCP-compatible LLM can use these 33 tools with no setup beyond adding one line to your client config — four of them free, so you can try before paying.

## Two modes

**Proxy mode (default)** — No wallet needed. When a tool is called, the server returns the x402 payment instructions so the MCP client can handle payment however it prefers.

**Auto-pay mode** — Set `AGENTDATA_BUYER_PRIVATE_KEY` to a wallet funded with USDC on Base. The server signs ERC-3009 `TransferWithAuthorization` automatically using viem. Payments are gasless for the buyer — the facilitator covers settlement gas.

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

**Option 1: Remote MCP (easiest, no install)**
```json
{
  "mcpServers": {
    "agentdata": {
      "url": "https://agentdata-api.com/mcp"
    }
  }
}
```

**Option 2: Local stdio**
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

Generated from the running service, not maintained by hand — the old table listed 16 tools
at prices that had drifted (`get_crypto_prices` was shown at $0.001 and costs $0.002).
Four tools are free, including the calibration record: read that before trusting any signal.

| Tool | Price | What it gives you |
|------|-------|-------------------|
| `try_crypto_prices` | **free** | FREE — real-time prices for BTC, ETH, SOL, BNB, XRP |
| `try_sentiment` | **free** | FREE — current market sentiment |
| `try_funding_rates` | **free** | FREE — perpetual funding rates |
| `get_signal_calibration` | **free** | FREE — How often our own signals turned out right, scored against a naive b… |
| `get_changes_since_last_call` | $0.001 | Only what changed for a signal since THIS wallet last paid for it ($0.001 U… |
| `watch_condition` | $0.010 | Register a standing condition and let the always-on server watch it for you… |
| `get_market_pulse` | $0.018 | Bundle for $0.018 USDC: 8 signals in one call and one payment — sentiment, … |
| `get_crypto_prices` | $0.002 | Real-time prices for BTC, ETH, SOL, BNB, XRP |
| `get_funding_rates` | $0.002 | Perpetual funding rates with long/short signals |
| `get_funding_predictions` | $0.003 | Predicted next funding rate for BTC/ETH/SOL on MEXC, with time to settlement |
| `get_market_overview` | $0.003 | Full market overview with sentiment + arb signals |
| `get_volatility` | $0.002 | 24h volatility for BTC/ETH/SOL |
| `get_liquidation_levels` | $0.003 | Estimated liquidation zones by leverage 5x/10x/20x |
| `get_correlation` | $0.002 | 30-day price correlation matrix |
| `get_gas_prices` | $0.002 | Multi-chain gas prices Base/ETH/SOL |
| `get_base_activity` | $0.003 | Base network TPS + block activity |
| `get_defi_yields` | $0.003 | Top DeFi yields (Aave/Compound/Morpho/Pendle) |
| `get_arbitrage_opportunities` | $0.005 | Cross-exchange spreads MEXC/Binance/Bybit/OKX |
| `get_dex_vs_cex` | $0.005 | DEX vs CEX price comparison |
| `get_technical_indicators` | $0.003 | RSI, MACD, Bollinger Bands, ATR |
| `get_support_resistance` | $0.005 | S/R levels via fractal analysis |
| `get_sentiment` | $0.002 | Fear & Greed + composite sentiment |
| `get_stablecoin_health` | $0.002 | USDC/DAI depeg monitoring |
| `get_historical` | $0.010 | Historical OHLCV candles |
| `get_positioning` | $0.005 | Trader positioning: open interest, long/short ratios (global + top traders)… |
| `get_etf_flows` | $0.005 | Spot BTC & ETH ETF daily net flows (institutional demand, USD millions) — l… |
| `get_macro_onchain` | $0.003 | Macro & on-chain context: stablecoin supply, BTC/ETH dominance, market cap,… |
| `get_supply` | $0.003 | Circulating/total/max supply + circ/total overhang ratio per major coin — s… |
| `get_signal_history_7d` | $0.005 | Recorded hourly history of a derived signal, most recent 7 days  |
| `get_signal_history_30d` | $0.012 | Recorded hourly history of a derived signal, most recent 30 days . |
| `get_signal_history_full` | $0.020 | Complete recorded hourly history of a derived signal . |
| `get_arbitrage_spread_history` | $0.015 | 30 days of hourly cross-exchange spreads (MEXC/Binance/Bybit/OKX)  |
| `get_funding_accuracy` | $0.015 | Track record of our funding predictions scored against the rates observed a… |

The readiness gate withholds a tool until its own record is deep enough to be worth charging
for. The last two were released on 2026-08-31; everything in the catalogue is now served.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTDATA_BUYER_PRIVATE_KEY` | — | Wallet for auto-pay (optional) |
| `AGENTDATA_BASE_URL` | `https://agentdata-api.com` | Override API base URL |

## Cost Economics

For an agent querying every paid tool once: **~$0.169 USDC**. The four free tools cost nothing,
and `get_market_pulse` bundles eight signals for $0.018 instead of $0.022 bought separately.
For common queries (prices + sentiment): **~$0.002 USDC per full context update**.

Fund your buyer wallet with $5 USDC → good for ~2500 sentiment checks or ~150 full backtesting queries.

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
