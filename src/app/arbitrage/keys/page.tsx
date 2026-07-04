'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, KeyRound, Loader2, Trash2, XCircle } from 'lucide-react';
import { EXCHANGE_LABELS } from '@/lib/arbitrage/exchanges';
import type { ExchangeId } from '@/lib/arbitrage/types';

const ALL_EXCHANGES = Object.keys(EXCHANGE_LABELS) as ExchangeId[];

interface StoredCred {
  exchange: string;
  apiKeyMasked: string;
  updatedAt: string;
}

interface TestResult {
  ok: boolean;
  error?: string;
  balances?: Array<{ currency: string; amount: number }>;
}

export default function ArbitrageKeysPage() {
  const [stored, setStored] = useState<StoredCred[]>([]);
  const [needsPassword, setNeedsPassword] = useState<string[]>([]);
  const [editing, setEditing] = useState<ExchangeId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/arbitrage/keys');
      if (!res.ok) return;
      const data = await res.json();
      setStored(data.credentials);
      setNeedsPassword(data.needsPassword);
    } catch {
      // ignore, page still usable
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (ex: ExchangeId) => {
    setEditing(ex);
    setApiKey('');
    setSecret('');
    setPassword('');
    setError(null);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/arbitrage/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: editing,
          apiKey,
          secret,
          password: password || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ex: string) => {
    if (!confirm(`API-Keys für ${EXCHANGE_LABELS[ex as ExchangeId]} wirklich löschen?`)) return;
    await fetch(`/api/arbitrage/keys?exchange=${ex}`, { method: 'DELETE' });
    setTestResults((prev) => ({ ...prev, [ex]: undefined as unknown as TestResult }));
    await load();
  };

  const test = async (ex: string) => {
    setTesting(ex);
    try {
      const res = await fetch('/api/arbitrage/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange: ex }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [ex]: data }));
    } catch {
      setTestResults((prev) => ({ ...prev, [ex]: { ok: false, error: 'Verbindung fehlgeschlagen' } }));
    } finally {
      setTesting(null);
    }
  };

  const storedByExchange = new Map(stored.map((s) => [s.exchange, s]));

  return (
    <div className="min-h-screen bg-mc-bg">
      <header className="h-14 bg-mc-bg-secondary border-b border-mc-border flex items-center px-4 gap-4">
        <Link
          href="/arbitrage"
          className="flex items-center gap-1 text-mc-text-secondary hover:text-mc-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="text-sm">Scanner</span>
        </Link>
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-mc-accent-cyan" />
          <span className="font-semibold text-mc-text uppercase tracking-wider text-sm">
            Börsen API-Keys
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="bg-mc-accent-yellow/10 border border-mc-accent-yellow rounded-lg p-3 text-xs text-mc-accent-yellow leading-relaxed">
          Für die automatische Ausführung braucht der Key <strong>Trading- und
          Auszahlungs-Rechte</strong>. Auszahlungsrechte sind ein erhebliches Risiko — unbedingt:
          IP-Whitelist auf die IP dieses Servers setzen, wo möglich Adress-Whitelists für
          Auszahlungen aktivieren, und nur Guthaben auf der Börse halten, das du bewegen willst.
          Keys werden AES-256-verschlüsselt in der lokalen Datenbank gespeichert
          (Schlüssel: <code>.arb-secret</code> bzw. <code>ARB_ENCRYPTION_KEY</code>).
        </div>

        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg divide-y divide-mc-border">
          {ALL_EXCHANGES.map((ex) => {
            const cred = storedByExchange.get(ex);
            const result = testResults[ex];
            return (
              <div key={ex} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-mc-text">{EXCHANGE_LABELS[ex]}</div>
                    <div className="text-xs text-mc-text-secondary font-mono">
                      {cred ? `Key ${cred.apiKeyMasked}` : 'Keine Keys hinterlegt'}
                      {needsPassword.includes(ex) && ' · benötigt Passphrase'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {cred && (
                      <>
                        <button
                          onClick={() => test(ex)}
                          disabled={testing === ex}
                          className="px-3 py-1.5 text-sm bg-mc-bg-tertiary border border-mc-border rounded hover:bg-mc-bg transition-colors disabled:opacity-50"
                        >
                          {testing === ex ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Testen'
                          )}
                        </button>
                        <button
                          onClick={() => remove(ex)}
                          className="p-1.5 text-mc-accent-red hover:bg-mc-accent-red/10 rounded transition-colors"
                          title="Löschen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => startEdit(ex)}
                      className="px-3 py-1.5 text-sm bg-mc-accent/20 border border-mc-accent text-mc-accent rounded hover:bg-mc-accent/30 transition-colors"
                    >
                      {cred ? 'Ändern' : 'Hinterlegen'}
                    </button>
                  </div>
                </div>

                {result && (
                  <div
                    className={`mt-2 text-xs flex items-start gap-1.5 ${
                      result.ok ? 'text-mc-accent-green' : 'text-mc-accent-red'
                    }`}
                  >
                    {result.ok ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>
                          Verbindung OK.{' '}
                          {result.balances && result.balances.length > 0
                            ? `Guthaben: ${result.balances
                                .map((b) => `${b.amount} ${b.currency}`)
                                .join(', ')}`
                            : 'Keine Guthaben gefunden.'}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 shrink-0" />
                        <span>{result.error}</span>
                      </>
                    )}
                  </div>
                )}

                {editing === ex && (
                  <div className="mt-3 space-y-2 bg-mc-bg rounded p-3 border border-mc-border">
                    <input
                      type="text"
                      placeholder="API Key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      className="w-full bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5 text-sm text-mc-text font-mono"
                    />
                    <input
                      type="password"
                      placeholder="API Secret"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      autoComplete="new-password"
                      className="w-full bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5 text-sm text-mc-text font-mono"
                    />
                    {needsPassword.includes(ex) && (
                      <input
                        type="password"
                        placeholder="API Passphrase"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        className="w-full bg-mc-bg-tertiary border border-mc-border rounded px-2 py-1.5 text-sm text-mc-text font-mono"
                      />
                    )}
                    {error && <div className="text-xs text-mc-accent-red">{error}</div>}
                    <div className="flex gap-2">
                      <button
                        onClick={save}
                        disabled={saving || !apiKey || !secret}
                        className="px-3 py-1.5 text-sm bg-mc-accent-green/20 border border-mc-accent-green text-mc-accent-green rounded hover:bg-mc-accent-green/30 transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Speichere…' : 'Speichern'}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="px-3 py-1.5 text-sm bg-mc-bg-tertiary border border-mc-border rounded hover:bg-mc-bg transition-colors"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
