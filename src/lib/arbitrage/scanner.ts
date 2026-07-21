// Cross-exchange arbitrage scanner: fetch tickers from all selected
// exchanges, group comparable markets, and rank buy-low/sell-high spreads.

import { ADAPTERS, ALL_EXCHANGES, TAKER_FEES } from './exchanges';
import { recordCacheHit, recordFailure, recordSuccess } from './sources';
import type {
  ArbitrageOpportunity,
  ExchangeId,
  NormalizedTicker,
  OpportunityLeg,
  QuoteBucket,
  ScanOptions,
  ScanResult,
} from './types';

// Quotes that are close enough to 1 USD to compare against each other.
// The actual quote currency of each leg is still shown in the result.
const USD_LIKE = new Set(['USD', 'USDT', 'USDC', 'TUSD', 'FDUSD']);

export function quoteBucketOf(quote: string): QuoteBucket | null {
  if (USD_LIKE.has(quote)) return 'USD';
  if (quote === 'EUR') return 'EUR';
  if (quote === 'BTC') return 'BTC';
  if (quote === 'ETH') return 'ETH';
  return null;
}

// ---------------------------------------------------------------------------
// Per-exchange cache so UI auto-refresh doesn't hammer the public APIs.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  fetchedAt: number;
  tickers: NormalizedTicker[];
}

const cache = new Map<ExchangeId, CacheEntry>();

async function getTickers(
  exchange: ExchangeId
): Promise<{ tickers: NormalizedTicker[] } | { error: string }> {
  const cached = cache.get(exchange);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    // Cache-Treffer: kein Netzwerkaufruf, Health-Zustand bleibt vom letzten
    // echten Fetch erhalten — nur Prüfzeitpunkt aktualisieren.
    recordCacheHit(exchange);
    return { tickers: cached.tickers };
  }
  const startedAt = Date.now();
  try {
    const tickers = await ADAPTERS[exchange]();
    cache.set(exchange, { fetchedAt: Date.now(), tickers });
    recordSuccess(exchange, Date.now() - startedAt, tickers.length);
    return { tickers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Serve stale data (up to 2 min) rather than dropping the exchange
    if (cached && Date.now() - cached.fetchedAt < 120_000) {
      recordFailure(exchange, message, true);
      return { tickers: cached.tickers };
    }
    recordFailure(exchange, message, false);
    return { error: message };
  }
}

/** Public tickers for one exchange, served from the shared 15s cache. */
export async function getCachedTickers(exchange: ExchangeId): Promise<NormalizedTicker[]> {
  const result = await getTickers(exchange);
  if ('error' in result) throw new Error(result.error);
  return result.tickers;
}

