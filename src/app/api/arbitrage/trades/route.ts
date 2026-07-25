import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildPreview } from '@/lib/arbitrage/preview';
import {
  advanceRunningTrades,
  createTrade,
  ensureBackgroundLoop,
  listTrades,
} from '@/lib/arbitrage/trades';
import { ALL_EXCHANGES } from '@/lib/arbitrage/exchanges';
import type { ExchangeId } from '@/lib/arbitrage/types';

export const dynamic = 'force-dynamic';

// GET /api/arbitrage/trades - list trades (advances running ones first)
export async function GET() {
  try {
    ensureBackgroundLoop();
    await advanceRunningTrades();
    return NextResponse.json({ trades: listTrades() });
  } catch (error) {
    console.error('Failed to list trades:', error);
    return NextResponse.json({ error: 'Failed to list trades' }, { status: 500 });
  }
}

const isExchange = (e: string): e is ExchangeId => (ALL_EXCHANGES as string[]).includes(e);

const createSchema = z.object({
  base: z.string().min(1),
  buyExchange: z.string().refine(isExchange),
  sellExchange: z.string().refine(isExchange),
  buyQuote: z.string().min(1),
  sellQuote: z.string().min(1),
  spendAmount: z.number().positive(),
});

// POST /api/arbitrage/trades - execute an arbitrage trade (buy → transfer → sell)
export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await request.json());
    // Re-run the preview at execution time so the trade starts from fresh
    // prices and a currently-open transfer network — not a stale UI preview.
    const preview = await buildPreview({
      ...body,
      base: body.base.toUpperCase(),
      buyExchange: body.buyExchange as ExchangeId,
      sellExchange: body.sellExchange as ExchangeId,
    });
    const trade = createTrade(preview);
    return NextResponse.json({ trade }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Trade konnte nicht gestartet werden';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
