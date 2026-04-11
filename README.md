# AgentData MCP Server

MCP (Model Context Protocol) server that exposes the [AgentData API](https://agentdata-api.com) crypto market data endpoints as tools for Claude Desktop, Cursor, and any other MCP-compatible client.

## What it does

16 crypto market data tools via the x402 micropayment protocol on Base Mainnet. Prices, funding rates, volatility, liquidation levels, DeFi yields, cross-exchange arbitrage, technical indicators (RSI/MACD/BB/ATR), support/resistance, sentiment, stablecoin health, and historical OHLCV data.

## Install

```bash
npm install -g agentdata-mcp
```

Or run directly:
```bash
npx agentdata-mcp
```

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentdata": {
      "command": "npx",
      "args": ["-y", "agentdata-mcp"],
      "env": {
        "AGENTDATA_BUYER_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Modes

### Proxy mode (default)
Without `AGENTDATA_BUYER_PRIVATE_KEY`, the server returns 402 Payment Required info so you can handle payment yourself.

### Auto-pay mode
Set `AGENTDATA_BUYER_PRIVATE_KEY` to a wallet funded with USDC on Base. The server will automatically sign ERC-3009 TransferWithAuthorization messages and pay each request.

Fund your buyer wallet with:
- USDC on Base Mainnet (~$1 buys 1000 requests)
- No ETH required — payments are gasless (facilitator pays settlement gas)

## Tools

| Tool | Description | Price |
|------|-------------|-------|
| `get_crypto_prices` | Real-time prices for BTC/ETH/SOL/BNB/XRP | $0.001 |
| `get_funding_rates` | Perpetual futures funding rates | $0.001 |
| `get_market_overview` | Full market sentiment + arb signals | $0.002 |
| `get_volatility` | 24h volatility, range, annualized | $0.001 |
| `get_liquidation_levels` | Estimated liquidation zones by leverage | $0.002 |
| `get_correlation` | 30-day correlation matrix | $0.001 |
| `get_gas_prices` | Multi-chain gas (Base/ETH/SOL) | $0.001 |
| `get_base_activity` | Base network activity + TPS | $0.002 |
| `get_defi_yields` | Top DeFi yields from DefiLlama | $0.002 |
| `get_arbitrage_opportunities` | Cross-exchange spreads | $0.003 |
| `get_dex_vs_cex` | DEX vs CEX price comparison | $0.003 |
| `get_technical_indicators` | RSI, MACD, BB, ATR | $0.002 |
| `get_support_resistance` | S/R levels via fractal analysis | $0.003 |
| `get_sentiment` | Fear & Greed + composite | $0.001 |
| `get_stablecoin_health` | USDC/DAI depeg monitoring | $0.001 |
| `get_historical` | OHLCV candles for backtesting | $0.005 |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTDATA_BASE_URL` | `https://agentdata-api.com` | API base URL |
| `AGENTDATA_BUYER_PRIVATE_KEY` | (none) | Wallet private key for auto-pay |

## License

MIT
