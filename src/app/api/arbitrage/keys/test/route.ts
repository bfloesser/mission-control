import { NextRequest, NextResponse } from 'next/server';
import { getAuthedClient } from '@/lib/arbitrage/clients';
import { ALL_EXCHANGES } from '@/lib/arbitrage/exchanges';
import type { ExchangeId } from '@/lib/arbitrage/types';

export const dynamic = 'force-dynamic';

// POST /api/arbitrage/keys/test - verify credentials by fetching the balance
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const exchange = body?.exchange;
    if (!exchange || !(ALL_EXCHANGES as string[]).includes(exchange)) {
      return NextResponse.json({ error: 'Unbekannte Börse' }, { status: 400 });
    }
    const client = getAuthedClient(exchange as ExchangeId);
    const balance = await client.fetchBalance();
    const free = balance.free as unknown as Record<string, number>;
    const nonZero = Object.entries(free)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([currency, amount]) => ({ currency, amount }));
    return NextResponse.json({ ok: true, balances: nonZero });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
