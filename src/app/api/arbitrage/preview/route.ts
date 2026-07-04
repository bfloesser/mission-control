import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildPreview } from '@/lib/arbitrage/preview';
import { ALL_EXCHANGES } from '@/lib/arbitrage/exchanges';
import type { ExchangeId } from '@/lib/arbitrage/types';

export const dynamic = 'force-dynamic';

const isExchange = (e: string): e is ExchangeId => (ALL_EXCHANGES as string[]).includes(e);

const previewSchema = z.object({
  base: z.string().min(1),
  buyExchange: z.string().refine(isExchange),
  sellExchange: z.string().refine(isExchange),
  buyQuote: z.string().min(1),
  sellQuote: z.string().min(1),
  spendAmount: z.number().positive(),
});

// POST /api/arbitrage/preview - live fee/profit estimate before executing
export async function POST(request: NextRequest) {
  try {
    const body = previewSchema.parse(await request.json());
    const preview = await buildPreview({
      ...body,
      base: body.base.toUpperCase(),
      buyExchange: body.buyExchange as ExchangeId,
      sellExchange: body.sellExchange as ExchangeId,
    });
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Preview fehlgeschlagen';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
