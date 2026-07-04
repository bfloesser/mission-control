// Authenticated ccxt clients for trade execution.

import ccxt, { type Exchange } from 'ccxt';
import { getCredentials } from './credentials';
import type { ExchangeId } from './types';

/** Map our exchange ids to ccxt exchange ids. */
export const CCXT_IDS: Record<ExchangeId, string> = {
  binance: 'binance',
  kraken: 'kraken',
  kucoin: 'kucoin',
  okx: 'okx',
  bybit: 'bybit',
  gateio: 'gate',
  bitget: 'bitget',
  mexc: 'mexc',
  cryptocom: 'cryptocom',
  bitfinex: 'bitfinex',
};

/** Exchanges whose API requires a passphrase in addition to key + secret. */
export const NEEDS_PASSWORD: ExchangeId[] = ['okx', 'kucoin', 'bitget'];

const clientCache = new Map<string, Exchange>();

export function getAuthedClient(exchange: ExchangeId): Exchange {
  const creds = getCredentials(exchange);
  if (!creds) {
    throw new Error(`Keine API-Keys für ${exchange} hinterlegt`);
  }
  const cacheKey = `${exchange}:${creds.apiKey}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const ctor = (ccxt as unknown as Record<string, new (config: object) => Exchange>)[
    CCXT_IDS[exchange]
  ];
  if (!ctor) throw new Error(`ccxt kennt Börse ${exchange} nicht`);

  const client = new ctor({
    apiKey: creds.apiKey,
    secret: creds.secret,
    password: creds.password,
    enableRateLimit: true,
    options: { defaultType: 'spot' },
  });
  clientCache.set(cacheKey, client);
  return client;
}

/** Drop the cached client (after credentials change). */
export function invalidateClient(exchange: ExchangeId): void {
  for (const key of Array.from(clientCache.keys())) {
    if (key.startsWith(`${exchange}:`)) clientCache.delete(key);
  }
}

export async function loadMarketsOnce(client: Exchange): Promise<void> {
  if (!client.markets || Object.keys(client.markets).length === 0) {
    await client.loadMarkets();
  }
}
