import { NextRequest, NextResponse } from 'next/server';
import { scan } from '@/lib/arbitrage/scanner';
import { ALL_EXCHANGES } from '@/lib/arbitrage/exchanges';
import type { ExchangeId, QuoteBucket } from '@/lib/arbitrage/types';

export const dynamic = 'force-dynamic';

const QUOTE_BUCKETS: QuoteBucket[] = ['USD', 'EUR', 'BTC', 'ETH'];

// GET /api/arbitrage - Scan exchanges for cross-exchange arbitrage spreads
//
// Query params:
//   exchanges  - comma-separated exchange ids (default: all)
//   quote      - USD | EUR | BTC | ETH (default: all buckets)
//   minSpread  - minimum net spread in % (default 0.3)
//   maxSpread  - drop spreads above this % as stale data (default 20)
//   minVolume  - minimum 24h quote volume on both legs (default 50000)
//   limit      - max results (default 100)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    let exchanges: ExchangeId[] | undefined;
    const exchangesParam = searchParams.get('exchanges');
    if (exchangesParam) {
      exchanges = exchangesParam
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e): e is ExchangeId => (ALL_EXCHANGES as string[]).includes(e));
      if (exchanges.length === 0) {
        return NextResponse.json(
          { error: `No valid exchanges. Valid: ${ALL_EXCHANGES.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const quoteParam = searchParams.get('quote')?.toUpperCase();
    const quoteBucket =
      quoteParam && (QUOTE_BUCKETS as string[]).includes(quoteParam)
        ? (quoteParam as QuoteBucket)
        : undefined;

    const numParam = (name: string): number | undefined => {
      const raw = searchParams.get(name);
      if (raw === null) return undefined;
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : undefined;
    };

    const result = await scan({
      exchanges,
      quoteBucket,
      minSpreadPct: numParam('minSpread'),
      maxSpreadPct: numParam('maxSpread'),
      minVolume: numParam('minVolume'),
      limit: numParam('limit'),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Arbitrage scan failed:', error);
    return NextResponse.json({ error: 'Arbitrage scan failed' }, { status: 500 });
  }
}
