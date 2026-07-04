// Public REST ticker adapters for 10 exchanges.
// All endpoints are public (no API keys) and return the full spot ticker
// list in a single request, so a scan costs one HTTP call per exchange.

import type { ExchangeId, NormalizedTicker } from './types';

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Base-tier taker fees per exchange (fraction). These are the published
 * default spot taker fees without discounts (no BNB/OKB/token discounts,
 * no VIP tiers). Adjust to your personal tiers via EXCHANGE_FEES if needed.
 */
export const TAKER_FEES: Record<ExchangeId, number> = {
  binance: 0.001,
  kraken: 0.004,
  kucoin: 0.001,
  okx: 0.001,
  bybit: 0.001,
  gateio: 0.002,
  bitget: 0.001,
  mexc: 0.0005,
  cryptocom: 0.0075,
  bitfinex: 0.002,
};

export const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: 'Binance',
  kraken: 'Kraken',
  kucoin: 'KuCoin',
  okx: 'OKX',
  bybit: 'Bybit',
  gateio: 'Gate.io',
  bitget: 'Bitget',
  mexc: 'MEXC',
  cryptocom: 'Crypto.com',
  bitfinex: 'Bitfinex',
};

// Quote currencies we recognize, longest first so suffix matching on
// concatenated symbols (BTCUSDT) picks USDT before USD.
const KNOWN_QUOTES = ['FDUSD', 'USDT', 'USDC', 'TUSD', 'USD', 'EUR', 'BTC', 'ETH'];

/** Split a concatenated symbol like BTCUSDT into [base, quote], or null. */
function splitConcat(symbol: string): [string, string] | null {
  for (const quote of KNOWN_QUOTES) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return [symbol.slice(0, -quote.length), quote];
    }
  }
  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

type Adapter = () => Promise<NormalizedTicker[]>;

