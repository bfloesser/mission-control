# Arbitrage Scanner

Cross-exchange spot arbitrage scanner: compares live prices for the same coin
across up to 10 exchanges and lists where the buy-low / sell-high spread is
largest.

**UI:** `/arbitrage` (link via the ⇄ icon in the header)
**API:** `GET /api/arbitrage`

## Supported exchanges

Binance, Kraken, KuCoin, OKX, Bybit, Gate.io, Bitget, MEXC, Crypto.com,
Bitfinex.

All data comes from each exchange's **public** ticker endpoint — no API keys
required. One HTTP request per exchange per scan; responses are cached
server-side for 15 seconds.

> Coinbase is not included because its public API has no bulk ticker endpoint
> (one request per product would be needed).

## How it works

1. Fetch the full spot ticker list from every selected exchange in parallel.
2. Normalize symbols (Kraken `XBT` → `BTC`, Bitfinex `UST` → `USDT`, etc.)
   and group markets by base asset and quote bucket. USD-like quotes
   (`USD`, `USDT`, `USDC`, `TUSD`, `FDUSD`) share one bucket; `EUR`, `BTC`
   and `ETH` are separate buckets.
3. For each coin, find the lowest ask (buy side) and highest bid (sell side)
   on two different exchanges.
4. Report the gross spread and a net spread after subtracting both exchanges'
   base-tier taker fees.

### Noise filters

- **Min volume** (default 50 000 quote units / 24h on both legs) — filters
  illiquid markets where the spread is not tradable.
- **Max spread** (default 20 %) — spreads above this are almost always
  halted/delisted markets or a different asset sharing the ticker symbol,
  so they are dropped.
- Crossed books (bid > ask) are ignored as stale data.

## API

```
GET /api/arbitrage?exchanges=binance,kraken,okx&quote=USD&minSpread=0.5&minVolume=100000&limit=50
```

| Param       | Default | Description                                        |
| ----------- | ------- | -------------------------------------------------- |
| `exchanges` | all     | Comma-separated exchange ids                        |
| `quote`     | all     | `USD` \| `EUR` \| `BTC` \| `ETH`                    |
| `minSpread` | `0.3`   | Minimum **net** spread in %                         |
| `maxSpread` | `20`    | Drop spreads above this % as stale data             |
| `minVolume` | `50000` | Minimum 24h quote volume on both legs               |
| `limit`     | `100`   | Max results                                         |

The response includes `errors` (exchanges that failed to respond) and
`tickerCount` so partial results are visible.

## Limitations — read before trading

The net spread only subtracts **taker fees**. It does **not** include:

- **Withdrawal / network fees** — often the deciding factor for small trades.
- **Transfer time** — spreads can vanish while a coin is in transit. (Holding
  balances on both exchanges and rebalancing later avoids this.)
- **Slippage** — top-of-book prices only; large orders move the price.
- **Suspended wallets** — a persistently large spread usually means deposits
  or withdrawals for that coin are halted on one of the exchanges. Always
  check wallet status before trading.
- Taker fees are base tiers without discounts; adjust `TAKER_FEES` in
  `src/lib/arbitrage/exchanges.ts` to your personal tiers.

## Tests

Offline unit tests for the scanner logic (no network needed):

```
npx tsx scripts/test-arbitrage.ts
```

---

# Trade Execution (One-Click Arbitrage)

Beyond scanning, the dashboard can **execute** an arbitrage trade end to end:
market-buy on the cheap exchange → withdraw to the expensive exchange →
wait for the deposit → market-sell. Progress, fees and realized profit are
tracked live in the UI.

## Setup

1. Open `/arbitrage/keys` (or the "API-Keys" button on the scanner page).
2. Store an API key per exchange. Keys need **trade + withdraw** permissions.
   OKX, KuCoin and Bitget additionally require the API passphrase.
3. Use the "Testen" button — it fetches your balance to verify the key works.

**Key security**

- Keys are encrypted at rest (AES-256-GCM). The encryption key comes from the
  `ARB_ENCRYPTION_KEY` env var (64 hex chars) or is auto-generated into
  `.arb-secret` (gitignored, chmod 600).
- Withdrawal permission is dangerous. Restrict the API key to this server's
  IP, enable address-whitelisting where the exchange supports it, and set
  `MC_API_TOKEN` so the dashboard API itself requires auth.

## Executing a trade

Each scanner row has a **Trade** button. It opens a modal where you:

1. Choose the spend amount (in the buy-side quote currency).
2. Get a **live preview**: current ask/bid, the transfer network that is
   actually open on both sides (cheapest withdrawal fee wins), all three fee
   components (buy taker, network/withdrawal, sell taker) and the expected
   profit in currency and %.
3. Confirm the risk checkbox and execute.

The trade then runs as a persisted state machine
(`buy → withdraw → wait_deposit → sell → done`), advanced by API polling and
a background loop (deposit detection via balance delta, 4h timeout → `stuck`).
Every step is logged; the trades panel shows bought/sent/arrived/sold amounts,
all fees actually paid, and the realized profit once the sell fills.

If a step fails mid-way (e.g. withdrawal rejected), the trade is marked
`failed` with a log entry stating **where your coins are** so you can finish
manually. A process crash during the buy step marks the trade `stuck` instead
of blindly retrying the market order.

## API

```
GET    /api/arbitrage/keys              # configured exchanges (masked)
POST   /api/arbitrage/keys              # { exchange, apiKey, secret, password? }
DELETE /api/arbitrage/keys?exchange=…
POST   /api/arbitrage/keys/test         # { exchange } → balance check
POST   /api/arbitrage/preview           # { base, buyExchange, sellExchange, buyQuote, sellQuote, spendAmount }
GET    /api/arbitrage/trades            # list + advance running trades
POST   /api/arbitrage/trades            # execute (re-previews at fresh prices first)
GET    /api/arbitrage/trades/[id]
```

## Execution risks — read this

- **Price risk during transfer**: the spread can vanish (or invert) while the
  coin is on-chain. Fast/cheap networks (e.g. TRC20, SOL) reduce this window.
- **First withdrawal to a new address** often triggers extra confirmation
  steps (email/2FA) or 24h holds on some exchanges — the trade will sit in
  `wait_deposit` until you approve it or it times out as `stuck`.
- **Market orders** pay the spread and slippage on both legs.
- Start with a **small test amount** to verify the whole path end to end.

Tests: `npx tsx scripts/test-arbitrage-execution.ts` (network selection, fee
math, encryption roundtrip — offline).
