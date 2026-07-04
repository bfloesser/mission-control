// Trade execution state machine.
//
// A trade moves through: created → buy → withdraw → wait_deposit → sell → done.
// Each transition is persisted to SQLite, so progress survives restarts.
// advanceTrade() is idempotent and re-entrant-safe (in-memory lock): it is
// called after creation, from API polling, and from a background interval —
// whichever comes first moves the trade forward.

import { v4 as uuidv4 } from 'uuid';
import type { Exchange, Order } from 'ccxt';
import { queryAll, queryOne, run } from '@/lib/db';
import { getAuthedClient, loadMarketsOnce } from './clients';
import {
  extractOrderResult,
  floorAmount,
  netBaseAfterBuy,
  quoteReceived,
  quoteSpent,
  toPaidFees,
} from './execution-helpers';
import type { ArbTrade, ArbTradeData, ExchangeId, TradePreview, TradeStep } from './types';

const DEPOSIT_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4h, then marked 'stuck'
const DEPOSIT_ARRIVAL_TOLERANCE = 0.9; // arrived if balance grew ≥90% of expected

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
interface TradeRow {
  id: string;
  status: ArbTrade['status'];
  step: TradeStep;
  base: string;
  buy_exchange: ExchangeId;
  sell_exchange: ExchangeId;
  spend_amount: number;
  data: string;
  created_at: string;
  updated_at: string;
}

