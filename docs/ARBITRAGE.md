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
