// Pure helpers for trade execution — no network access, unit-testable.

import type { PaidFee } from './types';

export interface NetworkInfo {
  /** Unified network code (e.g. ERC20, TRC20, SOL) */
  network: string;
  withdrawEnabled: boolean;
  depositEnabled: boolean;
  /** Withdrawal fee in base-currency units (unknown = undefined) */
  fee?: number;
}

/**
 * Pick a transfer network that allows withdrawing on the buy exchange AND
 * depositing on the sell exchange; prefer the lowest withdrawal fee.
 */
export function pickNetwork(
  buyNetworks: NetworkInfo[],
  sellNetworks: NetworkInfo[]
): NetworkInfo | null {
  const depositOk = new Set(
    sellNetworks.filter((n) => n.depositEnabled).map((n) => n.network.toUpperCase())
  );
  const candidates = buyNetworks.filter(
    (n) => n.withdrawEnabled && depositOk.has(n.network.toUpperCase())
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.fee ?? Number.MAX_VALUE) - (b.fee ?? Number.MAX_VALUE));
  return candidates[0];
}

/** Normalized result of a ccxt order after fetching its final state. */
export interface OrderResult {
  /** Base amount filled */
  filled: number;
  /** Average fill price */
  average: number;
  /** Total quote spent/received (before fees) */
  cost: number;
  /** Fees grouped by currency */
  fees: Record<string, number>;
}

/** Extract fill data from a ccxt order object (tolerates missing fields). */
export function extractOrderResult(order: {
  filled?: number;
  average?: number;
  price?: number;
  cost?: number;
  amount?: number;
  fee?: { currency?: string; cost?: number };
  fees?: Array<{ currency?: string; cost?: number }>;
}): OrderResult {
  const filled = order.filled ?? order.amount ?? 0;
  const average = order.average ?? order.price ?? 0;
  const cost = order.cost ?? filled * average;

  const fees: Record<string, number> = {};
  const feeList = order.fees?.length ? order.fees : order.fee ? [order.fee] : [];
  for (const f of feeList) {
    if (!f || !f.currency || !f.cost) continue;
    fees[f.currency] = (fees[f.currency] || 0) + f.cost;
  }
  return { filled, average, cost, fees };
}

/**
 * Base quantity actually owned after a buy: filled minus any fee charged
 * in the base currency (e.g. Binance charges the buy fee in the bought coin).
 */
export function netBaseAfterBuy(result: OrderResult, base: string): number {
  return result.filled - (result.fees[base] || 0);
}

/** Quote actually spent on a buy: cost plus any fee charged in quote. */
export function quoteSpent(result: OrderResult, quote: string): number {
  return result.cost + (result.fees[quote] || 0);
}

/** Quote actually received from a sell: cost minus any fee charged in quote. */
export function quoteReceived(result: OrderResult, quote: string): number {
  return result.cost - (result.fees[quote] || 0);
}

export function toPaidFees(fees: Record<string, number>, label: string): PaidFee[] {
  return Object.entries(fees)
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => ({ label, amount, currency }));
}

/** Floor an amount to a number of decimals (never round up a send amount). */
export function floorAmount(amount: number, decimals = 8): number {
  const factor = Math.pow(10, decimals);
  return Math.floor(amount * factor) / factor;
}
