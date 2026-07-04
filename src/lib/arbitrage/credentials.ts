// Storage for exchange API credentials (encrypted at rest via crypto.ts).

import { queryAll, queryOne, run } from '@/lib/db';
import { decrypt, encrypt } from './crypto';
import type { ExchangeId } from './types';

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  /** Passphrase — required by OKX, KuCoin and Bitget */
  password?: string;
}

interface CredentialRow {
  exchange: string;
  api_key: string;
  secret: string;
  password: string | null;
  updated_at: string;
}

export function saveCredentials(exchange: ExchangeId, creds: ExchangeCredentials): void {
  run(
    `INSERT INTO exchange_credentials (exchange, api_key, secret, password, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(exchange) DO UPDATE SET
       api_key = excluded.api_key,
       secret = excluded.secret,
       password = excluded.password,
       updated_at = excluded.updated_at`,
    [exchange, encrypt(creds.apiKey), encrypt(creds.secret), creds.password ? encrypt(creds.password) : null]
  );
}

export function getCredentials(exchange: ExchangeId): ExchangeCredentials | null {
  const row = queryOne<CredentialRow>(`SELECT * FROM exchange_credentials WHERE exchange = ?`, [
    exchange,
  ]);
  if (!row) return null;
  return {
    apiKey: decrypt(row.api_key),
    secret: decrypt(row.secret),
    password: row.password ? decrypt(row.password) : undefined,
  };
}

export function deleteCredentials(exchange: ExchangeId): void {
  run(`DELETE FROM exchange_credentials WHERE exchange = ?`, [exchange]);
}

/** List configured exchanges with a masked key preview — never returns secrets. */
export function listCredentials(): Array<{ exchange: string; apiKeyMasked: string; updatedAt: string }> {
  const rows = queryAll<CredentialRow>(`SELECT * FROM exchange_credentials ORDER BY exchange`);
  return rows.map((row) => {
    let masked = '••••';
    try {
      const key = decrypt(row.api_key);
      masked = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '••••';
    } catch {
      // key file changed — credentials unreadable; still list the entry
      masked = '(nicht entschlüsselbar)';
    }
    return { exchange: row.exchange, apiKeyMasked: masked, updatedAt: row.updated_at };
  });
}