function rowToTrade(row: TradeRow): ArbTrade {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    base: row.base,
    buyExchange: row.buy_exchange,
    sellExchange: row.sell_exchange,
    spendAmount: row.spend_amount,
    data: JSON.parse(row.data) as ArbTradeData,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function saveTrade(trade: ArbTrade): void {
  run(
    `UPDATE arb_trades SET status = ?, step = ?, data = ?, updated_at = datetime('now') WHERE id = ?`,
    [trade.status, trade.step, JSON.stringify(trade.data), trade.id]
  );
}

export function getTrade(id: string): ArbTrade | null {
  const row = queryOne<TradeRow>(`SELECT * FROM arb_trades WHERE id = ?`, [id]);
  return row ? rowToTrade(row) : null;
}

export function listTrades(limit = 50): ArbTrade[] {
  const rows = queryAll<TradeRow>(`SELECT * FROM arb_trades ORDER BY created_at DESC LIMIT ?`, [
    limit,
  ]);
  return rows.map(rowToTrade);
}

function log(trade: ArbTrade, message: string): void {
  trade.data.log.push({ at: new Date().toISOString(), message });
  console.log(`[arb-trade ${trade.id.slice(0, 8)}] ${message}`);
}

export function createTrade(preview: TradePreview): ArbTrade {
  const trade: ArbTrade = {
    id: uuidv4(),
    status: 'running',
    step: 'created',
    base: preview.base,
    buyExchange: preview.buyExchange,
    sellExchange: preview.sellExchange,
    spendAmount: preview.spendAmount,
    data: { preview, log: [], feesPaid: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  log(
    trade,
    `Trade angelegt: ${preview.spendAmount} ${preview.buyQuote} → ${preview.base} auf ` +
      `${preview.buyExchange} kaufen, via ${preview.network} transferieren, auf ${preview.sellExchange} verkaufen`
  );
  run(
    `INSERT INTO arb_trades (id, status, step, base, buy_exchange, sell_exchange, spend_amount, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trade.id,
      trade.status,
      trade.step,
      trade.base,
      trade.buyExchange,
      trade.sellExchange,
      trade.spendAmount,
      JSON.stringify(trade.data),
    ]
  );
  // Kick off execution without blocking the request
  void advanceTrade(trade.id);
  ensureBackgroundLoop();
  return trade;
}

// ---------------------------------------------------------------------------
// Execution steps
// ---------------------------------------------------------------------------

async function fetchOrderFinal(
  client: Exchange,
  orderId: string | undefined,
  symbol: string,
  created: Order
): Promise<Order> {
  if (!orderId) return created;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const order = await client.fetchOrder(orderId, symbol);
      if (order.status === 'closed' || (order.filled ?? 0) > 0) return order;
    } catch {
      // some exchanges can't fetch just-created market orders immediately
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return created;
}

async function stepBuy(trade: ArbTrade): Promise<void> {
  const p = trade.data.preview;
  const client = getAuthedClient(trade.buyExchange);
  await loadMarketsOnce(client);
  const symbol = `${p.base}/${p.buyQuote}`;

  log(trade, `Kaufe ${p.base} auf ${trade.buyExchange} für ${p.spendAmount} ${p.buyQuote} (Market)…`);

  let created: Order;
  if (client.has['createMarketBuyOrderWithCost']) {
    created = await client.createMarketBuyOrderWithCost(symbol, p.spendAmount);
  } else {
    const ticker = await client.fetchTicker(symbol);
    const price = ticker.ask ?? ticker.last;
    if (!price) throw new Error('Kein Kurs für Market-Buy verfügbar');
    const amount = parseFloat(client.amountToPrecision(symbol, p.spendAmount / price));
    created = await client.createOrder(symbol, 'market', 'buy', amount);
  }

  const order = await fetchOrderFinal(client, created.id, symbol, created);
  const result = extractOrderResult(order);
  if (result.filled <= 0) throw new Error('Kauforder wurde nicht ausgeführt');

  trade.data.buyOrderId = order.id;
  trade.data.boughtQty = netBaseAfterBuy(result, p.base);
  trade.data.spentQuote = quoteSpent(result, p.buyQuote);
  trade.data.buyAvgPrice = result.average;
  trade.data.feesPaid.push(...toPaidFees(result.fees, `Kaufgebühr (${trade.buyExchange})`));

  log(
    trade,
    `Gekauft: ${trade.data.boughtQty} ${p.base} @ ~${result.average} (${trade.data.spentQuote} ${p.buyQuote} ausgegeben)`
  );
}

async function stepWithdraw(trade: ArbTrade): Promise<void> {
  const p = trade.data.preview;
  const buyClient = getAuthedClient(trade.buyExchange);
  const sellClient = getAuthedClient(trade.sellExchange);
  await Promise.all([loadMarketsOnce(buyClient), loadMarketsOnce(sellClient)]);

  // Baseline balance on the sell exchange — deposit detection compares against this
  const sellBalance = await sellClient.fetchBalance();
  trade.data.sellBaselineQty = (sellBalance.free as unknown as Record<string, number>)[p.base] ?? 0;

  // Deposit address on the sell exchange
  const networkParam = p.network === 'DEFAULT' ? {} : { network: p.network };
  let address;
  try {
    address = await sellClient.fetchDepositAddress(p.base, networkParam);
  } catch (error) {
    if (sellClient.has['createDepositAddress']) {
      await sellClient.createDepositAddress(p.base, networkParam);
      address = await sellClient.fetchDepositAddress(p.base, networkParam);
    } else {
      throw error;
    }
  }
  if (!address?.address) throw new Error(`Keine Einzahlungsadresse auf ${trade.sellExchange} erhalten`);

  // Send what we bought (capped by the actually free balance)
  const buyBalance = await buyClient.fetchBalance();
  const free = (buyBalance.free as unknown as Record<string, number>)[p.base] ?? 0;
  let amount = Math.min(trade.data.boughtQty ?? 0, free);
  try {
    amount = parseFloat(buyClient.currencyToPrecision(p.base, amount));
  } catch {
    amount = floorAmount(amount);
  }
  if (amount <= 0) throw new Error(`Kein freies ${p.base}-Guthaben auf ${trade.buyExchange}`);

  log(
    trade,
    `Sende ${amount} ${p.base} via ${p.network} an ${trade.sellExchange} (${address.address.slice(0, 12)}…)`
  );

  const withdrawal = await buyClient.withdraw(
    p.base,
    amount,
    address.address,
    address.tag || undefined,
    networkParam
  );

  trade.data.withdrawalId = withdrawal.id;
  trade.data.withdrawnQty = amount;
  trade.data.waitStartedAt = new Date().toISOString();
  if (p.withdrawFee > 0) {
    trade.data.feesPaid.push({
      label: `Netzwerkgebühr (${p.network})`,
      amount: p.withdrawFee,
      currency: p.base,
    });
  }
  log(trade, `Auszahlung beauftragt (ID ${withdrawal.id ?? 'unbekannt'}). Warte auf Eingang…`);
}

/** Returns true if the deposit arrived (trade advanced), false if still waiting. */
async function stepWaitDeposit(trade: ArbTrade): Promise<boolean> {
  const p = trade.data.preview;
  const sellClient = getAuthedClient(trade.sellExchange);

  const expected = (trade.data.withdrawnQty ?? 0) - p.withdrawFee;
  const baseline = trade.data.sellBaselineQty ?? 0;

  const balance = await sellClient.fetchBalance();
  const free = (balance.free as unknown as Record<string, number>)[p.base] ?? 0;
  const grown = free - baseline;

  if (grown >= expected * DEPOSIT_ARRIVAL_TOLERANCE && grown > 0) {
    trade.data.arrivedQty = Math.min(grown, trade.data.withdrawnQty ?? grown);
    log(trade, `Eingang bestätigt: ${trade.data.arrivedQty} ${p.base} auf ${trade.sellExchange}`);
    return true;
  }

  const waitedMs = Date.now() - new Date(trade.data.waitStartedAt ?? trade.createdAt).getTime();
  if (waitedMs > DEPOSIT_TIMEOUT_MS) {
    trade.status = 'stuck';
    log(
      trade,
      `Einzahlung nach ${Math.round(waitedMs / 60000)} Minuten nicht angekommen — bitte manuell auf ` +
        `${trade.sellExchange} prüfen (Coins sind unterwegs oder die Auszahlung hängt auf ${trade.buyExchange})`
    );
  }
  return false;
}

async function stepSell(trade: ArbTrade): Promise<void> {
  const p = trade.data.preview;
  const client = getAuthedClient(trade.sellExchange);
  await loadMarketsOnce(client);
  const symbol = `${p.base}/${p.sellQuote}`;

  const balance = await client.fetchBalance();
  const free = (balance.free as unknown as Record<string, number>)[p.base] ?? 0;
  let amount = Math.min(trade.data.arrivedQty ?? 0, free);
  amount = parseFloat(client.amountToPrecision(symbol, amount));
  if (amount <= 0) throw new Error(`Kein freies ${p.base}-Guthaben auf ${trade.sellExchange}`);

  log(trade, `Verkaufe ${amount} ${p.base} auf ${trade.sellExchange} (Market)…`);
  const created = await client.createOrder(symbol, 'market', 'sell', amount);
  const order = await fetchOrderFinal(client, created.id, symbol, created);
  const result = extractOrderResult(order);
  if (result.filled <= 0) throw new Error('Verkaufsorder wurde nicht ausgeführt');

  trade.data.sellOrderId = order.id;
  trade.data.sellAvgPrice = result.average;
  trade.data.proceedsQuote = quoteReceived(result, p.sellQuote);
  trade.data.feesPaid.push(...toPaidFees(result.fees, `Verkaufsgebühr (${trade.sellExchange})`));

  const spent = trade.data.spentQuote ?? p.spendAmount;
  trade.data.profitQuote = trade.data.proceedsQuote - spent;
  trade.data.profitPct = (trade.data.profitQuote / spent) * 100;

  log(
    trade,
    `Verkauft: ${result.filled} ${p.base} @ ~${result.average} → ${trade.data.proceedsQuote} ${p.sellQuote}. ` +
      `Ergebnis: ${trade.data.profitQuote >= 0 ? '+' : ''}${trade.data.profitQuote.toFixed(2)} ${p.sellQuote} ` +
      `(${trade.data.profitPct.toFixed(2)}%)`
  );
}

// ---------------------------------------------------------------------------
// State machine driver
// ---------------------------------------------------------------------------
const processing = new Set<string>();

export async function advanceTrade(id: string): Promise<ArbTrade | null> {
  if (processing.has(id)) return getTrade(id);
  processing.add(id);
  try {
    const trade = getTrade(id);
    if (!trade || trade.status !== 'running') return trade;

    // Run as many steps as possible in one pass
    let progressed = true;
    while (progressed && trade.status === 'running') {
      progressed = false;
      try {
        switch (trade.step) {
          case 'created':
            trade.step = 'buy';
            saveTrade(trade);
            await stepBuy(trade);
            trade.step = 'withdraw';
            progressed = true;
            break;
          case 'buy':
            // interrupted mid-buy (crash): unsafe to blindly retry a market order
            trade.status = 'stuck';
            log(
              trade,
              'Prozess wurde während des Kaufs unterbrochen — bitte Order-Historie auf der Kaufbörse prüfen'
            );
            break;
          case 'withdraw':
            await stepWithdraw(trade);
            trade.step = 'wait_deposit';
            progressed = true;
            break;
          case 'wait_deposit':
            progressed = await stepWaitDeposit(trade);
            if (progressed) trade.step = 'sell';
            break;
          case 'sell':
            await stepSell(trade);
            trade.step = 'done';
            trade.status = 'done';
            break;
          case 'done':
            trade.status = 'done';
            break;
        }
      } catch (error) {
        trade.status = 'failed';
        trade.data.error = error instanceof Error ? error.message : String(error);
        log(trade, `Fehler im Schritt "${trade.step}": ${trade.data.error}`);
        if (trade.step === 'withdraw' || trade.step === 'wait_deposit') {
          log(
            trade,
            `Achtung: ${trade.base} wurde bereits gekauft und liegt auf ${trade.buyExchange} bzw. ist unterwegs — manuell weiterverfahren`
          );
        } else if (trade.step === 'sell') {
          log(trade, `Achtung: ${trade.base} liegt auf ${trade.sellExchange} und wurde noch nicht verkauft`);
        }
      }
      saveTrade(trade);
    }
    return trade;
  } finally {
    processing.delete(id);
  }
}

/** Advance all running trades (called from API polling). */
export async function advanceRunningTrades(): Promise<void> {
  const running = queryAll<TradeRow>(`SELECT * FROM arb_trades WHERE status = 'running'`);
  await Promise.all(running.map((row) => advanceTrade(row.id)));
}

// Background driver so deposits are detected even without an open browser tab.
// Global-symbol guard prevents duplicate intervals across Next.js hot reloads.
const LOOP_KEY = Symbol.for('mc.arbitrage.tradeLoop');

export function ensureBackgroundLoop(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[LOOP_KEY]) return;
  g[LOOP_KEY] = setInterval(() => {
    advanceRunningTrades().catch((error) => console.error('[arb-trade] loop error:', error));
  }, 20_000);
}
