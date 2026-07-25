// USD valuation of exchange balances.
//
// Prices come from the exchanges' public tickers (shared 15s cache) — the
// exchange's own market first, any other configured exchange as fallback,
// and BTC/ETH chaining for assets that only trade against those.

import { listCredentials } from './credentials';
import { getAuthedClient } from './clients';
import { getCachedTickers } from './scanner';
import type { ExchangeId, NormalizedTicker } from './types';

const USD_LIKE = new Set(['USD', 'USDT', 'USDC', 'TUSD', 'FDUSD', 'BUSD', 'DAI']);

/** base → USD price map built from a set of tickers (pure, unit-testable). */
export function buildPriceMap(tickers: NormalizedTicker[]): Map<string, number> {
  const direct = new Map<string, number>();
  const viaBtc = new Map<string, number>();
  const viaEth = new Map<string, number>();

  for (const t of tickers) {
    const mid = (t.bid + t.ask) / 2;
    if (mid <= 0) continue;
    if (USD_LIKE.has(t.quote)) {
      if (!direct.has(t.base)) direct.set(t.base, mid);
    } else if (t.quote === 'BTC') {
      if (!viaBtc.has(t.base)) viaBtc.set(t.base, mid);
    } else if (t.quote === 'ETH') {
      if (!viaEth.has(t.base)) viaEth.set(t.base, mid);
    }
  }

  const map = new Map<string, number>(direct);
  for (const stable of Array.from(USD_LIKE)) map.set(stable, 1);

  const btcUsd = map.get('BTC');
  if (btcUsd) {
    for (const [base, price] of Array.from(viaBtc.entries())) {
      if (!map.has(base)) map.set(base, price * btcUsd);
    }
  }
  const ethUsd = map.get('ETH');
  if (ethUsd) {
    for (const [base, price] of Array.from(viaEth.entries())) {
      if (!map.has(base)) map.set(base, price * ethUsd);
    }
  }
  return map;
}

export interface ValuedAsset {
  currency: string;
  amount: number;
  /** null = no USD price found for this asset */
  usdValue: number | null;
}

/** Value raw balance totals with a price map (pure, unit-testable). */
export function valueAssets(
  totals: Record<string, number>,
  prices: Map<string, number>
): { totalUsd: number; assets: ValuedAsset[] } {
  const assets: ValuedAsset[] = [];
  let totalUsd = 0;
  for (const [currency, amount] of Object.entries(totals)) {
    if (!(amount > 0)) continue;
    const price = prices.get(currency);
    const usdValue = price !== undefined ? amount * price : null;
    if (usdValue !== null) totalUsd += usdValue;
    assets.push({ currency, amount, usdValue });
  }
  // Ignore dust below one cent so the list stays readable
  const filtered = assets.filter((a) => a.usdValue === null || a.usdValue >= 0.01);
  filtered.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
  return { totalUsd, assets: filtered };
}

export interface ExchangeBalance {
  exchange: ExchangeId;
  totalUsd: number | null;
  assets: ValuedAsset[];
  error?: string;
}

/** Fetch and USD-value the balances of all exchanges with stored API keys. */
export async function getValuedBalances(): Promise<ExchangeBalance[]> {
  const configured = listCredentials().map((c) => c.exchange as ExchangeId);
  if (configured.length === 0) return [];

  // Balances (authed) and price tickers (public) in parallel per exchange
  const [balanceResults, tickerResults] = await Promise.all([
    Promise.all(
      configured.map(async (exchange) => {
        try {
          const client = getAuthedClient(exchange);
          const balance = await client.fetchBalance();
          return { exchange, totals: balance.total as unknown as Record<string, number> };
        } catch (error) {
          return {
            exchange,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    ),
    Promise.all(
      configured.map(async (exchange) => {
        try {
          return await getCachedTickers(exchange);
        } catch {
          return [] as NormalizedTicker[];
        }
      })
    ),
  ]);

  // Global fallback map across all exchanges; per-exchange map preferred
  const allTickers = tickerResults.flat();
  const globalPrices = buildPriceMap(allTickers);

  return balanceResults.map((result, i) => {
    if ('error' in result && result.error) {
      return { exchange: result.exchange, totalUsd: null, assets: [], error: result.error };
    }
    const totals = (result as { totals: Record<string, number> }).totals ?? {};
    const localPrices = buildPriceMap(tickerResults[i]);
    // local prices win, global fills the gaps
    const merged = new Map(globalPrices);
    for (const [k, v] of Array.from(localPrices.entries())) merged.set(k, v);
    const { totalUsd, assets } = valueAssets(totals, merged);
    return { exchange: result.exchange, totalUsd, assets };
  });
}
