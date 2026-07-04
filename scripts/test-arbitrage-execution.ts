// Offline unit tests for trade-execution helpers (no network, no ccxt calls).
// Run with: npx tsx scripts/test-arbitrage-execution.ts

import {
  extractOrderResult,
  floorAmount,
  netBaseAfterBuy,
  pickNetwork,
  quoteReceived,
  quoteSpent,
} from '../src/lib/arbitrage/execution-helpers';
import { encrypt, decrypt } from '../src/lib/arbitrage/crypto';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('pickNetwork');
{
  const picked = pickNetwork(
    [
      { network: 'ERC20', withdrawEnabled: true, depositEnabled: true, fee: 5 },
      { network: 'TRC20', withdrawEnabled: true, depositEnabled: true, fee: 1 },
      { network: 'BEP20', withdrawEnabled: false, depositEnabled: true, fee: 0.1 },
    ],
    [
      { network: 'ERC20', withdrawEnabled: true, depositEnabled: true },
      { network: 'TRC20', withdrawEnabled: false, depositEnabled: true },
    ]
  );
  assert(picked?.network === 'TRC20', 'cheapest common network wins (withdraw+deposit open)');

  const none = pickNetwork(
    [{ network: 'SOL', withdrawEnabled: true, depositEnabled: true, fee: 0.01 }],
    [{ network: 'ERC20', withdrawEnabled: true, depositEnabled: true }]
  );
  assert(none === null, 'no common network → null');

  const depositClosed = pickNetwork(
    [{ network: 'ERC20', withdrawEnabled: true, depositEnabled: true, fee: 5 }],
    [{ network: 'ERC20', withdrawEnabled: true, depositEnabled: false }]
  );
  assert(depositClosed === null, 'deposit-closed network rejected');

  const unknownFee = pickNetwork(
    [
      { network: 'A', withdrawEnabled: true, depositEnabled: true },
      { network: 'B', withdrawEnabled: true, depositEnabled: true, fee: 2 },
    ],
    [
      { network: 'A', withdrawEnabled: true, depositEnabled: true },
      { network: 'B', withdrawEnabled: true, depositEnabled: true },
    ]
  );
  assert(unknownFee?.network === 'B', 'known fee preferred over unknown fee');
}

console.log('order result extraction');
{
  // Binance-style buy: fee charged in the bought coin
  const buy = extractOrderResult({
    filled: 0.5,
    average: 100_000,
    cost: 50_000,
    fee: { currency: 'BTC', cost: 0.0005 },
  });
  assert(netBaseAfterBuy(buy, 'BTC') === 0.4995, 'base fee subtracted from bought qty');
  assert(quoteSpent(buy, 'USDT') === 50_000, 'no quote fee → spent equals cost');

  // Kraken-style: fee charged in quote
  const buy2 = extractOrderResult({
    filled: 0.5,
    average: 100_000,
    cost: 50_000,
    fees: [{ currency: 'USD', cost: 130 }],
  });
  assert(netBaseAfterBuy(buy2, 'BTC') === 0.5, 'quote fee does not reduce base qty');
  assert(quoteSpent(buy2, 'USD') === 50_130, 'quote fee added to spent');

  const sell = extractOrderResult({
    filled: 0.4995,
    average: 101_000,
    cost: 50_449.5,
    fee: { currency: 'USDT', cost: 50.45 },
  });
  assert(Math.abs(quoteReceived(sell, 'USDT') - 50_399.05) < 1e-6, 'sell fee subtracted from proceeds');

  // Missing fields tolerated
  const sparse = extractOrderResult({ amount: 1, price: 10 });
  assert(sparse.filled === 1 && sparse.cost === 10, 'falls back to amount/price when unfilled fields missing');
}

console.log('floorAmount');
{
  assert(floorAmount(1.999999999) === 1.99999999, 'floors to 8 decimals, never rounds up');
  assert(floorAmount(0.1 + 0.2, 2) === 0.3, 'handles float noise');
}

console.log('credential encryption roundtrip');
{
  const secret = 'my-api-secret-42/=+';
  const encrypted = encrypt(secret);
  assert(encrypted !== secret && encrypted.split('.').length === 3, 'ciphertext format iv.data.tag');
  assert(decrypt(encrypted) === secret, 'decrypt(encrypt(x)) === x');
  assert(encrypt(secret) !== encrypted, 'random IV → different ciphertext each time');
}

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll tests passed ✓');
