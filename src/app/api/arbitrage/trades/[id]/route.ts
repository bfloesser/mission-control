import { NextResponse } from 'next/server';
import { advanceTrade, getTrade } from '@/lib/arbitrage/trades';

export const dynamic = 'force-dynamic';

// GET /api/arbitrage/trades/[id] - trade detail; advances the trade if running
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    let trade = getTrade(params.id);
    if (!trade) return NextResponse.json({ error: 'Trade nicht gefunden' }, { status: 404 });
    if (trade.status === 'running') {
      trade = (await advanceTrade(params.id)) ?? trade;
    }
    return NextResponse.json({ trade });
  } catch (error) {
    console.error('Failed to get trade:', error);
    return NextResponse.json({ error: 'Failed to get trade' }, { status: 500 });
  }
}
