'use client';

// Feed-Health-Board — überträgt das OSIRIS-„situational awareness"-Muster auf
// die Börsen-Ticker-Quellen: alle Datenfeeds auf einen Blick, mit Live-Status,
// Latenz, Markt-Anzahl und Frische. Pollt /api/arbitrage/sources.

import { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import type { SourceHealth, SourceStatus, SourcesSnapshot } from '@/lib/arbitrage/sources';

const POLL_INTERVAL_MS = 10_000;

const STATUS_META: Record<
  SourceStatus,
  { label: string; dot: string; text: string; ring: string }
> = {
  online: {
    label: 'Online',
    dot: 'bg-mc-accent-green',
    text: 'text-mc-accent-green',
    ring: 'shadow-[0_0_6px_var(--mc-accent-green)]',
  },
  degraded: {
    label: 'Träge',
    dot: 'bg-mc-accent-yellow',
    text: 'text-mc-accent-yellow',
    ring: 'shadow-[0_0_6px_var(--mc-accent-yellow)]',
  },
  stale: {
    label: 'Veraltet',
    dot: 'bg-mc-accent-yellow/60',
    text: 'text-mc-accent-yellow',
    ring: '',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-mc-accent-red',
    text: 'text-mc-accent-red',
    ring: 'shadow-[0_0_6px_var(--mc-accent-red)]',
  },
  unknown: {
    label: 'Unbekannt',
    dot: 'bg-mc-text-secondary/50',
    text: 'text-mc-text-secondary',
    ring: '',
  },
};

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '—';
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `vor ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m}m`;
  return `vor ${Math.floor(m / 60)}h`;
}

function formatCount(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function SourceHealthPanel() {
  const [snapshot, setSnapshot] = useState<SourcesSnapshot | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/arbitrage/sources');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnapshot(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const healthyPct =
    snapshot && snapshot.total > 0
      ? Math.round(((snapshot.online + snapshot.degraded) / snapshot.total) * 100)
      : 0;

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-lg overflow-hidden">
      {/* Kopfzeile mit Aggregat-Kennzahlen */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-mc-bg-tertiary/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-mc-accent-cyan" />
          <span className="text-sm font-semibold text-mc-text uppercase tracking-wider">
            Feed-Status
          </span>
          {snapshot && (
            <span className="text-xs text-mc-text-secondary">
              {snapshot.online + snapshot.degraded}/{snapshot.total} Feeds aktiv · {healthyPct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {snapshot && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-mc-text-secondary font-mono">
              {snapshot.offline > 0 && (
                <span className="text-mc-accent-red">{snapshot.offline} offline</span>
              )}
              {snapshot.degraded > 0 && (
                <span className="text-mc-accent-yellow">{snapshot.degraded} träge</span>
              )}
              <span>Ø {snapshot.avgLatencyMs ?? '—'} ms</span>
              <span>{snapshot.totalMarkets.toLocaleString()} Märkte</span>
            </div>
          )}
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-mc-text-secondary" />
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4">
          {error && !snapshot && (
            <div className="text-xs text-mc-accent-red py-2">Status nicht abrufbar: {error}</div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {snapshot?.sources.map((s) => (
              <SourceCard key={s.exchange} source={s} />
            ))}
            {!snapshot && (
              <div className="col-span-full text-xs text-mc-text-secondary py-4 text-center">
                Feeds werden geprüft…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceCard({ source }: { source: SourceHealth }) {
  const meta = STATUS_META[source.status];
  return (
    <div
      className="bg-mc-bg-tertiary border border-mc-border rounded px-3 py-2"
      title={source.lastError ? `${source.host} — ${source.lastError}` : source.host}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-mc-text truncate">{source.label}</span>
        <span
          className={`shrink-0 w-2.5 h-2.5 rounded-full ${meta.dot} ${meta.ring}`}
          aria-label={meta.label}
        />
      </div>
      <div className={`text-xs font-medium ${meta.text}`}>{meta.label}</div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-mc-text-secondary font-mono">
        <span>{source.avgLatencyMs === null ? '— ms' : `${source.avgLatencyMs} ms`}</span>
        <span>{formatCount(source.tickerCount)} Mkt</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-mc-text-secondary">
        <span>{formatAge(source.ageMs)}</span>
        {source.consecutiveFailures > 0 && (
          <span className="text-mc-accent-red">×{source.consecutiveFailures}</span>
        )}
      </div>
    </div>
  );
}
