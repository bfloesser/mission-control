'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { EXCHANGE_LABELS } from '@/lib/arbitrage/exchanges';
import type { ArbitrageOpportunity, TradePreview } from '@/lib/arbitrage/types';

interface TradeModalProps {
  opportunity: ArbitrageOpportunity;
  onClose: () => void;
  onStarted: (tradeId: string) => void;
}

function fmt(n: number, digits = 6): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function TradeModal({ opportunity, onClose, onStarted }: TradeModalProps) {
  const [amount, setAmount] = useState('100');
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const requestBody = useCallback(
    (spend: number) => ({
      base: opportunity.base,
      buyExchange: opportunity.buy.exchange,
      sellExchange: opportunity.sell.exchange,
      buyQuote: opportunity.buy.quote,
      sellQuote: opportunity.sell.quote,
      spendAmount: spend,
    }),
    [opportunity]
  );

  const loadPreview = useCallback(async () => {
    const spend = parseFloat(amount);
    if (!(spend > 0)) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/arbitrage/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(spend)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview fehlgeschlagen');
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Preview fehlgeschlagen');
    } finally {
      setPreviewLoading(false);
    }
  }, [amount, requestBody]);

  // Debounced preview on amount change
  useEffect(() => {
    const timer = setTimeout(loadPreview, 600);
    return () => clearTimeout(timer);
  }, [loadPreview]);

  const execute = async () => {
    const spend = parseFloat(amount);
    if (!(spend > 0) || !confirmed) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await fetch('/api/arbitrage/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(spend)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Trade konnte nicht gestartet werden');
      onStarted(data.trade.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trade konnte nicht gestartet werden');
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-mc-bg-secondary border border-mc-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <h2 className="font-semibold text-mc-text">
            {opportunity.base}: {EXCHANGE_LABELS[opportunity.buy.exchange]} →{' '}
            {EXCHANGE_LABELS[opportunity.sell.exchange]}
          </h2>
          <button onClick={onClose} className="text-mc-text-secondary hover:text-mc-text">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <label className="block text-xs text-mc-text-secondary">
            <span className="block mb-1 uppercase">
              Einsatz in {opportunity.buy.quote} (wird auf {EXCHANGE_LABELS[opportunity.buy.exchange]} ausgegeben)
            </span>
            <input
              type="number"
              min="0"
              step="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-mc-bg-tertiary border border-mc-border rounded px-3 py-2 text-lg text-mc-text font-mono"
            />
          </label>

          {previewLoading && (
            <div className="flex items-center gap-2 text-sm text-mc-text-secondary">
              <Loader2 className="w-4 h-4 animate-spin" /> Hole Live-Kurse, Netzwerke und Gebühren…
            </div>
          )}

          {error && (
            <div className="bg-mc-accent-red/10 border border-mc-accent-red rounded p-3 text-sm text-mc-accent-red">
              {error}
            </div>
          )}

          {preview && !previewLoading && (
            <div className="space-y-3">
              <div className="bg-mc-bg rounded border border-mc-border divide-y divide-mc-border/50 text-sm">
                <Row label={`Kauf @ ${EXCHANGE_LABELS[preview.buyExchange]}`}>
                  {fmt(preview.buyPrice)} {preview.buyQuote} → ~{fmt(preview.estBaseQty)} {preview.base}
                </Row>
                <Row label={`Transfer via ${preview.network}`}>
                  −{fmt(preview.withdrawFee)} {preview.base} Netzwerkgebühr → ~
                  {fmt(preview.estArriveQty)} {preview.base} kommen an
                </Row>
                <Row label={`Verkauf @ ${EXCHANGE_LABELS[preview.sellExchange]}`}>
                  {fmt(preview.sellPrice)} {preview.sellQuote} → ~{fmt(preview.estProceeds, 2)}{' '}
                  {preview.sellQuote}
                </Row>
                <Row label="Gebühren gesamt">
                  {preview.fees.map((f) => `${fmt(f.amount, 6)} ${f.currency}`).join(' + ')}
                </Row>
                <Row label="Erwarteter Gewinn">
                  <span
                    className={`font-semibold ${
                      preview.estProfit >= 0 ? 'text-mc-accent-green' : 'text-mc-accent-red'
                    }`}
                  >
                    {preview.estProfit >= 0 ? '+' : ''}
                    {fmt(preview.estProfit, 2)} {preview.sellQuote} ({preview.estProfitPct.toFixed(2)}%)
                  </span>
                </Row>
              </div>

              {preview.warnings.map((w) => (
                <div
                  key={w}
                  className="flex items-start gap-2 text-xs text-mc-accent-yellow bg-mc-accent-yellow/10 border border-mc-accent-yellow rounded p-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {w}
                </div>
              ))}

              {preview.estProfit < 0 && (
                <div className="flex items-start gap-2 text-xs text-mc-accent-red bg-mc-accent-red/10 border border-mc-accent-red rounded p-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Nach Gebühren ist dieser Trade voraussichtlich ein Verlust.
                </div>
              )}

              <label className="flex items-start gap-2 text-xs text-mc-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 accent-mc-accent"
                />
                <span>
                  Mir ist klar: Es werden echte Orders und eine echte Krypto-Auszahlung ausgeführt.
                  Kurse können sich während des Transfers ändern; der tatsächliche Gewinn kann
                  abweichen oder negativ sein.
                </span>
              </label>

              <button
                onClick={execute}
                disabled={!confirmed || executing}
                className="w-full py-2.5 bg-mc-accent-green/20 border border-mc-accent-green text-mc-accent-green rounded font-semibold hover:bg-mc-accent-green/30 transition-colors disabled:opacity-40"
              >
                {executing ? 'Starte Trade…' : `Trade ausführen (${amount} ${preview.buyQuote})`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <span className="text-mc-text-secondary text-xs uppercase pt-0.5 shrink-0">{label}</span>
      <span className="text-right font-mono text-mc-text">{children}</span>
    </div>
  );
}
