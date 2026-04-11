# AgentData MCP Server

**Model Context Protocol server** exposing 16 crypto market data tools for Claude Desktop, Cursor, and any MCP-compatible AI client. Payments via [x402](https://www.x402.org) / USDC on Base Mainnet.

[![npm](https://img.shields.io/badge/npm-%40speteai%2Fagentdata--mcp-red)](https://github.com/speteai/agentdata-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-brightgreen)](https://registry.modelcontextprotocol.io)
[![x402 v2](https://img.shields.io/badge/x402-v2-00D395)](https://www.x402.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## What this is

A thin MCP wrapper around the [AgentData API](https://agentdata-api.com) — a production x402 service on Base Mainnet. Any MCP-compatible LLM can use these 16 tools with no setup beyond adding one line to your client config.

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

| Tool | Price | Use case |
|------|-------|----------|
| `get_crypto_prices` | $0.001 | Real-time BTC/ETH/SOL/BNB/XRP prices |
| `get_funding_rates` | $0.001 | Perp funding with long/short bias |
| `get_market_overview` | $0.002 | Full market sentiment + arb signals |
| `get_volatility` | $0.001 | 24h vol, range, annualized |
| `get_liquidation_levels` | $0.002 | Leverage-based liq zones |
| `get_correlation` | $0.001 | 30-day correlation matrix |
| `get_gas_prices` | $0.001 | Multi-chain gas (Base/ETH/SOL) |
| `get_base_activity` | $0.002 | Base network TPS + blocks |
| `get_defi_yields` | $0.002 | Top yields from DefiLlama |
| `get_arbitrage_opportunities` | $0.003 | Cross-exchange spreads |
| `get_dex_vs_cex` | $0.003 | DEX vs CEX price comparison |
| `get_technical_indicators` | $0.002 | RSI, MACD, BB, ATR |
| `get_support_resistance` | $0.003 | S/R via fractal analysis |
| `get_sentiment` | $0.001 | Fear & Greed + composite |
| `get_stablecoin_health` | $0.001 | USDC/DAI peg monitoring |
| `get_historical` | $0.005 | OHLCV for backtesting |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTDATA_BUYER_PRIVATE_KEY` | — | Wallet for auto-pay (optional) |
| `AGENTDATA_BASE_URL` | `https://agentdata-api.com` | Override API base URL |

## Cost Economics

For an agent querying all 16 tools once: **~$0.031 USDC**.
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
