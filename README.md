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

### OpenClaw

A skill for OpenClaw agents lives in [`skills/agentdata`](skills/agentdata/SKILL.md) and on ClawHub:

```bash
openclaw skills install @speteai/agentdata
```

It starts with the free samples and the calibration record, and explains how to register this server
with the buyer key referenced from the environment instead of written into the config.

## Available Tools

Generated from the package catalogue by `npm run sync-docs`. `npm run check-docs` and the
live catalogue comparison both run before publication, so tool counts and prices cannot drift silently.

<!-- tools:start -->
| Tool | Price | What it gives you |
|------|-------|-------------------|
| `get_overnight_risk_brief` | $0.012 | Overnight risk check in one payment ($0.012 USDC): DEX-vs-CEX spreads, liquidation zones, next funding, sentiment and stablecoin pegs, plus what changed since this wallet last called. Use before leaving positions unattended or at the start of a session. Not for one number (call that tool alone) or for memecoins (get_memecoin_risk). The five parts bought separately cost $0.015 and five settlements. |
| `get_memecoin_risk` | $0.005 | Red-flag check for one memecoin on Solana or Base ($0.005 USDC): liquidity against real assets only, mint and freeze authority, honeypot and sell tax, liquidity lock, holder concentration, every finding listed and unknowns reported as unknown. Use before buying or recommending one specific new token. Not a buy signal: most new tokens die within a week whatever the level says, and each response carries that record. |
| `get_wallet_risk` | $0.005 | Lending health of one wallet on Base ($0.005 USDC): every borrowing position on Aave v3 and Morpho Blue with health factor, band and how far collateral may fall before liquidation, weakest first. Use before adding risk to a wallet you manage, or to check a position you are not watching. A snapshot, not a forecast; Compound, Moonwell and other chains are not covered. To be woken when it falls, use watch_condition with signal=wallet-health. |
| `check_trade` | $0.008 | Red flags before one concrete trade ($0.008 USDC): slippage against the visible order book, liquidation distance against a normal day of movement, funding the position would pay, on-chain vs exchange price, USDC peg; for a memecoin its red flags and price impact. Use before placing an order. No go/no-go verdict: facts against stated thresholds, and rows with a forecast carry their scored record. For BTC, ETH, SOL or a memecoin by chain and token. |
| `get_new_memecoins` | $0.010 | Newest memecoin pools on Solana or Base with at least $10,000 of real liquidity, screened every 15 minutes, each with its risk verdict and the market at screening ($0.010 USDC). Use to see what just launched or to study launches. Not for one token you already know (get_memecoin_risk is cheaper). Most of these pools are dead within 7 days; each response carries the measured rate. |
| `get_crypto_news` | $0.003 | Recent crypto news from seven public feeds, each item already labelled with assets, sentiment (bullish/bearish/neutral), relevance and category, plus counts per sentiment and asset ($0.003 USDC). Use for questions like what is the news on BTC today, or to scan headlines without reading feeds. Filters: hours (1-72), asset, relevance. Labels say what the news claims, not where the price goes. |
| `classify_crypto_text` | $0.005 | Label one crypto text you already have, up to 1,000 characters ($0.005 USDC): assets, sentiment, relevance and category from fixed vocabularies, never free text. Use for a post, message or headline that is not in get_crypto_news. Not for private text: independent GPU operators on AI Power Grid process it in plain text. Not charged when it fails. |
| `find_x402_services` | $0.005 | Find other paid x402 APIs that answer right now ($0.005 USDC): searches our daily census of the Coinbase Bazaar (about 34,000 listings) by words, optionally under a maximum price, and checks the top results live: does it answer 402, how fast, is the price still as listed. Use when you need a capability this server does not have, e.g. weather or web search. At most two results per host. |
| `try_crypto_prices` | **free** | FREE SAMPLE, no payment: the real-time BTC price, to check format and freshness before paying. Use once to test the connection. Rate-limited to 30 requests/min. The paid get_crypto_prices ($0.002 USDC) adds ETH, SOL, BNB and XRP. The response lists what the sample withholds. |
| `try_sentiment` | **free** | FREE SAMPLE, no payment: the Fear & Greed component of market sentiment. Use once to test the connection or for a rough mood reading. Rate-limited to 30 requests/min. The paid get_sentiment adds the composite and the funding-derived component. The response lists what the sample withholds. |
| `try_funding_rates` | **free** | FREE SAMPLE, no payment: the BTC perpetual funding rate. Use once to test the connection. Rate-limited to 30 requests/min. The paid get_funding_rates ($0.002 USDC) covers every tracked perpetual. The response lists what the sample withholds. |
| `get_signal_history_7d` | $0.005 | Recorded hourly history of one derived signal over the last 7 days ($0.005 USDC), e.g. sentiment or funding-predictions. Use to see how a signal moved, which public sources cannot give you after the fact. Needs signal=. Only signals with a gap-free record are offered. |
| `get_signal_history_30d` | $0.012 | Recorded hourly history of one derived signal over the last 30 days ($0.012 USDC). Use for a longer view than get_signal_history_7d; same signals. Needs signal=. |
| `get_signal_history_full` | $0.020 | Complete recorded hourly history of one derived signal ($0.020 USDC). Use for the longest backtest this record allows. Offered only once its record is long and gap-free enough. Needs signal=. |
| `get_arbitrage_spread_history` | $0.015 | Hourly cross-exchange spreads between MEXC, Binance, Bybit and OKX over 30 days ($0.015 USDC). Use to judge whether a current spread is unusual. Every venue publishes its own prices, but nobody else archives the spread between them. |
| `get_funding_accuracy` | $0.015 | Our funding predictions paired with the rates actually observed afterwards, over 30 days ($0.015 USDC). Use to audit get_funding_predictions in detail; the free summary is in get_signal_calibration. |
| `get_market_pulse` | $0.018 | Eight market signals in one payment ($0.018 USDC): sentiment, liquidation levels, volatility, correlation, funding predictions, positioning, supply, stablecoin health. Use for a broad market snapshot; it beats four or more single calls (the parts cost $0.022). Not for one signal (call that tool) or for wallet-specific changes (get_overnight_risk_brief). |
| `get_funding_predictions` | $0.003 | Predicted next funding rate for the BTC, ETH and SOL perpetuals on MEXC, with confidence and time to settlement ($0.003 USDC). Use before holding a perp through a funding settlement. Each response carries the scored record of these predictions against a naive guess. |
| `get_positioning` | $0.005 | Trader positioning per coin: open interest, long/short ratios of all accounts and of top traders, and funding, from Binance and CoinEx, hourly ($0.005 USDC). Use to judge whether one side is crowded. |
| `get_etf_flows` | $0.005 | Daily net flows of US spot Bitcoin and Ethereum ETFs in USD millions, latest trading day plus 30 days ($0.005 USDC). Use for institutional demand. Updated once per trading day, so not for intraday questions. |
| `get_macro_onchain` | $0.003 | Macro and on-chain context: stablecoin supply, BTC and ETH dominance, total market cap, BTC hash rate, transactions and fees, Fear & Greed, trending coins ($0.003 USDC). Use for the big picture behind a market move. |
| `get_supply` | $0.003 | Circulating, total and max supply per major coin, plus the circulating/total ratio: how much supply is still to come ($0.003 USDC). Use to judge future dilution. Source CryptoRank; the freshness field says how long the figures have been unchanged. |
| `get_changes_since_last_call` | $0.001 | Only what changed in one recorded signal since THIS wallet last paid for it ($0.001 USDC, the cheapest call here). Use when you check the same signal again and again: the server keeps your cursor, so you never re-download what you already have. Needs signal= (e.g. sentiment, funding-rates, volatility); the first call returns the last 24h. Not for a one-off question: call the signal tool itself. |
| `watch_condition` | **free** | Leave a condition on a recorded signal, or on a wallet health factor, and let this always-on server check it every 5 minutes ($0.010 USDC, up to 168h). Use when you will not be running at the moment it matters. Pass webhook= (signed POST) or ntfy= (push topic) to be woken when it fires; /watch/status?wallet=&token= stays free. For a wallet use signal=wallet-health&subject=<address>&op=below&threshold=1.3. Not for reading a value now. |
| `get_signal_calibration` | **free** | FREE. Track record of every signal here that makes a prediction, scored against a naive baseline: hit rate, error, whether it beats the baseline (beatsBaseRate, beatsNaive), and known weaknesses. Use before relying on any signal as a forecast, or to weight sources against each other. Every claim is recorded before its outcome exists. |
| `get_tool_pricing` | **free** | FREE. The price in USDC of every paid tool here, in one call, and how payment works. Use to plan a budget before a loop of calls. Prices are fixed: the 402 reply to a call is the binding quote, and nothing is charged unless data is delivered. |
| `get_crypto_prices` | $0.002 | Spot prices for BTC, ETH, SOL, BNB and XRP ($0.002 USDC). Use when you need the current price of these majors. Not for other coins, for candles (get_historical) or for on-chain prices (get_dex_vs_cex). |
| `get_funding_rates` | $0.002 | Current perpetual funding rate per coin ($0.002 USDC). Use when you need what longs pay shorts right now, e.g. to judge crowding before opening a perp. Read the rate field: the long/short verdict is almost always NEUTRAL at the funding levels seen so far. For the next settlement use get_funding_predictions. |
| `get_market_overview` | $0.003 | One combined read of prices, sentiment and cross-exchange arbitrage signals ($0.003 USDC). Use for a quick general look at the market. For more signals in one payment use get_market_pulse. |
| `get_volatility` | $0.002 | Volatility, 24h range and annualised volatility for BTC, ETH and SOL from the last 24 hourly candles ($0.002 USDC). Use for position sizing or stop distances. The 24h range forecast is scored publicly; each response carries that record. |
| `get_liquidation_levels` | $0.003 | Estimated liquidation price zones at 5x, 10x and 20x leverage, long and short, for BTC, ETH and SOL ($0.003 USDC). Use to see where forced buying or selling could cluster near the price. Use the price levels and ignore riskLevel: it has read LOW in every observation so far. |
| `get_correlation` | $0.002 | 30-day price correlation for ETH/BTC, SOL/BTC and SOL/ETH ($0.002 USDC). Use for diversification or hedging decisions among these three. |
| `get_gas_prices` | $0.002 | Gas prices on Base and Ethereum with USD cost estimates, plus Solana priority fees ($0.002 USDC). Use before sending a transaction, to estimate its cost or to pick a chain. |
| `get_base_activity` | $0.003 | Base network activity: latest block, transactions per second, block gas use ($0.003 USDC). Use to check whether Base is congested before sending. |
| `get_defi_yields` | $0.003 | Top DeFi yields across protocols such as Aave, Compound, Morpho and Pendle, from DefiLlama ($0.003 USDC). Use to compare where stablecoins or majors earn yield. Not a risk assessment of those protocols. |
| `get_arbitrage_opportunities` | $0.005 | Current price spreads above 0.05% for majors between MEXC, Binance, Bybit and OKX ($0.005 USDC). Use to spot cross-exchange dislocations. Spreads are before fees and transfer time. For their history use get_arbitrage_spread_history. |
| `get_dex_vs_cex` | $0.005 | On-chain price (WBTC, WETH, wSOL via DefiLlama) against MEXC spot for BTC, ETH and SOL, with spread, age of the on-chain price and confidence ($0.005 USDC). Use to check that on-chain and exchange prices agree before trading on-chain. |
| `get_technical_indicators` | $0.003 | RSI, MACD, Bollinger Bands and ATR for a trading pair ($0.003 USDC). Parameters: symbol (default BTCUSDT), interval (default 1h). Use when a strategy needs standard indicators. Not scored as a forecast. |
| `get_support_resistance` | $0.005 | Support and resistance levels from fractal analysis on 4h candles ($0.005 USDC). Parameter: symbol (default BTCUSDT). Use to place entries, stops or targets around recent structure. Not scored as a forecast. |
| `get_sentiment` | $0.002 | Market sentiment: Fear & Greed, a funding-derived component and a composite of both ($0.002 USDC). Use for the mood of the crowd right now. So far the funding term has stayed neutral, so the composite has been Fear & Greed rescaled. Each response carries the scored record of its 24h calls. |
| `get_stablecoin_health` | $0.002 | Peg check for USDC and DAI plus the ten largest stablecoins by market cap ($0.002 USDC). Use before holding or routing funds through a stablecoin, or when a depeg is rumoured. |
| `get_historical` | $0.010 | Historical OHLCV candles for a trading pair ($0.010 USDC). Parameters: symbol (default BTCUSDT), interval 1m to 1d, limit up to 500. Use for backtests or charts. Not for derived signals (get_signal_history_7d). |
<!-- tools:end -->
Every tool carries MCP annotations: the five free tools are `readOnlyHint: true`; paid tools are deliberately not read-only and not idempotent, because with a buyer key each call pays again. Clients that ask before non-read-only calls will therefore ask before every payment.

Paid answers come with a signed receipt (EIP-191 over the SHA-256 of the answer, bound to the payment authorization's nonce), appended to the tool result; check it free at `/receipts/verify` or offline against the signer in `/.well-known/agentdata-receipts.json`. `watch_condition` can wake an agent by signed webhook or ntfy push, including on a wallet's lending health (`signal=wallet-health`).

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
- **[ClawHub skill `agentdata`](https://clawhub.ai/speteai/agentdata)** — OpenClaw skill
- **Live service:** https://agentdata-api.com
- **Admin dashboard:** https://agentdata-api.com/admin

## Keywords

Model Context Protocol, MCP server, Claude Desktop MCP, Cursor MCP, crypto market data MCP, x402 MCP, AI agent tools, agentic payments, USDC micropayments, Base Mainnet API, DeFi data for AI, crypto tools for LLM, autonomous agent data, agent economy, DeFAI

## License

MIT — see [LICENSE](LICENSE).