// ---------------------------------------------------------------------------
// Binance — https://api.binance.com/api/v3/ticker/24hr
// ---------------------------------------------------------------------------
const binance: Adapter = async () => {
  const data = (await fetchJson('https://api.binance.com/api/v3/ticker/24hr')) as Array<
    Record<string, unknown>
  >;
  const out: NormalizedTicker[] = [];
  for (const t of data) {
    const parts = splitConcat(String(t.symbol));
    if (!parts) continue;
    const bid = num(t.bidPrice);
    const ask = num(t.askPrice);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'binance',
      base: parts[0],
      quote: parts[1],
      bid,
      ask,
      quoteVolume24h: num(t.quoteVolume),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Kraken — https://api.kraken.com/0/public/Ticker (no pair param = all pairs)
// Legacy asset codes: XBT→BTC, XDG→DOGE, and X/Z prefixes on old pairs.
// ---------------------------------------------------------------------------
const KRAKEN_QUOTES = ['ZUSD', 'USDT', 'USDC', 'ZEUR', 'USD', 'EUR', 'XXBT', 'XBT', 'XETH', 'ETH'];

function krakenAsset(code: string): string {
  let c = code;
  // Strip legacy X/Z prefix on 4-letter codes (XXBT, ZUSD, XETH ...)
  if (c.length === 4 && (c.startsWith('X') || c.startsWith('Z'))) c = c.slice(1);
  if (c === 'XBT') return 'BTC';
  if (c === 'XDG') return 'DOGE';
  return c;
}

const kraken: Adapter = async () => {
  const data = (await fetchJson('https://api.kraken.com/0/public/Ticker')) as {
    error: string[];
    result: Record<string, { a: string[]; b: string[]; v: string[]; c: string[] }>;
  };
  if (data.error?.length) throw new Error(data.error.join(', '));
  const out: NormalizedTicker[] = [];
  for (const [pair, t] of Object.entries(data.result)) {
    if (pair.includes('.')) continue; // dark pool / staking pairs
    let base: string | null = null;
    let quote: string | null = null;
    for (const q of KRAKEN_QUOTES) {
      if (pair.endsWith(q) && pair.length > q.length) {
        base = krakenAsset(pair.slice(0, -q.length));
        quote = krakenAsset(q);
        break;
      }
    }
    if (!base || !quote) continue;
    const bid = num(t.b?.[0]);
    const ask = num(t.a?.[0]);
    const last = num(t.c?.[0]);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'kraken',
      base,
      quote,
      bid,
      ask,
      // v[1] is 24h volume in base units → approximate quote volume via last price
      quoteVolume24h: num(t.v?.[1]) * last,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// KuCoin — https://api.kucoin.com/api/v1/market/allTickers
// ---------------------------------------------------------------------------
const kucoin: Adapter = async () => {
  const data = (await fetchJson('https://api.kucoin.com/api/v1/market/allTickers')) as {
    data: { ticker: Array<Record<string, unknown>> };
  };
  const out: NormalizedTicker[] = [];
  for (const t of data.data.ticker) {
    const [base, quote] = String(t.symbol).split('-');
    if (!base || !quote) continue;
    const bid = num(t.buy);
    const ask = num(t.sell);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'kucoin',
      base,
      quote,
      bid,
      ask,
      quoteVolume24h: num(t.volValue),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// OKX — https://www.okx.com/api/v5/market/tickers?instType=SPOT
// ---------------------------------------------------------------------------
const okx: Adapter = async () => {
  const data = (await fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT')) as {
    data: Array<Record<string, unknown>>;
  };
  const out: NormalizedTicker[] = [];
  for (const t of data.data) {
    const [base, quote] = String(t.instId).split('-');
    if (!base || !quote) continue;
    const bid = num(t.bidPx);
    const ask = num(t.askPx);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'okx',
      base,
      quote,
      bid,
      ask,
      quoteVolume24h: num(t.volCcy24h), // spot: 24h volume in quote currency
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Bybit — https://api.bybit.com/v5/market/tickers?category=spot
// ---------------------------------------------------------------------------
const bybit: Adapter = async () => {
  const data = (await fetchJson('https://api.bybit.com/v5/market/tickers?category=spot')) as {
    result: { list: Array<Record<string, unknown>> };
  };
  const out: NormalizedTicker[] = [];
  for (const t of data.result.list) {
    const parts = splitConcat(String(t.symbol));
    if (!parts) continue;
    const bid = num(t.bid1Price);
    const ask = num(t.ask1Price);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'bybit',
      base: parts[0],
      quote: parts[1],
      bid,
      ask,
      quoteVolume24h: num(t.turnover24h),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Gate.io — https://api.gateio.ws/api/v4/spot/tickers
// ---------------------------------------------------------------------------
const gateio: Adapter = async () => {
  const data = (await fetchJson('https://api.gateio.ws/api/v4/spot/tickers')) as Array<
    Record<string, unknown>
  >;
  const out: NormalizedTicker[] = [];
  for (const t of data) {
    const [base, quote] = String(t.currency_pair).split('_');
    if (!base || !quote) continue;
    const bid = num(t.highest_bid);
    const ask = num(t.lowest_ask);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'gateio',
      base,
      quote,
      bid,
      ask,
      quoteVolume24h: num(t.quote_volume),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Bitget — https://api.bitget.com/api/v2/spot/market/tickers
// ---------------------------------------------------------------------------
const bitget: Adapter = async () => {
  const data = (await fetchJson('https://api.bitget.com/api/v2/spot/market/tickers')) as {
    data: Array<Record<string, unknown>>;
  };
  const out: NormalizedTicker[] = [];
  for (const t of data.data) {
    const parts = splitConcat(String(t.symbol));
    if (!parts) continue;
    const bid = num(t.bidPr);
    const ask = num(t.askPr);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'bitget',
      base: parts[0],
      quote: parts[1],
      bid,
      ask,
      quoteVolume24h: num(t.quoteVolume),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// MEXC — https://api.mexc.com/api/v3/ticker/24hr (Binance-compatible schema)
// ---------------------------------------------------------------------------
const mexc: Adapter = async () => {
  const data = (await fetchJson('https://api.mexc.com/api/v3/ticker/24hr')) as Array<
    Record<string, unknown>
  >;
  const out: NormalizedTicker[] = [];
  for (const t of data) {
    const parts = splitConcat(String(t.symbol));
    if (!parts) continue;
    const bid = num(t.bidPrice);
    const ask = num(t.askPrice);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'mexc',
      base: parts[0],
      quote: parts[1],
      bid,
      ask,
      quoteVolume24h: num(t.quoteVolume),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Crypto.com — https://api.crypto.com/exchange/v1/public/get-tickers
// ---------------------------------------------------------------------------
const cryptocom: Adapter = async () => {
  const data = (await fetchJson('https://api.crypto.com/exchange/v1/public/get-tickers')) as {
    result: { data: Array<Record<string, unknown>> };
  };
  const out: NormalizedTicker[] = [];
  for (const t of data.result.data) {
    const [base, quote] = String(t.i).split('_');
    if (!base || !quote) continue;
    const bid = num(t.b);
    const ask = num(t.k);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'cryptocom',
      base,
      quote,
      bid,
      ask,
      quoteVolume24h: num(t.vv), // 24h volume in USD
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Bitfinex — https://api-pub.bitfinex.com/v2/tickers?symbols=ALL
// Symbols: tBTCUSD (3+3) or tDOGE:USD (colon-separated). UST = USDT there.
// ---------------------------------------------------------------------------
function bitfinexAsset(code: string): string {
  if (code === 'UST') return 'USDT';
  return code;
}

const bitfinex: Adapter = async () => {
  const data = (await fetchJson('https://api-pub.bitfinex.com/v2/tickers?symbols=ALL')) as Array<
    Array<unknown>
  >;
  const out: NormalizedTicker[] = [];
  for (const t of data) {
    const sym = String(t[0]);
    if (!sym.startsWith('t')) continue; // skip funding tickers (f...)
    const body = sym.slice(1);
    let base: string;
    let quote: string;
    if (body.includes(':')) {
      [base, quote] = body.split(':');
    } else if (body.length === 6) {
      base = body.slice(0, 3);
      quote = body.slice(3);
    } else {
      continue;
    }
    base = bitfinexAsset(base);
    quote = bitfinexAsset(quote);
    // [SYMBOL, BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_REL, LAST, VOLUME, HIGH, LOW]
    const bid = num(t[1]);
    const ask = num(t[3]);
    const last = num(t[7]);
    if (bid <= 0 || ask <= 0) continue;
    out.push({
      exchange: 'bitfinex',
      base,
      quote,
      bid,
      ask,
      quoteVolume24h: num(t[8]) * last, // volume is in base units
    });
  }
  return out;
};

export const ADAPTERS: Record<ExchangeId, Adapter> = {
  binance,
  kraken,
  kucoin,
  okx,
  bybit,
  gateio,
  bitget,
  mexc,
  cryptocom,
  bitfinex,
};

export const ALL_EXCHANGES = Object.keys(ADAPTERS) as ExchangeId[];
