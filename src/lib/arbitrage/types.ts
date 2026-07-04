// Types for the multi-exchange arbitrage scanner

export type ExchangeId =
  | 'binance'
  | 'kraken'
  | 'kucoin'
  | 'okx'
  | 'bybit'
  | 'gateio'
  | 'bitget'
  | 'mexc'
  | 'cryptocom'
  | 'bitfinex';

/** A normalized order-book top-of-book snapshot for one market on one exchange. */
export interface NormalizedTicker {
  exchange: ExchangeId;
  /** Base asset, normalized (e.g. BTC, not XBT) */
  base: string;
  /** Quote asset, normalized (e.g. USDT, USD, EUR) */
  quote: string;
  /** Best bid price (what you get when selling) */
  bid: number;
  /** Best ask price (what you pay when buying) */
  ask: number;
  /** 24h volume in quote currency (approximation of liquidity) */
  quoteVolume24h: number;
}

/** Quote-currency bucket used to group comparable markets. */
export type QuoteBucket = 'USD' | 'EUR' | 'BTC' | 'ETH';

export interface OpportunityLeg {
  exchange: ExchangeId;
  /** Actual quote currency of this market (USDT vs USD etc.) */
  quote: string;
  price: number;
  quoteVolume24h: number;
  /** Taker fee assumed for this exchange (fraction, e.g. 0.001 = 0.1%) */
  takerFee: number;
}

export interface ArbitrageOpportunity {
  base: string;
  quoteBucket: QuoteBucket;
  /** Where to buy (lowest ask) */
  buy: OpportunityLeg;
  /** Where to sell (highest bid) */
  sell: OpportunityLeg;
  /** Raw price difference in percent: (bid - ask) / ask * 100 */
  grossSpreadPct: number;
  /** Spread after subtracting both taker fees (transfer fees NOT included) */
  netSpreadPct: number;
  /** Number of exchanges quoting this asset in this bucket */
  exchangeCount: number;
  /** All quotes for the detail view, sorted by ask */
  allQuotes: OpportunityLeg[];
}

export interface ScanResult {
  scannedAt: string;
  exchanges: ExchangeId[];
  /** Exchanges that failed to respond, with the error message */
  errors: Partial<Record<ExchangeId, string>>;
  tickerCount: number;
  opportunities: ArbitrageOpportunity[];
}

export interface ScanOptions {
  exchanges?: ExchangeId[];
  quoteBucket?: QuoteBucket;
  /** Minimum net spread in percent (default 0.3) */
  minSpreadPct?: number;
  /** Spreads above this are treated as stale/bogus data and dropped (default 20) */
  maxSpreadPct?: number;
  /** Minimum 24h quote volume on BOTH legs, in quote units (default 50000) */
  minVolume?: number;
  /** Max number of opportunities returned (default 100) */
  limit?: number;
}
