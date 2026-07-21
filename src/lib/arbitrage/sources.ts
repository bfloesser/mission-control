// Feed-Health-Registry für die Börsen-Ticker-Quellen.
//
// Idee übernommen aus dem OSINT-Dashboard-Muster (OSIRIS): jede Datenquelle ist
// eine registrierte "Source" mit eigenem Live-Status. Statt Feed-Fehler nur
// flüchtig pro Scan zu zeigen, halten wir hier einen persistenten Gesundheits-
// zustand pro Börse (online/degraded/offline/stale, Latenz, Markt-Anzahl,
// Frische, letzter Fehler). Das speist ein „situational awareness"-Board.
//
// Reines In-Memory-State-Modul ohne Abhängigkeit auf den Scanner → kein Zyklus.

import { ALL_EXCHANGES, EXCHANGE_LABELS, TAKER_FEES } from './exchanges';
import type { ExchangeId } from './types';

export type SourceStatus = 'online' | 'degraded' | 'offline' | 'stale' | 'unknown';

/** Berechneter Live-Zustand einer Quelle, wie er ans Board geliefert wird. */
export interface SourceHealth {
  exchange: ExchangeId;
  label: string;
  host: string;
  takerFee: number;
  status: SourceStatus;
  /** Latenz des letzten echten Fetches in ms (null = noch nie gemessen). */
  latencyMs: number | null;
  /** Geglättete Durchschnittslatenz in ms. */
  avgLatencyMs: number | null;
  /** Anzahl Märkte aus dem letzten erfolgreichen Fetch. */
  tickerCount: number | null;
  /** Wurde beim letzten Zugriff veraltete Cache-Antwort ausgeliefert? */
  servedStale: boolean;
  /** Aufeinanderfolgende Fehlversuche seit dem letzten Erfolg. */
  consecutiveFailures: number;
  /** Letzte Fehlermeldung (falls vorhanden). */
  lastError: string | null;
  /** ISO-Zeit des letzten erfolgreichen Fetches. */
  lastSuccessAt: string | null;
  /** ISO-Zeit des letzten Zugriffsversuchs. */
  lastCheckedAt: string | null;
  /** Alter der letzten erfolgreichen Daten in ms (null = nie). */
  ageMs: number | null;
}

/** Aggregierte Kennzahlen für die Board-Kopfzeile. */
export interface SourcesSnapshot {
  generatedAt: string;
  total: number;
  online: number;
  degraded: number;
  offline: number;
  stale: number;
  unknown: number;
  /** Ø-Latenz über alle Quellen mit Messwert. */
  avgLatencyMs: number | null;
  /** Summe der Märkte über alle online/degraded Quellen. */
  totalMarkets: number;
  sources: SourceHealth[];
}

// Endpunkt-Host je Börse — nur fürs Board-Detail (welcher Dienst hängt).
const SOURCE_HOST: Record<ExchangeId, string> = {
  binance: 'api.binance.com',
  kraken: 'api.kraken.com',
  kucoin: 'api.kucoin.com',
  okx: 'www.okx.com',
  bybit: 'api.bybit.com',
  gateio: 'api.gateio.ws',
  bitget: 'api.bitget.com',
  mexc: 'api.mexc.com',
  cryptocom: 'api.crypto.com',
  bitfinex: 'api-pub.bitfinex.com',
};

// Schwellen für die Status-Ableitung.
const DEGRADED_LATENCY_MS = 2_500; // langsamer → degraded
const STALE_AFTER_MS = 60_000; // ältere Erfolgsdaten → stale
const STALE_SERVE_WINDOW_MS = 120_000; // Fenster, in dem der Scanner stale ausliefert

/** Rohzustand, aus dem der Status zur Abfragezeit berechnet wird. */
interface RawState {
  latencyMs: number | null;
  avgLatencyMs: number | null;
  tickerCount: number | null;
  servedStale: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastSuccessAtMs: number | null;
  lastCheckedAtMs: number | null;
}

const state = new Map<ExchangeId, RawState>();

function get(exchange: ExchangeId): RawState {
  let s = state.get(exchange);
  if (!s) {
    s = {
      latencyMs: null,
      avgLatencyMs: null,
      tickerCount: null,
      servedStale: false,
      consecutiveFailures: 0,
      lastError: null,
      lastSuccessAtMs: null,
      lastCheckedAtMs: null,
    };
    state.set(exchange, s);
  }
  return s;
}

