// Offline unit test for the arbitrage scanner logic (no network needed).
// Run with: npx tsx scripts/test-arbitrage.ts

import { computeOpportunities, quoteBucketOf } from '../src/lib/arbitrage/scanner';
import type { NormalizedTicker } from '../src/lib/arbitrage/types';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  ✗ ${message}`);
  }
}

const defaults = { minSpreadPct: 0.3, maxSpreadPct: 20, minVolume: 50_000, limit: 100 };

function ticker(partial: Partial<NormalizedTicker> & Pick<NormalizedTicker, 'exchange' | 'base' | 'bid' | 'ask'>): NormalizedTicker {
  return { quote: 'USDT', quoteVolume24h: 1_000_000, ...partial };
}

console.log('quoteBucketOf');
assert(quoteBucketOf('USDT') === 'USD', 'USDT maps to USD bucket');
assert(quoteBucketOf('USD') === 'USD', 'USD maps to USD bucket');
assert(quoteBucketOf('EUR') === 'EUR', 'EUR maps to EUR bucket');
assert(quoteBucketOf('TRY') === null, 'unsupported quote is dropped');

console.log('basic spread detection');
{
  const opps = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'BTC', bid: 100_000, ask: 100_010 }),
      ticker({ exchange: 'kraken', base: 'BTC', bid: 101_500, ask: 101_520, quote: 'USD' }),
    ],
    defaults
  );
  assert(opps.length === 1, 'one opportunity found');
  const o = opps[0];
  assert(o.buy.exchange === 'binance' && o.sell.exchange === 'kraken', 'buy binance, sell kraken');
  const expectedGross = ((101_500 - 100_010) / 100_010) * 100;
  assert(Math.abs(o.grossSpreadPct - expectedGross) < 1e-9, 'gross spread correct');
  assert(o.netSpreadPct < o.grossSpreadPct, 'net spread is below gross (fees subtracted)');
  assert(o.quoteBucket === 'USD', 'USDT and USD compared in the USD bucket');
}

console.log('filters');
{
  // Spread below threshold
  const small = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'ETH', bid: 5000, ask: 5001 }),
      ticker({ exchange: 'okx', base: 'ETH', bid: 5003, ask: 5004 }),
    ],
    defaults
  );
  assert(small.length === 0, 'sub-threshold spread filtered out');

  // Absurd spread (stale/halted market)
  const bogus = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'XYZ', bid: 1.0, ask: 1.01 }),
      ticker({ exchange: 'gateio', base: 'XYZ', bid: 2.0, ask: 2.01 }),
    ],
    defaults
  );
  assert(bogus.length === 0, 'spread above maxSpreadPct dropped as stale');

  // Illiquid market
  const illiquid = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'ABC', bid: 10, ask: 10.01 }),
      ticker({ exchange: 'mexc', base: 'ABC', bid: 10.5, ask: 10.51, quoteVolume24h: 100 }),
    ],
    defaults
  );
  assert(illiquid.length === 0, 'low-volume leg filtered out');

  // Crossed book = stale data
  const crossed = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'DEF', bid: 11, ask: 10 }),
      ticker({ exchange: 'okx', base: 'DEF', bid: 10.2, ask: 10.21 }),
    ],
    defaults
  );
  assert(crossed.length === 0, 'crossed book ignored');
}

console.log('grouping rules');
{
  // Same exchange best bid AND best ask → no opportunity
  const sameEx = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'SOL', bid: 210, ask: 200 * 1.001 }),
      ticker({ exchange: 'binance', base: 'SOL', bid: 209, ask: 209.1, quote: 'USDC' }),
    ],
    defaults
  );
  assert(sameEx.length === 0, 'needs two different exchanges');

  // Duplicate markets on one exchange: more liquid one wins
  const dup = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'ADA', bid: 1.0, ask: 1.001, quoteVolume24h: 5_000_000 }),
      ticker({ exchange: 'binance', base: 'ADA', bid: 1.05, ask: 1.06, quote: 'USDC', quoteVolume24h: 60_000 }),
      ticker({ exchange: 'kraken', base: 'ADA', bid: 1.02, ask: 1.021, quote: 'USD' }),
    ],
    defaults
  );
  assert(dup.length === 1 && dup[0].buy.quote === 'USDT', 'more liquid market preferred per exchange');

  // Quote bucket filter
  const eurOnly = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'BTC', bid: 100_000, ask: 100_010 }),
      ticker({ exchange: 'kraken', base: 'BTC', bid: 101_500, ask: 101_520, quote: 'USD' }),
      ticker({ exchange: 'kraken', base: 'BTC', bid: 95_000, ask: 95_010, quote: 'EUR' }),
      ticker({ exchange: 'bitfinex', base: 'BTC', bid: 96_000, ask: 96_010, quote: 'EUR' }),
    ],
    { ...defaults, quoteBucket: 'EUR' }
  );
  assert(eurOnly.length === 1 && eurOnly[0].quoteBucket === 'EUR', 'quote bucket filter works');
}

console.log('sorting & limit');
{
  const opps = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'AAA', bid: 10, ask: 10.01 }),
      ticker({ exchange: 'okx', base: 'AAA', bid: 10.2, ask: 10.21 }),
      ticker({ exchange: 'binance', base: 'BBB', bid: 10, ask: 10.01 }),
      ticker({ exchange: 'okx', base: 'BBB', bid: 10.9, ask: 10.91 }),
    ],
    defaults
  );
  assert(opps.length === 2 && opps[0].base === 'BBB', 'sorted by net spread descending');

  const limited = computeOpportunities(
    [
      ticker({ exchange: 'binance', base: 'AAA', bid: 10, ask: 10.01 }),
      ticker({ exchange: 'okx', base: 'AAA', bid: 10.2, ask: 10.21 }),
      ticker({ exchange: 'binance', base: 'BBB', bid: 10, ask: 10.01 }),
      ticker({ exchange: 'okx', base: 'BBB', bid: 10.9, ask: 10.91 }),
    ],
    { ...defaults, limit: 1 }
  );
  assert(limited.length === 1, 'limit respected');
}

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll tests passed ✓');
