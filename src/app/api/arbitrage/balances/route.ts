import { NextResponse } from 'next/server';
import { getValuedBalances } from '@/lib/arbitrage/balances';

export const dynamic = 'force-dynamic';

// GET /api/arbitrage/balances - USD-valued balances of all configured exchanges
export async function GET() {
  try {
    const balances = await getValuedBalances();
    return NextResponse.json({ balances });
  } catch (error) {
    console.error('Failed to fetch balances:', error);
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 });
  }
}
