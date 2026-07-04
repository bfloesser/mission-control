'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, PauseCircle, XCircle } from 'lucide-react';
import { EXCHANGE_LABELS } from '@/lib/arbitrage/exchanges';
import type { ArbTrade, TradeStep } from '@/lib/arbitrage/types';

const STEP_LABELS: Record<TradeStep, string> = {
  created: 'Angelegt',
  buy: 'Kauf',
  withdraw: 'Auszahlung',
  wait_deposit: 'Warte auf Eingang',
  sell: 'Verkauf',
  done: 'Fertig',
};

const STEP_ORDER: TradeStep[] = ['buy', 'withdraw', 'wait_deposit', 'sell', 'done'];

function fmt(n: number | undefined, digits = 6): string {
  if (n === undefined) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function TradesPanel({ refreshToken }: { refreshToken: number }) {
  const [trades, setTrades] = useState<ArbTrade[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/arbitrage/trades');
      if (!res.ok) return;
      const data = await res.json();
      setTrades(data.trades);
    } catch {
      // keep last state
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Poll faster while a trade is running
  const anyRunning = trades.some((t) => t.status === 'running');
  useEffect(() => {
    const interval = setInterval(load, anyRunning ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [load, anyRunning]);

  if (trades.length === 0) return null;

  return (
    <div className="bg-mc-bg-secondary border border-mc-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-mc-border text-xs text-mc-text-secondary uppercase">
        Trades ({trades.filter((t) => t.status === 'running').length} aktiv)
      </div>
      <div className="divide-y divide-mc-border/50">
        {trades.map((trade) => {
          const isOpen = expanded === trade.id;
          const d = trade.data;
          return (
            <div key={trade.id}>
              <button
                onClick={() => setExpanded(isOpen ? null : trade.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-mc-bg-tertiary/50 text-left"
              >
                <StatusIcon status={trade.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-mc-text">
                    {fmt(trade.spendAmount, 2)} {d.preview.buyQuote} → {trade.base}:{' '}
                    {EXCHANGE_LABELS[trade.buyExchange]} → {EXCHANGE_LABELS[trade.sellExchange]}
                  </div>
                  <StepIndicator trade={trade} />
                </div>
                <div className="text-right shrink-0">
                  {d.profitQuote !== undefined ? (
                    <div
                      className={`font-mono font-semibold text-sm ${
                        d.profitQuote >= 0 ? 'text-mc-accent-green' : 'text-mc-accent-red'
                      }`}
                    >
                      {d.profitQuote >= 0 ? '+' : ''}
                      {fmt(d.profitQuote, 2)} {d.preview.sellQuote}
                      <span className="text-xs ml-1">({d.profitPct?.toFixed(2)}%)</span>
                    </div>
                  ) : (
                    <div className="text-xs text-mc-text-secondary font-mono">
                      erwartet: {d.preview.estProfit >= 0 ? '+' : ''}
                      {fmt(d.preview.estProfit, 2)} ({d.preview.estProfitPct.toFixed(2)}%)
                    </div>
                  )}
                  <div className="text-xs text-mc-text-secondary">
                    {new Date(trade.createdAt).toLocaleTimeString()}
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-mc-text-secondary shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-mc-text-secondary shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3 bg-mc-bg">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3 text-xs">
                    <Stat label="Gekauft" value={d.boughtQty !== undefined ? `${fmt(d.boughtQty)} ${trade.base} @ ${fmt(d.buyAvgPrice)}` : '—'} />
                    <Stat label="Gesendet" value={d.withdrawnQty !== undefined ? `${fmt(d.withdrawnQty)} ${trade.base} (${d.preview.network})` : '—'} />
                    <Stat label="Angekommen" value={d.arrivedQty !== undefined ? `${fmt(d.arrivedQty)} ${trade.base}` : '—'} />
                    <Stat label="Verkauft" value={d.proceedsQuote !== undefined ? `${fmt(d.proceedsQuote, 2)} ${d.preview.sellQuote} @ ${fmt(d.sellAvgPrice)}` : '—'} />
                  </div>

                  {d.feesPaid.length > 0 && (
                    <div className="text-xs">
                      <div className="text-mc-text-secondary uppercase mb-1">Gezahlte Gebühren</div>
                      <div className="flex flex-wrap gap-2">
                        {d.feesPaid.map((f, i) => (
                          <span key={i} className="bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1 font-mono">
                            {f.label}: {fmt(f.amount)} {f.currency}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {d.error && (
                    <div className="text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red rounded p-2">
                      {d.error}
                    </div>
                  )}

                  <div className="text-xs">
                    <div className="text-mc-text-secondary uppercase mb-1">Protokoll</div>
                    <div className="space-y-1 font-mono text-mc-text-secondary max-h-48 overflow-y-auto">
                      {d.log.map((entry, i) => (
                        <div key={i}>
                          <span className="text-mc-text-secondary/60">
                            {new Date(entry.at).toLocaleTimeString()}
                          </span>{' '}
                          <span className="text-mc-text">{entry.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ArbTrade['status'] }) {
  if (status === 'running') return <Loader2 className="w-5 h-5 text-mc-accent animate-spin shrink-0" />;
  if (status === 'done') return <CheckCircle2 className="w-5 h-5 text-mc-accent-green shrink-0" />;
  if (status === 'stuck') return <PauseCircle className="w-5 h-5 text-mc-accent-yellow shrink-0" />;
  return <XCircle className="w-5 h-5 text-mc-accent-red shrink-0" />;
}

function StepIndicator({ trade }: { trade: ArbTrade }) {
  const currentIdx = STEP_ORDER.indexOf(trade.step === 'created' ? 'buy' : trade.step);
  return (
    <div className="flex items-center gap-1 mt-1">
      {STEP_ORDER.map((step, i) => {
        const isDone = i < currentIdx || trade.status === 'done';
        const isCurrent = i === currentIdx && trade.status === 'running';
        const isFailed = i === currentIdx && (trade.status === 'failed' || trade.status === 'stuck');
        return (
          <span
            key={step}
            className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
              isDone
                ? 'bg-mc-accent-green/20 text-mc-accent-green'
                : isCurrent
                  ? 'bg-mc-accent/20 text-mc-accent animate-pulse'
                  : isFailed
                    ? 'bg-mc-accent-red/20 text-mc-accent-red'
                    : 'bg-mc-bg-tertiary text-mc-text-secondary/60'
            }`}
          >
            {STEP_LABELS[step]}
          </span>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5">
      <div className="text-mc-text-secondary uppercase text-[10px]">{label}</div>
      <div className="font-mono text-mc-text break-all">{value}</div>
    </div>
  );
}
