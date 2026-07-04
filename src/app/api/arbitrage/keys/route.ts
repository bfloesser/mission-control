import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteCredentials,
  listCredentials,
  saveCredentials,
} from '@/lib/arbitrage/credentials';
import { invalidateClient, NEEDS_PASSWORD } from '@/lib/arbitrage/clients';
import { ALL_EXCHANGES } from '@/lib/arbitrage/exchanges';
import type { ExchangeId } from '@/lib/arbitrage/types';

export const dynamic = 'force-dynamic';

// GET /api/arbitrage/keys - list configured exchanges (masked, no secrets)
export async function GET() {
  try {
    return NextResponse.json({
      credentials: listCredentials(),
      needsPassword: NEEDS_PASSWORD,
    });
  } catch (error) {
    console.error('Failed to list credentials:', error);
    return NextResponse.json({ error: 'Failed to list credentials' }, { status: 500 });
  }
}

const saveSchema = z.object({
  exchange: z.string().refine((e): e is ExchangeId => (ALL_EXCHANGES as string[]).includes(e), {
    message: 'Unbekannte Börse',
  }),
  apiKey: z.string().min(1),
  secret: z.string().min(1),
  password: z.string().optional(),
});

// POST /api/arbitrage/keys - save credentials for one exchange
export async function POST(request: NextRequest) {
  try {
    const body = saveSchema.parse(await request.json());
    const exchange = body.exchange as ExchangeId;
    if (NEEDS_PASSWORD.includes(exchange) && !body.password) {
      return NextResponse.json(
        { error: `${exchange} benötigt zusätzlich eine API-Passphrase` },
        { status: 400 }
      );
    }
    saveCredentials(exchange, {
      apiKey: body.apiKey.trim(),
      secret: body.secret.trim(),
      password: body.password?.trim() || undefined,
    });
    invalidateClient(exchange);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? 'Ungültige Eingabe' }, { status: 400 });
    }
    console.error('Failed to save credentials:', error);
    return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
  }
}

// DELETE /api/arbitrage/keys?exchange=binance
export async function DELETE(request: NextRequest) {
  try {
    const exchange = new URL(request.url).searchParams.get('exchange');
    if (!exchange || !(ALL_EXCHANGES as string[]).includes(exchange)) {
      return NextResponse.json({ error: 'Unbekannte Börse' }, { status: 400 });
    }
    deleteCredentials(exchange as ExchangeId);
    invalidateClient(exchange as ExchangeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete credentials:', error);
    return NextResponse.json({ error: 'Failed to delete credentials' }, { status: 500 });
  }
}