// ---------------------------------------------------------------------------
// Opportunity computation (pure, unit-testable)
// ---------------------------------------------------------------------------
export function computeOpportunities(
  tickers: NormalizedTicker[],
  options: Required<Pick<ScanOptions, 'minSpreadPct' | 'maxSpreadPct' | 'minVolume' | 'limit'>> & {
    quoteBucket?: QuoteBucket;
  }
): ArbitrageOpportunity[] {
  // Group by base asset + quote bucket; keep best market per exchange
  const groups = new Map<string, Map<ExchangeId, NormalizedTicker & { bucket: QuoteBucket }>>();

  for (const t of tickers) {
    const bucket = quoteBucketOf(t.quote);
    if (!bucket) continue;
    if (options.quoteBucket && bucket !== options.quoteBucket) continue;
    if (t.quoteVolume24h < options.minVolume) continue;
    if (t.bid > t.ask) continue; // crossed book = stale data

    const key = `${t.base}|${bucket}`;
    let group = groups.get(key);
    if (!group) {
      group = new Map();
      groups.set(key, group);
    }
    // If an exchange lists several markets in the same bucket (BTC/USDT and
    // BTC/USDC), keep the more liquid one.
    const existing = group.get(t.exchange);
    if (!existing || t.quoteVolume24h > existing.quoteVolume24h) {
      group.set(t.exchange, { ...t, bucket });
    }
  }

  const opportunities: ArbitrageOpportunity[] = [];

  for (const [key, group] of Array.from(groups.entries())) {
    if (group.size < 2) continue;
    const [base, bucket] = key.split('|') as [string, QuoteBucket];

    const legs: (OpportunityLeg & { bid: number; ask: number })[] = [];
    for (const t of Array.from(group.values())) {
      legs.push({
        exchange: t.exchange,
        quote: t.quote,
        price: t.ask,
        bid: t.bid,
        ask: t.ask,
        quoteVolume24h: t.quoteVolume24h,
        takerFee: TAKER_FEES[t.exchange],
      });
    }

    let buyLeg = legs[0];
    let sellLeg = legs[0];
    for (const leg of legs) {
      if (leg.ask < buyLeg.ask) buyLeg = leg;
      if (leg.bid > sellLeg.bid) sellLeg = leg;
    }
    if (buyLeg.exchange === sellLeg.exchange) continue;

    const grossSpreadPct = ((sellLeg.bid - buyLeg.ask) / buyLeg.ask) * 100;
    const netSpreadPct = grossSpreadPct - (buyLeg.takerFee + sellLeg.takerFee) * 100;

    if (netSpreadPct < options.minSpreadPct) continue;
    // Huge spreads are almost always delisted/halted markets or a different
    // asset sharing the same symbol — drop them instead of showing noise.
    if (grossSpreadPct > options.maxSpreadPct) continue;

    opportunities.push({
      base,
      quoteBucket: bucket,
      buy: {
        exchange: buyLeg.exchange,
        quote: buyLeg.quote,
        price: buyLeg.ask,
        quoteVolume24h: buyLeg.quoteVolume24h,
        takerFee: buyLeg.takerFee,
      },
      sell: {
        exchange: sellLeg.exchange,
        quote: sellLeg.quote,
        price: sellLeg.bid,
        quoteVolume24h: sellLeg.quoteVolume24h,
        takerFee: sellLeg.takerFee,
      },
      grossSpreadPct,
      netSpreadPct,
      exchangeCount: group.size,
      allQuotes: legs
        .slice()
        .sort((a, b) => a.ask - b.ask)
        .map(({ exchange, quote, ask, quoteVolume24h, takerFee }) => ({
          exchange,
          quote,
          price: ask,
          quoteVolume24h,
          takerFee,
        })),
    });
  }

  opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
  return opportunities.slice(0, options.limit);
}

// ---------------------------------------------------------------------------
// Full scan
// ---------------------------------------------------------------------------
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
  const exchanges = options.exchanges?.length ? options.exchanges : ALL_EXCHANGES;
  const minSpreadPct = options.minSpreadPct ?? 0.3;
  const maxSpreadPct = options.maxSpreadPct ?? 20;
  const minVolume = options.minVolume ?? 50_000;
  const limit = options.limit ?? 100;

  const results = await Promise.all(exchanges.map((ex) => getTickers(ex)));

  const errors: Partial<Record<ExchangeId, string>> = {};
  const tickers: NormalizedTicker[] = [];
  results.forEach((r, i) => {
    if ('error' in r) {
      errors[exchanges[i]] = r.error;
    } else {
      tickers.push(...r.tickers);
    }
  });

  const opportunities = computeOpportunities(tickers, {
    quoteBucket: options.quoteBucket,
    minSpreadPct,
    maxSpreadPct,
    minVolume,
    limit,
  });

  return {
    scannedAt: new Date().toISOString(),
    exchanges,
    errors,
    tickerCount: tickers.length,
    opportunities,
  };
}

/**
 * Alle Quellen anstoßen, damit das Feed-Health-Board auch ohne laufenden Scan
 * aktuelle Werte hat. Nutzt denselben 15s-Cache wie `scan`, ist also günstig,
 * und aktualisiert den Health-Zustand als Seiteneffekt von `getTickers`.
 */
export async function probeSources(exchanges: ExchangeId[] = ALL_EXCHANGES): Promise<void> {
  await Promise.all(exchanges.map((ex) => getTickers(ex)));
}