/** Erfolgreicher Live-Fetch. */
export function recordSuccess(exchange: ExchangeId, latencyMs: number, tickerCount: number): void {
  const s = get(exchange);
  const now = Date.now();
  s.latencyMs = latencyMs;
  s.avgLatencyMs = s.avgLatencyMs === null ? latencyMs : s.avgLatencyMs * 0.7 + latencyMs * 0.3;
  s.tickerCount = tickerCount;
  s.servedStale = false;
  s.consecutiveFailures = 0;
  s.lastError = null;
  s.lastSuccessAtMs = now;
  s.lastCheckedAtMs = now;
}

/**
 * Fehlgeschlagener Fetch. `servedStale` = ob der Scanner trotzdem noch
 * gecachte (veraltete) Daten ausliefern konnte.
 */
export function recordFailure(exchange: ExchangeId, error: string, servedStale: boolean): void {
  const s = get(exchange);
  s.consecutiveFailures += 1;
  s.lastError = error;
  s.servedStale = servedStale;
  s.lastCheckedAtMs = Date.now();
}

/** Cache-Treffer (kein Netzwerkaufruf): nur Prüfzeitpunkt aktualisieren. */
export function recordCacheHit(exchange: ExchangeId): void {
  get(exchange).lastCheckedAtMs = Date.now();
}

function deriveStatus(s: RawState, now: number): SourceStatus {
  if (s.lastCheckedAtMs === null) return 'unknown';

  if (s.consecutiveFailures > 0) {
    // Fehler jetzt, aber noch frische Erfolgsdaten im Stale-Fenster → degraded,
    // sonst komplett offline.
    if (s.lastSuccessAtMs !== null && now - s.lastSuccessAtMs < STALE_SERVE_WINDOW_MS) {
      return 'degraded';
    }
    return 'offline';
  }

  if (s.lastSuccessAtMs === null) return 'unknown';
  if (now - s.lastSuccessAtMs > STALE_AFTER_MS) return 'stale';
  if (s.latencyMs !== null && s.latencyMs > DEGRADED_LATENCY_MS) return 'degraded';
  return 'online';
}

/** Live-Health einer einzelnen Quelle. */
export function getSourceHealth(exchange: ExchangeId): SourceHealth {
  const s = get(exchange);
  const now = Date.now();
  return {
    exchange,
    label: EXCHANGE_LABELS[exchange],
    host: SOURCE_HOST[exchange],
    takerFee: TAKER_FEES[exchange],
    status: deriveStatus(s, now),
    latencyMs: s.latencyMs === null ? null : Math.round(s.latencyMs),
    avgLatencyMs: s.avgLatencyMs === null ? null : Math.round(s.avgLatencyMs),
    tickerCount: s.tickerCount,
    servedStale: s.servedStale,
    consecutiveFailures: s.consecutiveFailures,
    lastError: s.lastError,
    lastSuccessAt: s.lastSuccessAtMs === null ? null : new Date(s.lastSuccessAtMs).toISOString(),
    lastCheckedAt: s.lastCheckedAtMs === null ? null : new Date(s.lastCheckedAtMs).toISOString(),
    ageMs: s.lastSuccessAtMs === null ? null : now - s.lastSuccessAtMs,
  };
}

/** Board-Snapshot über alle registrierten Quellen inkl. Aggregat-Kennzahlen. */
export function getSourcesSnapshot(): SourcesSnapshot {
  const sources = ALL_EXCHANGES.map(getSourceHealth).sort((a, b) => {
    // online zuerst, dann nach Latenz; unbekannte/offline ans Ende
    const rank: Record<SourceStatus, number> = {
      online: 0,
      degraded: 1,
      stale: 2,
      offline: 3,
      unknown: 4,
    };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (a.avgLatencyMs ?? Infinity) - (b.avgLatencyMs ?? Infinity);
  });

  const counts = { online: 0, degraded: 0, offline: 0, stale: 0, unknown: 0 };
  let latencySum = 0;
  let latencyN = 0;
  let totalMarkets = 0;
  for (const src of sources) {
    counts[src.status] += 1;
    if (src.avgLatencyMs !== null) {
      latencySum += src.avgLatencyMs;
      latencyN += 1;
    }
    if ((src.status === 'online' || src.status === 'degraded') && src.tickerCount) {
      totalMarkets += src.tickerCount;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    total: sources.length,
    ...counts,
    avgLatencyMs: latencyN > 0 ? Math.round(latencySum / latencyN) : null,
    totalMarkets,
    sources,
  };
}
