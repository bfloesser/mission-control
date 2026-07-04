'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Play,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { EXCHANGE_LABELS } from '@/lib/arbitrage/exchanges';
import { TradeModal } from '@/components/arbitrage/TradeModal';
import { TradesPanel } from '@/components/arbitrage/TradesPanel';
import type {
  ArbitrageOpportunity,
  ExchangeId,
  QuoteBucket,
  ScanResult,
} from '@/lib/arbitrage/types';

const ALL_EXCHANGES = Object.keys(EXCHANGE_LABELS) as ExchangeId[];
const QUOTE_BUCKETS: Array<{ value: QuoteBucket | ''; label: string }> = [
  { value: 'USD', label: 'USD / USDT / USDC' },
  { value: 'EUR', label: 'EUR' },
  { value: 'BTC', label: 'BTC' },
  { value: 'ETH', label: 'ETH' },
  { value: '', label: 'Alle' },
];

const REFRESH_INTERVAL_MS = 30_000;

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(5);
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
}

function spreadColor(pct: number): string {
  if (pct >= 1) return 'text-mc-accent-green';
  if (pct >= 0.5) return 'text-mc-accent-yellow';
  return 'text-mc-text';
}

export default function ArbitragePage() {
  const [selectedExchanges, setSelectedExchanges] = useState<ExchangeId[]>(ALL_EXCHANGES);
  const [quoteBucket, setQuoteBucket] = useState<QuoteBucket | ''>('USD');
  const [minSpread, setMinSpread] = useState('0.3');
  const [minVolume, setMinVolume] = useState('50000');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tradeOpp, setTradeOpp] = useState<ArbitrageOpportunity | null>(null);
  const [tradesRefresh, setTradesRefresh] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedExchanges.length < ALL_EXCHANGES.length) {
      params.set('exchanges', selectedExchanges.join(','));
    }
    if (quoteBucket) params.set('quote', quoteBucket);
    if (minSpread) params.set('minSpread', minSpread);
    if (minVolume) params.set('minVolume', minVolume);
    return params.toString();
  }, [selectedExchanges, quoteBucket, minSpread, minVolume]);

  const runScan = useCallback(async () => {
    if (selectedExchanges.length < 2) {
      setError('Mindestens 2 Börsen auswählen');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/arbitrage?${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [query, selectedExchanges.length]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(runScan, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, runScan]);

  const toggleExchange = (ex: ExchangeId) => {
    setSelectedExchanges((prev) =>
      prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex]
    );
  };

  const failedExchanges = result ? (Object.keys(result.errors) as ExchangeId[]) : [];

  return (
    <div className="min-h-screen bg-mc-bg">
      {/* Header */}
      <header className="h-14 bg-mc-bg-secondary border-b border-mc-border flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1 text-mc-text-secondary hover:text-mc-accent transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm">Dashboard</span>
          </Link>
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-mc-accent-cyan" />
            <span className="font-semibold text-mc-text uppercase tracking-wider text-sm">
              Arbitrage Scanner
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {result && (
            <span className="text-xs text-mc-text-secondary">
              {result.tickerCount.toLocaleString()} Märkte ·{' '}
              {new Date(result.scannedAt).toLocaleTimeString()}
            </span>
          )}
          <Link
            href="/arbitrage/keys"
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-bg-tertiary border border-mc-border rounded text-sm hover:bg-mc-bg transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            API-Keys
          </Link>
          <label className="flex items-center gap-2 text-xs text-mc-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-mc-accent"
            />
            Auto-Refresh (30s)
          </label>
          <button
            onClick={runScan}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-bg-tertiary border border-mc-border rounded text-sm hover:bg-mc-bg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Scan
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Filters */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {ALL_EXCHANGES.map((ex) => {
              const active = selectedExchanges.includes(ex);
              const failed = failedExchanges.includes(ex);
              return (
                <button
                  key={ex}
                  onClick={() => toggleExchange(ex)}
                  title={failed ? `Fehler: ${result?.errors[ex]}` : undefined}
                  className={`px-3 py-1 rounded border text-sm transition-colors ${
                    active
                      ? failed
                        ? 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
                        : 'bg-mc-accent/20 border-mc-accent text-mc-accent'
                      : 'bg-mc-bg-tertiary border-mc-border text-mc-text-secondary hover:text-mc-text'
                  }`}
                >
                  {EXCHANGE_LABELS[ex]}
                  {failed && active && ' ⚠'}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs text-mc-text-secondary">
              <span className="block mb-1 uppercase">Quote</span>
              <select
                value={quoteBucket}
                onChange={(e) => setQuoteBucket(e.target.value as QuoteBucket | '')}
                className="bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5 text-sm text-mc-text"
              >
                {QUOTE_BUCKETS.map((q) => (
                  <option key={q.label} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-mc-text-secondary">
              <span className="block mb-1 uppercase">Min. Netto-Spread %</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={minSpread}
                onChange={(e) => setMinSpread(e.target.value)}
                className="w-28 bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5 text-sm text-mc-text"
              />
            </label>
            <label className="text-xs text-mc-text-secondary">
              <span className="block mb-1 uppercase">Min. 24h-Volumen (Quote)</span>
              <input
                type="number"
                step="10000"
                min="0"
                value={minVolume}
                onChange={(e) => setMinVolume(e.target.value)}
                className="w-32 bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5 text-sm text-mc-text"
              />
            </label>
          </div>
        </div>

        {/* Errors */}
        {error && (
          <div className="bg-mc-accent-red/10 border border-mc-accent-red rounded-lg p-3 text-sm text-mc-accent-red">
            {error}
          </div>
        )}
        {failedExchanges.length > 0 && (
          <div className="bg-mc-accent-yellow/10 border border-mc-accent-yellow rounded-lg p-3 text-sm text-mc-accent-yellow">
            Keine Daten von: {failedExchanges.map((e) => EXCHANGE_LABELS[e]).join(', ')} — Ergebnisse
            sind unvollständig.
          </div>
        )}

        {/* Active & past trades */}
        <TradesPanel refreshToken={tradesRefresh} />

        {/* Results */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mc-border text-xs text-mc-text-secondary uppercase">
                  <th className="text-left px-4 py-3">Coin</th>
                  <th className="text-left px-4 py-3">Kaufen bei</th>
                  <th className="text-left px-4 py-3">Verkaufen bei</th>
                  <th className="text-right px-4 py-3">Brutto</th>
                  <th className="text-right px-4 py-3">Netto*</th>
                  <th className="text-right px-4 py-3">Min. Vol 24h</th>
                  <th className="w-20" />
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {result?.opportunities.map((opp) => {
                  const key = `${opp.base}-${opp.quoteBucket}`;
                  const isOpen = expanded === key;
                  return (
                    <OpportunityRow
                      key={key}
                      opp={opp}
                      isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : key)}
                      onTrade={() => setTradeOpp(opp)}
                    />
                  );
                })}
                {result && result.opportunities.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-mc-text-secondary">
                      Keine Gelegenheiten über {minSpread}% Netto-Spread gefunden.
                    </td>
                  </tr>
                )}
                {!result && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-mc-text-secondary">
                      {loading ? 'Scanne Börsen…' : 'Noch kein Scan.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-mc-text-secondary leading-relaxed">
          * Netto = Brutto-Spread abzüglich der Basis-Taker-Gebühren beider Börsen.{' '}
          <strong>Nicht enthalten:</strong> Auszahlungs-/Netzwerkgebühren, Slippage und
          Transferzeit. Spreads können in Sekunden verschwinden — vor einem Trade prüfen, ob
          Ein- und Auszahlungen für den Coin auf beiden Börsen offen sind (angehaltene Wallets
          sind die häufigste Ursache für scheinbar hohe Spreads). Keine Anlageberatung.
        </p>
      </main>

      {tradeOpp && (
        <TradeModal
          opportunity={tradeOpp}
          onClose={() => setTradeOpp(null)}
          onStarted={() => setTradesRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}

function OpportunityRow({
  opp,
  isOpen,
  onToggle,
  onTrade,
}: {
  opp: ArbitrageOpportunity;
  isOpen: boolean;
  onToggle: () => void;
  onTrade: () => void;
}) {
  const minVol = Math.min(opp.buy.quoteVolume24h, opp.sell.quoteVolume24h);
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-mc-border/50 hover:bg-mc-bg-tertiary/50 cursor-pointer"
      >
        <td className="px-4 py-3">
          <span className="font-semibold text-mc-text">{opp.base}</span>
          <span className="text-mc-text-secondary">/{opp.quoteBucket}</span>
        </td>
        <td className="px-4 py-3">
          <span className="text-mc-accent">{EXCHANGE_LABELS[opp.buy.exchange]}</span>{' '}
          <span className="text-mc-text-secondary">
            @ {formatPrice(opp.buy.price)} {opp.buy.quote}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-mc-accent-purple">{EXCHANGE_LABELS[opp.sell.exchange]}</span>{' '}
          <span className="text-mc-text-secondary">
            @ {formatPrice(opp.sell.price)} {opp.sell.quote}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-mono">{opp.grossSpreadPct.toFixed(2)}%</td>
        <td className={`px-4 py-3 text-right font-mono font-semibold ${spreadColor(opp.netSpreadPct)}`}>
          <TrendingUp className="inline w-3.5 h-3.5 mr-1 mb-0.5" />
          {opp.netSpreadPct.toFixed(2)}%
        </td>
        <td className="px-4 py-3 text-right text-mc-text-secondary font-mono">
          {formatVolume(minVol)}
        </td>
        <td className="px-2 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrade();
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-mc-accent-green/20 border border-mc-accent-green text-mc-accent-green rounded hover:bg-mc-accent-green/30 transition-colors"
            title="Arbitrage-Trade ausführen"
          >
            <Play className="w-3 h-3" />
            Trade
          </button>
        </td>
        <td className="px-2 text-mc-text-secondary">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-mc-border/50 bg-mc-bg">
          <td colSpan={8} className="px-4 py-3">
            <div className="text-xs text-mc-text-secondary uppercase mb-2">
              Alle Kurse ({opp.exchangeCount} Börsen, sortiert nach Ask)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {opp.allQuotes.map((q) => (
                <div
                  key={q.exchange}
                  className="bg-mc-bg-tertiary border border-mc-border rounded px-3 py-2"
                >
                  <div className="text-sm text-mc-text">{EXCHANGE_LABELS[q.exchange]}</div>
                  <div className="font-mono text-sm">
                    {formatPrice(q.price)} {q.quote}
                  </div>
                  <div className="text-xs text-mc-text-secondary">
                    Vol {formatVolume(q.quoteVolume24h)} · Fee {(q.takerFee * 100).toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
