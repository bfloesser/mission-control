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

// ---------------------------------------------------------------------------
// Trade execution
// ---------------------------------------------------------------------------

export type TradeStep = 'created' | 'buy' | 'withdraw' | 'wait_deposit' | 'sell' | 'done';

export type TradeStatus = 'running' | 'done' | 'failed' | 'stuck';

export interface TradeLogEntry {
  at: string;
  message: string;
}

/** Fee actually paid at one point of the trade, in a given currency. */
export interface PaidFee {
  label: string;
  amount: number;
  currency: string;
}

export interface TradePreview {
  base: string;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  buyQuote: string;
  sellQuote: string;
  /** Amount to spend, in buy-side quote currency */
  spendAmount: number;
  buyPrice: number;
  sellPrice: number;
  /** Withdrawal network chosen (common to both exchanges) */
  network: string;
  /** Withdrawal fee in base units */
  withdrawFee: number;
  estBaseQty: number;
  estArriveQty: number;
  estProceeds: number;
  estProfit: number;
  estProfitPct: number;
  fees: PaidFee[];
  warnings: string[];
}

export interface ArbTradeData {
  preview: TradePreview;
  log: TradeLogEntry[];
  error?: string;
  // Filled in as the trade progresses:
  buyOrderId?: string;
  /** Base quantity actually bought (after buy fee) */
  boughtQty?: number;
  /** Quote actually spent */
  spentQuote?: number;
  buyAvgPrice?: number;
  withdrawalId?: string;
  /** Base quantity sent (before network fee) */
  withdrawnQty?: number;
  depositTxId?: string;
  /** Base quantity that arrived on the sell exchange */
  arrivedQty?: number;
  sellOrderId?: string;
  sellAvgPrice?: number;
  /** Quote received from the sell (after sell fee) */
  proceedsQuote?: number;
  /** Sell-exchange base balance before the transfer (deposit detection baseline) */
  sellBaselineQty?: number;
  /** When the deposit wait started (for timeout) */
  waitStartedAt?: string;
  /** Realized result */
  profitQuote?: number;
  profitPct?: number;
  feesPaid: PaidFee[];
}

export interface ArbTrade {
  id: string;
  status: TradeStatus;
  step: TradeStep;
  base: string;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  spendAmount: number;
  data: ArbTradeData;
  createdAt: string;
  updatedAt: string;
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
