import { NextResponse } from 'next/server';
import { probeSources } from '@/lib/arbitrage/scanner';
import { getSourcesSnapshot } from '@/lib/arbitrage/sources';

export const dynamic = 'force-dynamic';

// GET /api/arbitrage/sources - Live-Health aller Börsen-Feeds (OSIRIS-Stil
// Source-Board). Stößt zunächst alle Quellen an (durch den 15s-Cache günstig),
// liefert dann den aggregierten Health-Snapshot.
export async function GET() {
  try {
    await probeSources();
    return NextResponse.json(getSourcesSnapshot());
  } catch (error) {
    console.error('Source health probe failed:', error);
    // Auch bei einem Ausfall liefern wir den letzten bekannten Zustand.
    return NextResponse.json(getSourcesSnapshot());
  }
}
